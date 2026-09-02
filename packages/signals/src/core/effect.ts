import {
  CONFIG_AUTO_DISPOSE,
  CONFIG_CHILDREN_FORBIDDEN,
  EFFECT_RENDER,
  EFFECT_TRACKED,
  EFFECT_USER,
  REACTIVE_DISPOSED,
  STATUS_ERROR,
  STATUS_PENDING
} from "./constants.js";
import {
  computed,
  createEffectNode,
  recompute,
  setStrictRead,
  staleValues,
  ext,
  setEffectStatusNotify
} from "./core.js";
import { emitDiagnostic } from "./dev.js";
import { StatusError, unwrapStatusError } from "./error.js";
import {
  _hitUnhandledAsync,
  GlobalQueue,
  haltReactivity,
  resetUnhandledAsync,
  setTrackedQueueCallback,
  setEffectCallback
} from "./scheduler.js";
import type { Computed, NodeOptions, Owner } from "./types.js";

export interface Effect<T> extends Computed<T>, Owner {
  _effectFn: (val: T, prev: T | undefined) => void | (() => void);
  _errorFn?: (err: unknown, cleanup: () => void) => void;
  _modified: boolean;
  _prevValue: T | undefined;
  _type: number;
  _boundRunEffect?: () => void;
}

/**
 * Effects are the leaf nodes of our reactive graph. When their sources change, they are
 * automatically added to the queue of effects to re-execute, which will cause them to fetch their
 * sources and recompute
 */
export function effect<T>(
  compute: (prev: T | undefined) => T,
  effect: (val: T, prev: T | undefined) => void | (() => void),
  error?: (err: unknown, cleanup: () => void) => void | (() => void),
  options?: NodeOptions<any> & { user?: boolean; defer?: boolean; schedule?: boolean }
): void {
  const isUser = !!options?.user;
  const node = createEffectNode<T>(
    compute,
    effect,
    error,
    isUser ? EFFECT_USER : EFFECT_RENDER,
    options
  ) as Effect<T>;
  recompute(node, true);
  !options?.defer &&
    (node._type === EFFECT_USER || options?.schedule
      ? node._queue.enqueue(node._type, runEffect.bind(null, node))
      : runEffect(node));
  if (__DEV__ && !node._parent) {
    const message =
      "[NO_OWNER_EFFECT] Effects created outside a reactive context will never be disposed";
    emitDiagnostic({
      code: "NO_OWNER_EFFECT",
      kind: "lifecycle",
      severity: "warn",
      message,
      ownerId: node.id,
      ownerName: node._name,
      data: { effectType: "effect" }
    });
    console.warn(message);
  }
}

/**
 * PROTOTYPE (graph-native regions exploration) — single-source render
 * effect. OWNER-BOUND (audit correction, 2026-09-01): `createEffectNode`
 * parents under the active owner, so error boundaries, holds, and
 * disposal compose exactly like any render effect — that is desirable and
 * intentional. What this skips versus `effect()` is only the option
 * plumbing and the NO_OWNER_EFFECT diagnostic (regions created inside
 * another region's commit legitimately run ownerless; the caller owns
 * their disposal via the returned node).
 */
export function deliveryEffect(compute: () => void, commit: () => void): Computed<unknown> {
  const node = createEffectNode(
    compute as (prev?: unknown) => unknown,
    // The commit's return is SWALLOWED (audit round 2, P1-3): the effect
    // pipeline treats a returned function as a cleanup and non-functions
    // halt in dev — a concise-arrow region body (`() => el.data = v`)
    // must never trip either.
    () => {
      commit();
    },
    undefined,
    EFFECT_RENDER,
    undefined
  ) as Effect<unknown>;
  recompute(node, true);
  runEffect(node); // initial run performs the region's initial commit
  return node;
}

function notifyEffectStatus(this: Effect<any>, status?: number, error?: any): void {
  // Use passed values if provided, otherwise read from node
  const actualStatus = status !== undefined ? status : this._statusFlags;
  const actualError = error !== undefined ? error : this._x?._error;
  if (actualStatus & STATUS_ERROR) {
    this._queue.notify(this, STATUS_PENDING, 0);
    if (this._type === EFFECT_USER) {
      // The error handler is the error arm of the effect phase (#2840 ruling):
      // queue it like the effect function. It runs in the same imperative,
      // writable scope, throws escalate the same way, and a held transition
      // (or optimistic lane) defers it exactly as it defers the success arm.
      // No payload is queued — the node already carries `_statusFlags`/`_error`,
      // and the runner dispatches on them, so a recovery before the effect
      // phase takes the success arm instead. Blocked forwards (explicit
      // `status` arg without node-state writes) don't queue: the status
      // re-propagates unblocked at commit.
      if (this._statusFlags & STATUS_ERROR) {
        this._modified = true;
        this._queue.enqueue(this._type, (this._boundRunEffect ??= runEffect.bind(null, this)));
      }
      return;
    }
    if (!this._queue.notify(this, STATUS_ERROR, STATUS_ERROR)) {
      haltReactivity(unwrapStatusError(actualError));
      throw actualError;
    }
  } else if (this._type === EFFECT_RENDER) {
    this._queue.notify(this, STATUS_PENDING | STATUS_ERROR, actualStatus, actualError);
    if (__DEV__ && _hitUnhandledAsync) {
      // Async without a `Loading` ancestor is legal (the mount defers), so this
      // is a consistent FYI — an `Errored` above must not swallow it. The old
      // STATUS_ERROR re-notify here dated from when enforcement routed the
      // pending to the error boundary; that both suppressed the warning and
      // showed the error fallback in dev only (#2822).
      resetUnhandledAsync();
      const message =
        "[ASYNC_OUTSIDE_LOADING_BOUNDARY] An async value was read outside a Loading boundary. The root mount will be deferred until all pending async settles.";
      emitDiagnostic({
        code: "ASYNC_OUTSIDE_LOADING_BOUNDARY",
        kind: "async",
        severity: "warn",
        message,
        ownerId: this.id,
        ownerName: this._name
      });
      console.warn(message);
    }
  }
}

function runEffect(node: Effect<any>): void {
  if (!node._modified || node._flags & REACTIVE_DISPOSED) return;
  // Error arm (#2840), user effects only: a compute-phase error that is still
  // the node's settled state at effect time runs the bundle's error handler in
  // this same imperative, writable scope. Unwrap the StatusError used for
  // source tracking — user code gets the error it threw, as boundaries do. No
  // handler: log and keep the system alive (the run was skipped). A handler
  // (or logging) consumes the error; a handler throw falls to the shared
  // catch below and escalates boundary-or-halt like any effect-phase throw.
  // Render effects bypass: their errors route to boundaries synchronously in
  // notifyEffectStatus, and a runner queued by an earlier valueChanged in the
  // same flush must not be hijacked by a later-arriving error status.
  if (node._statusFlags & STATUS_ERROR && node._type === EFFECT_USER) {
    const err = unwrapStatusError(node._x?._error);
    node._prevValue = node._value;
    node._modified = false;
    try {
      node._errorFn
        ? node._errorFn(err, () => {
            const prevCleanup = node._cleanup;
            node._cleanup = undefined;
            prevCleanup?.();
          })
        : console.error(err);
    } catch (error) {
      if (!node._queue.notify(node, STATUS_ERROR, STATUS_ERROR)) {
        haltReactivity(error);
        throw error;
      }
    }
    return;
  }
  let prevStrictRead: string | false = false;
  if (__DEV__) {
    prevStrictRead = setStrictRead("an effect callback");
    setEffectCallback(true);
  }
  const prevCleanup = node._cleanup;
  node._cleanup = undefined;
  try {
    prevCleanup?.();
    const nextCleanup = node._effectFn(node._value, node._prevValue);
    if (__DEV__ && nextCleanup !== undefined && typeof nextCleanup !== "function") {
      throw new Error(
        `${node._name || "effect"} callback returned an invalid cleanup value. Return a cleanup function or undefined.`
      );
    }
    // The final cleanup is invoked by disposeChildren at true disposal.
    node._cleanup = nextCleanup as (() => void) | undefined;
  } catch (error) {
    ext(node)._error = new StatusError(node, error);
    node._statusFlags |= STATUS_ERROR;
    if (!node._queue.notify(node, STATUS_ERROR, STATUS_ERROR)) {
      haltReactivity(error);
      throw error;
    }
  } finally {
    if (__DEV__) {
      setStrictRead(prevStrictRead);
      setEffectCallback(false);
    }
    node._prevValue = node._value;
    node._modified = false;
  }
}

GlobalQueue._runEffect = runEffect as (el: Computed<unknown>) => void;

export interface TrackedEffect extends Computed<void> {
  _modified: boolean;
  _type: number;
  _run: () => void;
}

/**
 * Internal tracked effect - bypasses heap, goes directly to effect queue.
 * Runs as a leaf owner: child primitives and onCleanup are forbidden (__DEV__ throws).
 * Uses stale reads.
 */
export function trackedEffect(fn: () => void | (() => void), options?: NodeOptions<any>): void {
  const run = () => {
    if (!node._modified || node._flags & REACTIVE_DISPOSED) return;
    if (__DEV__) setTrackedQueueCallback(true);
    try {
      node._modified = false;
      recompute(node);
    } finally {
      if (__DEV__) setTrackedQueueCallback(false);
    }
  };

  const node = computed<void>(
    () => {
      const prevCleanup = node._cleanup;
      node._cleanup = undefined;
      prevCleanup?.();
      const cleanup = staleValues(fn);
      if (__DEV__ && cleanup !== undefined && typeof cleanup !== "function") {
        throw new Error(
          `${node._name || "trackedEffect"} callback returned an invalid cleanup value. Return a cleanup function or undefined.`
        );
      }
      node._cleanup = cleanup as (() => void) | undefined;
    },
    { ...options, lazy: true }
  ) as TrackedEffect;

  node._cleanup = undefined;
  node._config = (node._config & ~CONFIG_AUTO_DISPOSE) | CONFIG_CHILDREN_FORBIDDEN;
  node._modified = true;
  node._type = EFFECT_TRACKED;
  // Status dispatch rides the SHARED notifier (statusNotifierOf keys off
  // _type): its error arm is behavior-identical to the closure that used to
  // live here, without the per-node NodeExtension allocation.
  node._run = run;
  node._queue.enqueue(EFFECT_USER, run);

  if (__DEV__ && !node._parent) {
    const message =
      "[NO_OWNER_EFFECT] Effects created outside a reactive context will never be disposed";
    emitDiagnostic({
      code: "NO_OWNER_EFFECT",
      kind: "lifecycle",
      severity: "warn",
      message,
      ownerId: node.id,
      ownerName: node._name,
      data: { effectType: "trackedEffect" }
    });
    console.warn(message);
  }
}

// Install the shared effect status notifier (statusNotifierOf serves it to
// every effect node) — module-scope: any bundle that creates effects
// evaluates this module.
setEffectStatusNotify(notifyEffectStatus);
