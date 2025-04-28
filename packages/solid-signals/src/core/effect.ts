import {
  EFFECT_PURE,
  EFFECT_RENDER,
  EFFECT_USER,
  STATE_CHECK,
  STATE_CLEAN,
  STATE_DIRTY,
  STATE_DISPOSED
} from "./constants.js";
import { Computation, latest, UNCHANGED, type SignalOptions } from "./core.js";
import { EffectError } from "./error.js";
import { ERROR_BIT, LOADING_BIT } from "./flags.js";
import { getClock } from "./scheduler.js";

/**
 * Effects are the leaf nodes of our reactive graph. When their sources change, they are
 * automatically added to the queue of effects to re-execute, which will cause them to fetch their
 * sources and recompute
 */
export class Effect<T = any> extends Computation<T> {
  _effect: (val: T, prev: T | undefined) => void | (() => void);
  _onerror: ((err: unknown) => void | (() => void)) | undefined;
  _cleanup: (() => void) | undefined;
  _modified: boolean = false;
  _prevValue: T | undefined;
  _type: typeof EFFECT_RENDER | typeof EFFECT_USER;
  constructor(
    initialValue: T,
    compute: (val?: T) => T,
    effect: (val: T, prev: T | undefined) => void | (() => void),
    error?: (err: unknown) => void | (() => void),
    options?: SignalOptions<T> & { render?: boolean; defer?: boolean }
  ) {
    super(initialValue, compute, options);
    this._effect = effect;
    this._onerror = error;
    this._prevValue = initialValue;
    this._type = options?.render ? EFFECT_RENDER : EFFECT_USER;
    if (this._type === EFFECT_RENDER) {
      this._compute = p =>
        getClock() > this._queue.created && !(this._stateFlags & ERROR_BIT)
          ? latest(() => compute(p))
          : compute(p);
    }
    this._updateIfNecessary();
    !options?.defer &&
      (this._type === EFFECT_USER ? this._queue.enqueue(this._type, this) : this._runEffect());
    if (__DEV__ && !this._parent)
      console.warn("Effects created outside a reactive context will never be disposed");
  }

  override write(value: T, flags = 0): T {
    if (this._state == STATE_DIRTY) {
      const currentFlags = this._stateFlags;
      this._stateFlags = flags;
      if (this._type === EFFECT_RENDER) {
        this._queue.notify(this, LOADING_BIT | ERROR_BIT, flags);
      }
    }
    if (value === UNCHANGED) return this._value as T;
    this._value = value;
    this._modified = true;

    return value;
  }

  override _notify(state: number, skipQueue?: boolean): void {
    if (this._state >= state || skipQueue) return;

    if (this._state === STATE_CLEAN) this._queue.enqueue(this._type, this);

    this._state = state;
  }

  override _setError(error: unknown): void {
    this._error = error;
    this._cleanup?.();
    this._queue.notify(this, LOADING_BIT, 0);
    this._stateFlags = ERROR_BIT;
    if (this._type === EFFECT_USER) {
      try {
        return this._onerror
          ? (this._cleanup = this._onerror(error) as any)
          : console.error(new EffectError(this._effect, error));
      } catch (e) {
        error = e;
      }
    }
    if (!this._queue.notify(this, ERROR_BIT, ERROR_BIT)) throw error;
  }

  override _disposeNode(): void {
    if (this._state === STATE_DISPOSED) return;
    this._effect = undefined as any;
    this._prevValue = undefined;
    this._onerror = undefined as any;
    this._cleanup?.();
    this._cleanup = undefined;
    super._disposeNode();
  }

  _runEffect() {
    if (this._modified && this._state !== STATE_DISPOSED) {
      this._cleanup?.();
      try {
        this._cleanup = this._effect(this._value!, this._prevValue) as any;
      } catch (e) {
        if (!this._queue.notify(this, ERROR_BIT, ERROR_BIT)) throw e;
      } finally {
        this._prevValue = this._value;
        this._modified = false;
      }
    }
  }
}

export class EagerComputation<T = any> extends Computation<T> {
  constructor(initialValue: T, compute: () => T, options?: SignalOptions<T> & { defer?: boolean }) {
    super(initialValue, compute, options);
    !options?.defer && this._updateIfNecessary();
    if (__DEV__ && !this._parent)
      console.warn("Eager Computations created outside a reactive context will never be disposed");
  }

  override _notify(state: number, skipQueue?: boolean): void {
    if (this._state >= state && !this._forceNotify) return;

    if (this._state === STATE_CLEAN && !skipQueue) this._queue.enqueue(EFFECT_PURE, this);

    super._notify(state, skipQueue);
  }
}

export class ProjectionComputation extends Computation {
  constructor(compute: () => void) {
    super(undefined, compute);
    if (__DEV__ && !this._parent)
      console.warn("Eager Computations created outside a reactive context will never be disposed");
  }
  _notify(state: number, skipQueue?: boolean): void {
    if (this._state >= state && !this._forceNotify) return;

    if (!skipQueue && (this._state === STATE_CLEAN || (this._state === STATE_CHECK && this._forceNotify))) this._queue.enqueue(EFFECT_PURE, this);

    super._notify(state, true);
  }
}
