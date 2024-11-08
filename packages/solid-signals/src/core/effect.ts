import { STATE_CLEAN } from "./constants.js";
import { Computation, UNCHANGED, type SignalOptions } from "./core.js";
import { Effects, flushQueue, RenderEffects } from "./scheduler.js";

const USER_EFFECT = 0;
const RENDER_EFFECT = 1;

/**
 * Effects are the leaf nodes of our reactive graph. When their sources change, they are
 * automatically added to the queue of effects to re-execute, which will cause them to fetch their
 * sources and recompute
 */
export class Effect<T = any> extends Computation<T> {
  _effect: (val: T, prev: T | undefined) => void;
  _modified: boolean = false;
  _prevValue: T | undefined;
  _type: 0 | 1;
  constructor(
    initialValue: T,
    compute: () => T,
    effect: (val: T, prev: T | undefined) => void,
    options?: SignalOptions<T> & { render?: boolean }
  ) {
    super(initialValue, compute, options);
    this._effect = effect;
    this._prevValue = initialValue;
    this._updateIfNecessary();
    this._type = options?.render ? RENDER_EFFECT : USER_EFFECT;
    (this._type ? RenderEffects : Effects) .push(this);
  }

  override write(value: T): T {
    if (value === UNCHANGED) return this._value as T;
    this._value = value;
    this._modified = true;

    return value;
  }

  override _notify(state: number): void {
    if (this._state >= state) return;

    if (this._state === STATE_CLEAN) {
      (this._type ? RenderEffects : Effects).push(this);
      flushQueue();
    }

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
}