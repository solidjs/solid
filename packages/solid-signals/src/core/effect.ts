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
import { ERROR_BIT, LOADING_BIT, type Flags } from "./flags.js";
import type { Owner } from "./owner.js";
import { ActiveTransition, clock, getQueue } from "./scheduler.js";

/**
 * Effects are the leaf nodes of our reactive graph. When their sources change, they are
 * automatically added to the queue of effects to re-execute, which will cause them to fetch their
 * sources and recompute
 */
export class Effect<T = any> extends Computation<T> {
  _effect: (val: T, prev: T | undefined) => void | (() => void);
  _onerror: ((err: unknown, cleanup: () => void) => void) | undefined;
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
      this._compute = function (p) {
        return !this._cloned && clock > this._queue.created && !(this._stateFlags & ERROR_BIT)
          ? latest(() => compute(p))
          : compute(p);
      };
    }
    this._updateIfNecessary();
    !options?.defer &&
      (this._type === EFFECT_USER
        ? getQueue(this).enqueue(this._type, this._run.bind(this))
        : this._run(this._type));
    if (__DEV__ && !this._parent)
      console.warn("Effects created outside a reactive context will never be disposed");
  }

  override write(value: T, flags = 0): T {
    if (this._state == STATE_DIRTY) {
      this._stateFlags = flags;
      if (this._type === EFFECT_RENDER) {
        getQueue(this).notify(this, LOADING_BIT | ERROR_BIT, this._stateFlags);
      }
    }
    if (value === UNCHANGED) return this._value as T;
    this._value = value;
    this._modified = true;
    this._error = undefined;

    return value;
  }

  override _notify(state: number, skipQueue?: boolean): void {
    if (this._state >= state || skipQueue) return;

    if (this._state === STATE_CLEAN || (this._cloned && !ActiveTransition))
      getQueue(this).enqueue(this._type, this._run.bind(this));

    this._state = state;
  }

  override _notifyFlags(mask: Flags, newFlags: Flags): void {
    if (this._cloned) {
      if (this._state >= STATE_DIRTY) return;
      if (mask & 3) {
        this._notify(STATE_DIRTY);
        return;
      }
    }
    super._notifyFlags(mask, newFlags);
  }

  override _setError(error: unknown): void {
    this._error = error;
    getQueue(this).notify(this, LOADING_BIT, 0);
    this._stateFlags = ERROR_BIT;
    if (this._type === EFFECT_USER) {
      try {
        return this._onerror
          ? this._onerror(error, () => {
              this._cleanup?.();
              this._cleanup = undefined;
            })
          : console.error(error);
      } catch (e) {
        error = e;
      }
    }
    if (!getQueue(this).notify(this, ERROR_BIT, ERROR_BIT)) throw error;
  }

  override _disposeNode(): void {
    if (this._state === STATE_DISPOSED) return;
    this._effect = undefined as any;
    this._prevValue = undefined;
    this._onerror = undefined as any;
    this._cleanup?.();
    this._cleanup = undefined;
    getQueue(this).notify(this, ERROR_BIT | LOADING_BIT, 0);
    super._disposeNode();
  }

  _run(type: number): void {
    if (type) {
      const effect: Effect = (this._cloned as Effect) || this;
      if (effect._modified && effect._state !== STATE_DISPOSED) {
        effect._cleanup?.();
        try {
          effect._cleanup = effect._effect(effect._value!, effect._prevValue) as any;
        } catch (e) {
          if (!getQueue(effect).notify(effect, ERROR_BIT, ERROR_BIT)) throw e;
        } finally {
          effect._prevValue = effect._value;
          effect._modified = false;
        }
      }
    } else this._state !== STATE_CLEAN && runTop(this);
  }
}

export class TrackedEffect extends Computation {
  _type = EFFECT_USER;
  _cleanup: (() => void) | undefined;
  constructor(
    compute: () => void | (() => void),
    options?: SignalOptions<undefined>
  ) {
    super(undefined, () => {
      this._cleanup?.();
      this._cleanup = latest(compute) as (() => void) | undefined;
      return undefined;
    }, options);
    getQueue(this).enqueue(this._type, this._run.bind(this));
    if (__DEV__ && !this._parent)
      console.warn("Effects created outside a reactive context will never be disposed");
  }
  override _notify(state: number, skipQueue?: boolean): void {
    if (this._state >= state || skipQueue) return;

    if (this._state === STATE_CLEAN || (this._cloned && !ActiveTransition))
      getQueue(this).enqueue(this._type, this._run.bind(this));

    this._state = state;
  }

  override _disposeNode(): void {
    if (this._state === STATE_DISPOSED) return;
    this._cleanup?.();
    this._cleanup = undefined;
    getQueue(this).notify(this, ERROR_BIT | LOADING_BIT, 0);
    super._disposeNode();
  }

  _run(type: number): void {
    if (type) this._state !== STATE_CLEAN && runTop(this);
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

    if (
      !skipQueue &&
      (this._state === STATE_CLEAN || (this._state === STATE_CHECK && this._forceNotify))
    )
      getQueue(this).enqueue(EFFECT_PURE, this._run.bind(this));

    super._notify(state, skipQueue);
  }

  _run(): void {
    this._state !== STATE_CLEAN && runTop(this);
  }
}

export class FirewallComputation extends Computation {
  firewall = true;
  constructor(compute: () => void) {
    super(undefined, compute);
    if (__DEV__ && !this._parent)
      console.warn("Eager Computations created outside a reactive context will never be disposed");
  }
  _notify(state: number, skipQueue?: boolean): void {
    if (this._state >= state && !this._forceNotify) return;

    if (
      !skipQueue &&
      (this._state === STATE_CLEAN || (this._state === STATE_CHECK && this._forceNotify))
    )
      getQueue(this).enqueue(EFFECT_PURE, this._run.bind(this));

    super._notify(state, true);
    this._forceNotify = !!skipQueue; // they don't need to be forced themselves unless from above
  }
  _run(): void {
    const prevFlags = this._stateFlags;
    this._state !== STATE_CLEAN && runTop(this);
    if (ActiveTransition && this._optimistic && (this._stateFlags !== prevFlags || this._stateFlags !== (this._optimistic as any).flags)) {
      getQueue(this).notify(this, LOADING_BIT | ERROR_BIT, this._stateFlags);
      (this._optimistic as any).flags = this._stateFlags;
      this._stateFlags = prevFlags
    }
  }
}

/**
 * When re-executing nodes, we want to be extra careful to avoid double execution of nested owners
 * In particular, it is important that we check all of our parents to see if they will rerun
 * See tests/createEffect: "should run parent effect before child effect" and "should run parent
 * memo before child effect"
 */
function runTop(node: Computation): void {
  const ancestors: Computation[] = [];

  for (let current: Owner | null = node; current !== null; current = current._parent) {
    if (ActiveTransition && (current as any)._transition)
      current = ActiveTransition._sources.get(current as any)!;
    if (current._state !== STATE_CLEAN) {
      ancestors.push(current as Computation);
    }
  }

  for (let i = ancestors.length - 1; i >= 0; i--) {
    if (ancestors[i]._state !== STATE_DISPOSED) ancestors[i]._updateIfNecessary();
  }
}
