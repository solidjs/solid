import {
  EFFECT_RENDER,
  EFFECT_TRACKED,
  EFFECT_USER,
  REACTIVE_DISPOSED,
  STATUS_ERROR,
  STATUS_PENDING
} from "./constants.js";
import { computed, onCleanup, recompute, staleValues } from "./core.js";
import type { Computed, NodeOptions, Owner } from "./types.js";

export let leafEffectActive = false;

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
  initialValue?: T,
  options?: NodeOptions<any> & { render?: boolean; defer?: boolean }
): void {
  let initialized = false;
  const node = computed<T>(
    options?.render ? p => staleValues(() => compute(p)) : compute,
    initialValue,
    {
      ...options,
      equals: () => {
        node._modified = !node._error;
        if (initialized) node._queue.enqueue(node._type, runEffect.bind(node));
        return false;
      },
      lazy: true
    }
  ) as Effect<T>;
  node._prevValue = initialValue;
  node._effectFn = effect;
  node._errorFn = error;
  node._cleanup = undefined;
  node._type = options?.render ? EFFECT_RENDER : EFFECT_USER;
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
    } else if (node._type === EFFECT_RENDER)
      node._queue.notify(node, STATUS_PENDING | STATUS_ERROR, actualStatus, actualError);
  };
  recompute(node, true);
  !options?.defer &&
    (node._type === EFFECT_USER
      ? node._queue.enqueue(node._type, runEffect.bind(node))
      : runEffect.call(node));
  initialized = true;
  onCleanup(() => node._cleanup?.());
  if (__DEV__ && !node._parent)
    console.warn("Effects created outside a reactive context will never be disposed");
}

function runEffect(this: Effect<any>) {
  if (!this._modified || this._flags & REACTIVE_DISPOSED) return;
  this._cleanup?.();
  this._cleanup = undefined;
  try {
    this._cleanup = this._effectFn(this._value, this._prevValue) as any;
  } catch (error) {
    if (!this._queue.notify(this, STATUS_ERROR, STATUS_ERROR)) throw error;
  } finally {
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
 * Children forbidden (__DEV__ throws). Uses stale reads.
 */
export function trackedEffect(fn: () => void | (() => void), options?: NodeOptions<any>): void {
  const run = () => {
    if (!node._modified || node._flags & REACTIVE_DISPOSED) return;
    node._modified = false;
    recompute(node);
  };

  const node = computed<void>(
    () => {
      leafEffectActive = true;
      try {
        node._cleanup?.();
        node._cleanup = undefined;
        node._cleanup = staleValues(fn) || undefined;
      } finally {
        leafEffectActive = false;
      }
    },
    undefined,
    { ...options, lazy: true, pureWrite: true }
  ) as TrackedEffect;

  node._cleanup = undefined;
  node._modified = true;
  node._type = EFFECT_TRACKED;
  node._run = run;
  node._queue.enqueue(EFFECT_USER, run);

  onCleanup(() => node._cleanup?.());

  if (__DEV__ && !node._parent)
    console.warn("Effects created outside a reactive context will never be disposed");
}
