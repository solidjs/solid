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
import { computed, recompute, setStrictRead, staleValues } from "./core.js";
import { emitDiagnostic } from "./dev.js";
import { StatusError } from "./error.js";
import { cleanup } from "./owner.js";
import { _hitUnhandledAsync, resetUnhandledAsync, setTrackedQueueCallback } from "./scheduler.js";
import type { Computed, NodeOptions, Owner } from "./types.js";

export interface Effect<T> extends Computed<T>, Owner {
  _effectFn: (val: T, prev: T | undefined) => void | (() => void);
  _errorFn?: (err: unknown, cleanup: () => void) => void;
  _cleanup?: () => void;
  _modified: boolean;
  _prevValue: T | undefined;
  _type: number;
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
  let initialized = false;
  const isUser = !!options?.user;
  const node = computed<T>(isUser ? compute : p => staleValues(() => compute(p)), {
    ...options,
    equals: () => {
      node._modified = !node._error;
      if (initialized) node._queue.enqueue(node._type, runEffect.bind(node));
      return false;
    },
    lazy: true
  }) as Effect<T>;
  node._config &= ~CONFIG_AUTO_DISPOSE;
  node._prevValue = undefined;
  node._effectFn = effect;
  node._errorFn = error;
  node._cleanup = undefined;
  node._type = isUser ? EFFECT_USER : EFFECT_RENDER;
  node._notifyStatus = (status?: number, error?: any) => {
    // Use passed values if provided, otherwise read from node
    const actualStatus = status !== undefined ? status : node._statusFlags;
    const actualError = error !== undefined ? error : node._error;
    if (actualStatus & STATUS_ERROR) {
      let err = actualError;
      node._queue.notify(node, STATUS_PENDING, 0);
      if (node._type === EFFECT_USER) {
        try {
          return node._errorFn
            ? node._errorFn(err, () => {
                node._cleanup?.();
                node._cleanup = undefined;
              })
            : console.error(err);
        } catch (e) {
          err = e;
        }
      }
      if (!node._queue.notify(node, STATUS_ERROR, STATUS_ERROR)) throw err;
    } else if (node._type === EFFECT_RENDER) {
      node._queue.notify(node, STATUS_PENDING | STATUS_ERROR, actualStatus, actualError);
      if (__DEV__ && _hitUnhandledAsync) {
        resetUnhandledAsync();
        if (!node._queue.notify(node, STATUS_ERROR, STATUS_ERROR)) {
          const message =
            "[ASYNC_OUTSIDE_LOADING_BOUNDARY] An async value was read outside a Loading boundary. The root mount will be deferred until all pending async settles.";
          emitDiagnostic({
            code: "ASYNC_OUTSIDE_LOADING_BOUNDARY",
            kind: "async",
            severity: "warn",
            message,
            ownerId: node.id,
            ownerName: node._name
          });
          console.warn(message);
        }
      }
    }
  };
  recompute(node, true);
  !options?.defer &&
    (node._type === EFFECT_USER || options?.schedule
      ? node._queue.enqueue(node._type, runEffect.bind(node))
      : runEffect.call(node));
  initialized = true;
  cleanup(() => node._cleanup?.());
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

function runEffect(this: Effect<any>) {
  if (!this._modified || this._flags & REACTIVE_DISPOSED) return;
  let prevStrictRead: string | false = false;
  if (__DEV__) {
    prevStrictRead = setStrictRead("an effect callback");
  }
  this._cleanup?.();
  this._cleanup = undefined;
  try {
    const cleanup = this._effectFn(this._value, this._prevValue);
    if (__DEV__ && cleanup !== undefined && typeof cleanup !== "function") {
      throw new Error(
        `${this._name || "effect"} callback returned an invalid cleanup value. Return a cleanup function or undefined.`
      );
    }
    this._cleanup = cleanup as (() => void) | undefined;
  } catch (error) {
    this._error = new StatusError(this, error);
    this._statusFlags |= STATUS_ERROR;
    if (!this._queue.notify(this, STATUS_ERROR, STATUS_ERROR)) throw error;
  } finally {
    if (__DEV__) setStrictRead(prevStrictRead);
    this._prevValue = this._value;
    this._modified = false;
  }
}

export interface TrackedEffect extends Computed<void> {
  _cleanup?: () => void;
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
      node._cleanup?.();
      node._cleanup = undefined;
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
  node._notifyStatus = (status?: number, error?: any) => {
    const actualStatus = status !== undefined ? status : node._statusFlags;
    if (actualStatus & STATUS_ERROR) {
      node._queue.notify(node, STATUS_PENDING, 0);
      const err = error !== undefined ? error : node._error;
      if (!node._queue.notify(node, STATUS_ERROR, STATUS_ERROR)) throw err;
    }
  };
  node._run = run;
  node._queue.enqueue(EFFECT_USER, run);

  cleanup(() => node._cleanup?.());

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
