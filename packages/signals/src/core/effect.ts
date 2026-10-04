import { NOT_PENDING } from "./constants.js";
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
  enterCallback,
  exitCallback,
  recompute,
  setStrictRead,
  staleValues,
  ext,
  setEffectStatusNotify
} from "./core.js";
import { attrHooks } from "./attribution-hooks.js";
import { emitDiagnostic, reportDiagnostic } from "./dev.js";
import { StatusError, unwrapStatusError } from "./error.js";
import { trimStaleDeps } from "./graph.js";
import { enqueueSub } from "./heap.js";
import {
  _hitUnhandledAsync,
  GlobalQueue,
  globalQueue,
  haltReactivity,
  resetUnhandledAsync,
  schedule,
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
  _boundRunEffect?: (type: number) => void;
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
  // A first pass that read a staged value was staged itself (recompute: born
  // staged); the flush's commit replays this effect. Its first run is not this
  // creation's (A29). A lane's node likewise: its run is the lane's, queued
  // by the pass and released at the reveal (lanes.ts).
  !options?.defer &&
    node._pendingValue === NOT_PENDING &&
    !node._x?._transaction?._lane &&
    (node._type === EFFECT_USER || options?.schedule
      ? globalQueue.enqueue(node._type, runEffect.bind(null, node))
      : runEffect(node, node._type));
  if (__DEV__ && !node._parent) {
    const message =
      "[NO_OWNER_EFFECT] Effects created outside a reactive context will never be disposed";
    reportDiagnostic(
      emitDiagnostic(
        {
          code: "NO_OWNER_EFFECT",
          kind: "lifecycle",
          severity: "warn",
          message,
          ownerId: node.id,
          ownerName: node._name,
          data: { effectType: "effect" }
        },
        node
      )
    );
  }
}

function notifyEffectStatus(this: Effect<any>, status?: number, error?: any): void {
  // Use passed values if provided, otherwise read from node
  const actualStatus = status !== undefined ? status : this._statusFlags;
  const actualError = error !== undefined ? error : this._x?._error;
  if (actualStatus & STATUS_ERROR) {
    globalQueue.notify(this, STATUS_PENDING, 0);
    if (this._type === EFFECT_USER) {
      // The error handler is the error arm of the effect phase (#2840 ruling):
      // queue it like the effect function. It runs in the same imperative,
      // writable scope and throws escalate the same way. No payload is queued — the node already carries `_statusFlags`/`_error`,
      // and the runner dispatches on them, so a recovery before the effect
      // phase takes the success arm instead. Blocked forwards (explicit
      // `status` arg without node-state writes) don't queue: the status
      // re-propagates unblocked at commit.
      if (this._statusFlags & STATUS_ERROR) {
        this._modified = true;
        globalQueue.enqueue(this._type, (this._boundRunEffect ??= runEffect.bind(null, this)));
      }
      return;
    }
    if (!globalQueue.notify(this, STATUS_ERROR, STATUS_ERROR)) {
      haltReactivity(unwrapStatusError(actualError));
      throw actualError;
    }
  } else if (this._type === EFFECT_RENDER) {
    globalQueue.notify(this, STATUS_PENDING | STATUS_ERROR, actualStatus, actualError);
    if (__DEV__ && _hitUnhandledAsync && resetUnhandledAsync()) {
      // Async without a `Loading` ancestor is legal (the mount defers), so this
      // is a consistent FYI — an `Errored` above must not swallow it. The old
      // STATUS_ERROR re-notify here dated from when enforcement routed the
      // pending to the error boundary; that both suppressed the warning and
      // showed the error fallback in dev only (#2822). Reported once per
      // mount (resetUnhandledAsync gates), located at the first pending
      // effect's owner path.
      const message =
        "[ASYNC_OUTSIDE_LOADING_BOUNDARY] An async value was read outside a Loading boundary. The root mount will be deferred until all pending async settles.";
      reportDiagnostic(
        emitDiagnostic(
          {
            code: "ASYNC_OUTSIDE_LOADING_BOUNDARY",
            kind: "async",
            severity: "warn",
            message,
            ownerId: this.id,
            ownerName: this._name
          },
          this
        )
      );
    }
  }
}

function runEffect(node: Effect<any>, type: number): void {
  if (!node._modified || node._flags & REACTIVE_DISPOSED) return;
  // A queued run behind a fallback (boundaries.ts) waits for the reveal: a
  // user effect's, which would read a DOM that is not attached, and a render
  // effect's update too (maintainer, 2026-10-02: "we held the queue but let
  // the sync renders through… we definitely shouldn't be showing portals
  // early") — a Portal's or head-tag's render effect writes outside the
  // hidden subtree. The synchronous first render on creation is not a queued
  // run and goes through. `_modified` stays set; the boundary re-queues the
  // run (`release`).
  if (GlobalQueue._heldRun && GlobalQueue._heldRun(node)) return;
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
      if (!globalQueue.notify(node, STATUS_ERROR, STATUS_ERROR)) {
        haltReactivity(error);
        throw error;
      }
    }
    return;
  }
  // Captured before the callback: its own throw errors the node below, but
  // the compute pass that produced `_value` was clean, so its tail still goes.
  const cleanPass = node._x?._error == null;
  let prevStrictRead: string | false = false;
  if (__DEV__) {
    prevStrictRead = setStrictRead("an effect callback");
    setEffectCallback(true);
    enterCallback();
  }
  // Observe tier, like its `effectRunEnd` twin below: the frame the engine
  // opens here is what stamps the callback's writes as the effect's (the
  // cascade an observer reports) and what times the callback (the `effect`
  // record) — facts a production observer needs, not only a dev console.
  if (__OBSERVE__ && attrHooks !== null) attrHooks.effectRunStart(node);
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
    if (!globalQueue.notify(node, STATUS_ERROR, STATUS_ERROR)) {
      haltReactivity(error);
      throw error;
    }
  } finally {
    if (__DEV__) {
      setStrictRead(prevStrictRead);
      setEffectCallback(false);
      exitCallback();
    }
    node._prevValue = node._value;
    node._modified = false;
    // The run applied: this is the frame now, so the dependency tail the
    // compute pass left linked goes (A30, #3438 — `recompute` defers an
    // effect's trim while a run is owed; the twin of `commitPendingNode`'s
    // trim for a staged pass). An errored compute kept its full list with
    // `_depsTail` marking where it stopped; leave it, as the commit does.
    if (cleanPass) trimStaleDeps(node);
  }
  // Outside the try (see the rule in attribution-hooks.ts). Reached whether or
  // not the callback threw — a throw that escapes the catch above halts.
  if (__OBSERVE__ && attrHooks !== null) attrHooks.effectRunEnd(node);
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
    // `_modified` is NOT redundant with the heap: the heap dedups within a
    // pass, but several passes in one flush each enqueue `_run` into the same
    // user queue, and this gate is what collapses them into one run.
    if (!node._modified || node._flags & REACTIVE_DISPOSED) return;
    if (GlobalQueue._heldRun && GlobalQueue._heldRun(node)) return;
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
  // Observe-tier label: the computed literal defaulted its `_name` slot to
  // "computed"; relabel by kind (a store into the slot, not a new field).
  if (__OBSERVE__ && options?.name === undefined) node._name = "trackedEffect";
  // Status dispatch rides the SHARED notifier (statusNotifierOf keys off
  // _type): its error arm is behavior-identical to the closure that used to
  // live here, without the per-node NodeExtension allocation.
  node._run = run;
  // The first run rides the heap like every wake (GlobalQueue._update), so a
  // tracked effect created inside a render-effect callback runs after that
  // pass's staged writes commit, not before.
  enqueueSub(node);
  schedule();

  if (__DEV__ && !node._parent) {
    const message =
      "[NO_OWNER_EFFECT] Effects created outside a reactive context will never be disposed";
    reportDiagnostic(
      emitDiagnostic(
        {
          code: "NO_OWNER_EFFECT",
          kind: "lifecycle",
          severity: "warn",
          message,
          ownerId: node.id,
          ownerName: node._name,
          data: { effectType: "trackedEffect" }
        },
        node
      )
    );
  }
}

// Install the shared effect status notifier (statusNotifierOf serves it to
// every effect node) — module-scope: any bundle that creates effects
// evaluates this module.
setEffectStatusNotify(notifyEffectStatus);
