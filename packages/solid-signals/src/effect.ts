import { STATE_CLEAN, STATE_DISPOSED } from './constants';
import { Computation, incrementClock, UNCHANGED, type SignalOptions } from './core';
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
    runPureQueue(renderEffects);
    runPureQueue(effects);
    incrementClock();
    runEffectQueue(renderEffects);
    runEffectQueue(effects);
  } finally {
    effects = [];
    renderEffects = [];
    scheduledEffects = false;
    runningEffects = false;
  }
}

function runPureQueue(queue: Computation[]) {
  for (let i = 0; i < queue.length; i++) {
    if (queue[i]._state !== STATE_CLEAN) runTop(queue[i]);
  }
}

function runEffectQueue(queue: BaseEffect[]) {
  for (let i = 0; i < queue.length; i++) {
    if (
      queue[i]._modified &&
      queue[i]._state !== STATE_DISPOSED
    ) {
      queue[i]._effect(queue[i]._value, queue[i]._prevValue);
      queue[i]._modified = false;
      queue[i]._prevValue = queue[i]._value;
    }
  }
}

/**
 * Effects are the leaf nodes of our reactive graph. When their sources change, they are
 * automatically added to the queue of effects to re-execute, which will cause them to fetch their
 * sources and recompute
 */
class BaseEffect<T = any> extends Computation<T> {
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
    effect: (val: T, prev: T | undefined) => void,
    options?: SignalOptions<T>,
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
