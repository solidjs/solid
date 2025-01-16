import {
  EFFECT_PURE,
  EFFECT_RENDER,
  EFFECT_USER,
  STATE_CLEAN,
  STATE_DISPOSED
} from "./constants.js";
import { Computation, UNCHANGED, type SignalOptions } from "./core.js";
import { LOADING_BIT } from "./flags.js";
import { getOwner } from "./owner.js";
import { globalQueue, type IQueue } from "./scheduler.js";
import type { SuspenseQueue } from "./suspense.js";

/**
 * Effects are the leaf nodes of our reactive graph. When their sources change, they are
 * automatically added to the queue of effects to re-execute, which will cause them to fetch their
 * sources and recompute
 */
export class Effect<T = any> extends Computation<T> {
  _effect: (val: T, prev: T | undefined) => void;
  _modified: boolean = false;
  _prevValue: T | undefined;
  _type: typeof EFFECT_RENDER | typeof EFFECT_USER;
  _queue: IQueue;
  constructor(
    initialValue: T,
    compute: () => T,
    effect: (val: T, prev: T | undefined) => void,
    options?: SignalOptions<T> & { render?: boolean }
  ) {
    super(initialValue, compute, options);
    this._effect = effect;
    this._prevValue = initialValue;
    this._type = options?.render ? EFFECT_RENDER : EFFECT_USER;
    this._queue = getOwner()?._queue || globalQueue;
    this._updateIfNecessary();
    this._type === EFFECT_USER ? this._queue.enqueue(this._type, this) : this._runEffect();
    if (__DEV__ && !this._parent)
      console.warn("Effects created outside a reactive context will never be disposed");
  }

  override write(value: T, flags = 0): T {
    const currentFlags = this._stateFlags;
    this._stateFlags = flags;
    if (this._type === EFFECT_RENDER && (flags & LOADING_BIT) !== (currentFlags & LOADING_BIT)) {
      (this._queue as SuspenseQueue)._update?.(this);
    }
    if (value === UNCHANGED) return this._value as T;
    this._value = value;
    this._modified = true;

    return value;
  }

  override _notify(state: number): void {
    if (this._state >= state) return;

    if (this._state === STATE_CLEAN) this._queue.enqueue(this._type, this);

    this._state = state;
  }

  override _setError(error: unknown): void {
    this.handleError(error);
  }

  override _disposeNode(): void {
    this._effect = undefined as any;
    this._prevValue = undefined;
    super._disposeNode();
  }

  _runEffect() {
    if (this._modified && this._state !== STATE_DISPOSED) {
      this._effect(this._value!, this._prevValue);
      this._prevValue = this._value;
      this._modified = false;
    }
  }
}

export class EagerComputation<T = any> extends Computation<T> {
  _queue: IQueue;
  constructor(initialValue: T, compute: () => T, options?: SignalOptions<T>) {
    super(initialValue, compute, options);
    this._queue = getOwner()?._queue || globalQueue;
    this._updateIfNecessary();
    if (__DEV__ && !this._parent)
      console.warn("Eager Computations created outside a reactive context will never be disposed");
  }

  override _notify(state: number): void {
    if (this._state >= state) return;

    if (this._state === STATE_CLEAN) this._queue.enqueue(EFFECT_PURE, this);

    super._notify(state);
  }
}
