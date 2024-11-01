import { STATE_CLEAN, STATE_DISPOSED } from "./constants";
import { Computation, incrementClock } from "./core";
import type { BaseEffect, Effect, RenderEffect } from "./effect";
import type { Owner } from "./owner";

let scheduled = false,
  runningScheduled = false;

export let Computations: Computation[] = [],
  RenderEffects: RenderEffect[] = [],
  Effects: Effect[] = [];

/**
 * By default, changes are batched on the microtask queue which is an async process. You can flush
 * the queue synchronously to get the latest updates by calling `flushSync()`.
 */
export function flushSync(): void {
  if (!runningScheduled) runScheduled();
}

export function flushQueue() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(runScheduled);
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
    if (current._state !== STATE_CLEAN) {
      ancestors.push(current as Computation);
    }
  }

  for (let i = ancestors.length - 1; i >= 0; i--) {
    if (ancestors[i]._state !== STATE_DISPOSED) ancestors[i]._updateIfNecessary();
  }
}

function runScheduled() {
  if (!Effects.length && !RenderEffects.length && !Computations.length) {
    scheduled = false;
    return;
  }
  runningScheduled = true;
  try {
    runPureQueue(Computations);
    runPureQueue(RenderEffects);
    runPureQueue(Effects);
  } finally {
    const renderEffects = RenderEffects;
    const effects = Effects;
    Computations = [];
    Effects = [];
    RenderEffects = [];
    scheduled = false;
    runningScheduled = false;
    incrementClock();
    runEffectQueue(renderEffects);
    runEffectQueue(effects);
  }
}

function runPureQueue(queue: Computation[]) {
  for (let i = 0; i < queue.length; i++) {
    if (queue[i]._state !== STATE_CLEAN) runTop(queue[i]);
  }
}

function runEffectQueue(queue: BaseEffect[]) {
  for (let i = 0; i < queue.length; i++) {
    if (queue[i]._modified && queue[i]._state !== STATE_DISPOSED) {
      queue[i]._effect(queue[i]._value, queue[i]._prevValue);
      queue[i]._modified = false;
      queue[i]._prevValue = queue[i]._value;
    }
  }
}
