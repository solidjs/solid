import {
  EFFECT_PURE,
  EFFECT_RENDER,
  EFFECT_USER,
  STATE_CLEAN,
  STATE_DIRTY,
  STATE_DISPOSED
} from "./constants.js";
import { Computation, latest, UNCHANGED, type SignalOptions } from "./core.js";
import { EffectError } from "./error.js";
import { LOADING_BIT } from "./flags.js";
import type { SuspenseQueue } from "./suspense.js";

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
      this._compute = p => latest(() => compute(p));
    }
    if (!options?.defer) {
      this._updateIfNecessary();
      this._type === EFFECT_USER ? this._queue.enqueue(this._type, this) : this._runEffect();
    }
    if (__DEV__ && !this._parent)
      console.warn("Effects created outside a reactive context will never be disposed");
  }

  override write(value: T, flags = 0): T {
    if (this._state == STATE_DIRTY) {
      const currentFlags = this._stateFlags;
      this._stateFlags = flags;
      if (this._type === EFFECT_RENDER && (flags & LOADING_BIT) !== (currentFlags & LOADING_BIT)) {
        (this._queue as SuspenseQueue)._update?.(this);
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
    this._cleanup?.();
    if (this._stateFlags & LOADING_BIT) {
      this._stateFlags = 0; // Clear loading bit
      (this._queue as SuspenseQueue)._update?.(this);
    }
    if (this._type === EFFECT_USER) {
      try {
        return this._onerror
          ? (this._cleanup = this._onerror(error) as any)
          : console.error(new EffectError(this._effect, error));
      } catch (e) {
        error = e;
      }
    }
    this.handleError(error);
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
        this.handleError(e);
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
    super(null, compute);
    if (__DEV__ && !this._parent)
      console.warn("Eager Computations created outside a reactive context will never be disposed");
  }
  _notify(state: number, skipQueue?: boolean): void {
    if (this._state >= state && !this._forceNotify) return;

    if (this._state === STATE_CLEAN && !skipQueue) this._queue.enqueue(EFFECT_PURE, this);

    super._notify(state, true);
  }
}
