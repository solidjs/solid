import { STATE_CLEAN, STATE_DISPOSED } from './constants';
import { Computation, UNCHANGED, compute, type MemoOptions } from './core';
import { type Owner } from './owner';

let scheduledEffects = false,
  runningEffects = false,
  renderEffects: RenderEffect[] = [],
  effects: Effect[] = [];

/**
 * By default, changes are batched on the microtask queue which is an async process. You can flush
 * the queue synchronously to get the latest updates by calling `flushSync()`.
 */
export function flushSync(): void {
  if (!runningEffects) runEffects();
}

function flushEffects() {
  scheduledEffects = true;
  queueMicrotask(runEffects);
}

/**
 * When re-executing nodes, we want to be extra careful to avoid double execution of nested owners
 * In particular, it is important that we check all of our parents to see if they will rerun
 * See tests/createEffect: "should run parent effect before child effect" and "should run parent
 * memo before child effect"
 */
function runTop(node: Computation): void {
  const ancestors: Computation[] = [];

  for (
    let current: Owner | null = node;
    current !== null;
    current = current._parent
  ) {
    if (current._state !== STATE_CLEAN) {
      ancestors.push(current as Computation);
    }
  }

  for (let i = ancestors.length - 1; i >= 0; i--) {
    if (ancestors[i]._state !== STATE_DISPOSED)
      ancestors[i]._updateIfNecessary();
  }
}

function runEffects() {
  if (!effects.length && !renderEffects.length) {
    scheduledEffects = false;
    return;
  }

  runningEffects = true;

  try {
    for (let i = 0; i < renderEffects.length; i++) {
      if (renderEffects[i]._state !== STATE_CLEAN) {
        runTop(renderEffects[i]);
      }
    }
    for (let i = 0; i < effects.length; i++) {
      if (effects[i]._state !== STATE_CLEAN) {
        runTop(effects[i]);
      }
    }
    for (let i = 0; i < renderEffects.length; i++) {
      if (
        renderEffects[i].modified &&
        renderEffects[i]._state !== STATE_DISPOSED
      ) {
        compute(renderEffects[i], renderEffects[i].effect, renderEffects[i]);
        renderEffects[i].modified = false;
      }
    }
    for (let i = 0; i < effects.length; i++) {
      if (
        effects[i].modified &&
        effects[i]._state !== STATE_DISPOSED
      ) {
        compute(effects[i], effects[i].effect, effects[i]);
        effects[i].modified = false;
      }
    }
  } finally {
    effects = [];
    renderEffects = [];
    scheduledEffects = false;
    runningEffects = false;
  }
}

/**
 * Effects are the leaf nodes of our reactive graph. When their sources change, they are
 * automatically added to the queue of effects to re-execute, which will cause them to fetch their
 * sources and recompute
 */
class BaseEffect<T = any> extends Computation<T> {
  effect: (val: T) => void;
  modified: boolean = false;
  constructor(
    initialValue: T,
    compute: () => T,
    effect: (val: T) => void,
    options?: MemoOptions<T>,
  ) {
    super(initialValue, compute, options);
    this.effect = effect;
  }

  override write(value: T): T {
    if (value === UNCHANGED) return this._value as T;
    this._value = value;
    this.modified = true;

    return value;
  }

  override _setError(error: unknown): void {
    this.handleError(error);
  }
}

export class Effect<T = any> extends BaseEffect<T> {
  constructor(
    initialValue: T,
    compute: () => T,
    effect: (val: T) => void,
    options?: MemoOptions<T>,
  ) {
    super(initialValue, compute, effect, options);
    effects.push(this);
    flushEffects();
  }

  override _notify(state: number): void {
    if (this._state >= state) return;

    if (this._state === STATE_CLEAN) {
      effects.push(this);
      if (!scheduledEffects) flushEffects();
    }

    this._state = state;
  }
}

export class RenderEffect<T = any> extends BaseEffect<T> {
  constructor(
    initialValue: T,
    compute: () => T,
    effect: (val: T) => void,
    options?: MemoOptions<T>,
  ) {
    super(initialValue, compute, effect, options);
    this._updateIfNecessary();
    renderEffects.push(this);
  }

  override _notify(state: number): void {
    if (this._state >= state) return;

    if (this._state === STATE_CLEAN) {
      renderEffects.push(this);
      if (!scheduledEffects) flushEffects();
    }

    this._state = state;
  }
}
