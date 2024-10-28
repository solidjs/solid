import { STATE_CLEAN } from './constants';
import { Computation, UNCHANGED, type SignalOptions } from './core';
import { Effects, flushQueue, RenderEffects } from './scheduler';

/**
 * Effects are the leaf nodes of our reactive graph. When their sources change, they are
 * automatically added to the queue of effects to re-execute, which will cause them to fetch their
 * sources and recompute
 */
export class BaseEffect<T = any> extends Computation<T> {
  _effect: (val: T, prev: T | undefined) => void;
  _modified: boolean = false;
  _prevValue: T | undefined;
  constructor(
    initialValue: T,
    compute: () => T,
    effect: (val: T, prev: T | undefined) => void,
    options?: SignalOptions<T>,
  ) {
    super(initialValue, compute, options);
    this._effect = effect;
    this._prevValue = initialValue;
  }

  override write(value: T): T {
    if (value === UNCHANGED) return this._value as T;
    this._value = value;
    this._modified = true;

    return value;
  }

  override _setError(error: unknown): void {
    this.handleError(error);
  }

  override _disposeNode(): void {
    this._effect = undefined as any;
    this._prevValue = undefined;
    super._disposeNode();
  }
}

export class Effect<T = any> extends BaseEffect<T> {
  constructor(
    initialValue: T,
    compute: () => T,
    effect: (val: T, prev: T | undefined) => void,
    options?: SignalOptions<T>,
  ) {
    super(initialValue, compute, effect, options);
    Effects.push(this);
    flushQueue();
  }

  override _notify(state: number): void {
    if (this._state >= state) return;

    if (this._state === STATE_CLEAN) {
      Effects.push(this);
      flushQueue();
    }

    this._state = state;
  }
}

export class RenderEffect<T = any> extends BaseEffect<T> {
  constructor(
    initialValue: T,
    compute: () => T,
    effect: (val: T, prev: T | undefined) => void,
    options?: SignalOptions<T>,
  ) {
    super(initialValue, compute, effect, options);
    this._updateIfNecessary();
    RenderEffects.push(this);
  }

  override _notify(state: number): void {
    if (this._state >= state) return;

    if (this._state === STATE_CLEAN) {
      RenderEffects.push(this);
      flushQueue();
    }

    this._state = state;
  }
}
