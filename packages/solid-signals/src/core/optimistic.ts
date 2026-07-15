/**
 * The optimistic write engine, moved out of core.ts/scheduler.ts. Everything
 * here serves only optimistic overrides — createOptimistic,
 * createOptimisticStore (and its store-node writes), and the verdict layer's
 * companions (which are optimistic nodes). Modules that can create optimistic
 * state call `installOptimisticEngine()` before creating it; apps that never
 * import one of those APIs never retain any of this.
 *
 * Core call sites fire the hooks behind guards on state only this module can
 * create (`_overrideValue !== undefined`, `currentOptimisticLane !== null`,
 * `_optimisticNodes.length`, `activeLanes.size`), so `!` invocations are safe
 * once the gate holds — the same late-binding contract as verdict.ts.
 */
import {
  CONFIG_OWNED_WRITE,
  EFFECT_RENDER,
  EFFECT_TRACKED,
  EFFECT_USER,
  NOT_PENDING,
  REACTIVE_MANUAL_WRITE,
  REACTIVE_OPTIMISTIC_DIRTY,
  REACTIVE_ZOMBIE,
  STATUS_PENDING,
  STATUS_UNINITIALIZED
} from "./constants.js";
import { currentOptimisticLane, latestReadActive, stale } from "./core.js";
import { NotReadyError } from "./error.js";
import { enqueueSub } from "./heap.js";
import { devCheckMergedLaneEmpty, devTrackOptimistic } from "./invariants.js";
import {
  activeLanes,
  assignOrMergeLane,
  findLane,
  getOrCreateLane,
  hasActiveOverride,
  resolveLane,
  resolveTransition,
  signalLanes,
  type OptimisticLane
} from "./lanes.js";
import {
  activeTransition,
  clock,
  dirtyQueue,
  finalizePureQueue,
  GlobalQueue,
  globalQueue,
  insertSubs,
  schedule,
  zombieQueue,
  type QueueCallback,
  type Transition
} from "./scheduler.js";
import type { Computed, Link, Signal } from "./types.js";

type OptimisticNode = Signal<any> | Computed<any>;

// When a background transition is stashed, plain optimistic signals need one
// committed-view rerun. Keep that override local to the stash flush.
let stashedOptimisticReads: Set<Signal<any>> | null = null;

/** The optimistic half of setSignal, fired when `_overrideValue !== undefined`. */
function optimisticWrite<T>(el: Signal<T> | Computed<T>, v: T | ((prev: T) => T)): T {
  const hasOverride = el._overrideValue !== NOT_PENDING;
  const currentValue = hasOverride ? (el._overrideValue as T) : el._value;

  if (typeof v === "function") v = (v as (prev: T) => T)(currentValue);

  const valueChanged =
    !!((el as Computed<T>)._statusFlags & STATUS_UNINITIALIZED) ||
    !el._equals ||
    !el._equals(currentValue, v);
  if (!valueChanged) {
    // Same-value write with an active override still entangles the current
    // action's transition — the hold must outlast all overlapping actions.
    if (hasOverride) {
      const transition = resolveTransition(el as any);
      if (transition && activeTransition !== transition) globalQueue.initTransition(transition);
    }
    return v;
  }

  if (hasOverride) globalQueue.initTransition(resolveTransition(el as any));
  // No revert target is stashed: while the override is active every reader
  // sees it (A17), so authoritative arrivals commit silently into _value and
  // reverting is just dropping the override — _value is already correct.
  else globalQueue._optimisticNodes.push(el);

  const lane = getOrCreateLane(el as Signal<any>);
  el._optimisticLane = lane;

  el._overrideValue = v;
  if (__DEV__) devTrackOptimistic(el);

  GlobalQueue._syncCompanions !== null && GlobalQueue._syncCompanions(el, v);

  el._time = clock;
  insertSubs(el, true);
  schedule();
  return v;
}

function readStashed(node: Signal<any>): boolean {
  return !!stashedOptimisticReads?.has(node);
}

function queueStashedOptimisticEffects(node: Signal<any>): void {
  for (let s = node._subs; s !== null; s = s._nextSub) {
    const sub = s._sub as any;
    if (!sub._type) continue;
    enqueueSub(sub);
  }
}

/**
 * Incomplete-transition finalization when the stashed transition holds
 * optimistic nodes: give plain optimistic signals one committed-view rerun.
 */
function stashOptimistic(stashedTransition: Transition): void {
  stashedOptimisticReads = new Set();
  for (let i = 0; i < stashedTransition._optimisticNodes.length; i++) {
    const node = stashedTransition._optimisticNodes[i];
    if ((node as any)._fn || node._config & CONFIG_OWNED_WRITE) continue;
    stashedOptimisticReads.add(node as Signal<any>);
    queueStashedOptimisticEffects(node as Signal<any>);
  }
  try {
    finalizePureQueue(null, true);
  } finally {
    stashedOptimisticReads = null;
  }
}

/**
 * transitionComplete's override blockage: a settling transition stays open
 * while one of its optimistic nodes holds an active override that is still
 * pending on real (non-affects-sentinel) async.
 */
function transitionBlocked(transition: Transition): boolean {
  for (let i = 0; i < transition._optimisticNodes.length; i++) {
    const node = transition._optimisticNodes[i];
    if (
      hasActiveOverride(node) &&
      "_statusFlags" in node &&
      (node as Computed<any>)._statusFlags & STATUS_PENDING &&
      (node as Computed<any>)._error instanceof NotReadyError &&
      // Mark-sourced pending never blocks settlement: affects() releases AT
      // settle, so counting its sentinel here would deadlock the window it
      // is scoped to.
      !(((node as Computed<any>)._error as NotReadyError).source as Computed<any> | undefined)
        ?._affectsFor
    ) {
      return true;
    }
  }
  return false;
}

function resolveOptimisticNodes(nodes: OptimisticNode[]): void {
  // Settlement writes below (snapCompanionsToState → updatePendingSignal-style
  // notifications) may push fresh optimistic nodes; only this batch settles
  // now, so iterate a fixed window and splice it out at the end.
  const len = nodes.length;
  for (let i = 0; i < len; i++) {
    const node = nodes[i];
    node._optimisticLane = undefined;
    // Revert is a pure drop: there is no revert target to commit —
    // override-covered authoritative values hold in _pendingValue and
    // elevate on their OWN transition's schedule (A18 as re-ruled 2026-07-07).
    if (!((node as any)._statusFlags & STATUS_PENDING))
      (node as any)._statusFlags &= ~STATUS_UNINITIALIZED;
    const prevOverride = node._overrideValue;
    node._overrideValue = NOT_PENDING;
    if (prevOverride !== NOT_PENDING && node._value !== prevOverride) insertSubs(node, true);
    node._transition = null;
  }
  // Settlement checkpoint (#2838): companions caught in this batch (or owned
  // by a node in it) re-derive from committed state, so verdicts survive the
  // transition that produced them (A19 — pending is a property of the data).
  for (let i = 0; i < len; i++) {
    const node = nodes[i];
    if (node._pendingSignal || node._latestValueComputed) GlobalQueue._snapCompanions!(node);
    const owner = node._parentSource;
    if (owner && (owner._pendingSignal === node || owner._latestValueComputed === node))
      GlobalQueue._snapCompanions!(owner);
  }
  nodes.splice(0, len);
}

function runQueue(queue: QueueCallback[], type: number): void {
  for (let i = 0; i < queue.length; i++) queue[i](type);
}

/**
 * Run effects from all lanes that are ready (no pending async).
 */
function runLaneEffects(type: number): void {
  for (const lane of activeLanes) {
    if (__DEV__) devCheckMergedLaneEmpty(lane);
    if (lane._mergedInto || lane._pendingAsync.size > 0) continue;
    const effects = lane._effectQueues[type - 1];
    if (effects.length) {
      lane._effectQueues[type - 1] = [];
      runQueue(effects, type);
    }
  }
}

function cleanupCompletedLanes(completingTransition: Transition | null): void {
  for (const lane of activeLanes) {
    const owned = completingTransition
      ? lane._transition === completingTransition
      : !lane._transition;
    if (!owned) continue;
    if (!lane._mergedInto) {
      if (lane._effectQueues[0].length) runQueue(lane._effectQueues[0], EFFECT_RENDER);
      if (lane._effectQueues[1].length) runQueue(lane._effectQueues[1], EFFECT_USER);
    }
    if (lane._source._optimisticLane === lane) lane._source._optimisticLane = undefined;
    lane._pendingAsync.clear();
    lane._effectQueues[0].length = 0;
    lane._effectQueues[1].length = 0;
    activeLanes.delete(lane);
    signalLanes.delete(lane._source);
  }
}

/** read()'s per-lane suspension test (pending-throw path, lane context). */
function laneSuspends(owner: OptimisticNode): boolean {
  // Per-lane suspension: only throw if in same lane as pending async
  // AND the node doesn't have an active override (overrides are the visible value,
  // downstream in the lane should read the override, not throw)
  const pendingLane = (owner as any)._optimisticLane as OptimisticLane | undefined;
  if (!pendingLane) return false;
  return findLane(pendingLane) === findLane(currentOptimisticLane!) && !hasActiveOverride(owner);
}

/**
 * read()'s entanglement gate: a reader recomputing under an optimistic lane
 * that reads a pending mid-transition write sees the committed value; the sub
 * is recorded for replay at commit.
 */
function gatedRead(el: Signal<any>, owner: OptimisticNode, c: Computed<any>): boolean {
  if (
    latestReadActive ||
    el._pendingValue === NOT_PENDING ||
    (el as Partial<Computed<unknown>>)._fn ||
    (owner !== el && !((owner as Computed<unknown>)._flags & REACTIVE_MANUAL_WRITE))
  ) {
    return false;
  }
  activeTransition!._gatedSubs.add(c);
  return true;
}

/**
 * read()'s value selection under a lane: return the committed `_value` for
 * optimistic/lane-assigned signals, stale-mode reads, and pending owners.
 */
function laneReadsCommitted(el: OptimisticNode, owner: OptimisticNode, c: Computed<any>): boolean {
  return (
    el._overrideValue !== undefined ||
    !!(el as any)._optimisticLane ||
    (owner === el && stale && (c as Computed<any>)._parentSource !== el) ||
    !!((owner as Computed<any>)._statusFlags & STATUS_PENDING)
  );
}

/**
 * recompute()'s lane posture: resolve the node's own lane (own=true), or adopt
 * a dependency's optimistic lane (own=false — parent-deeper-than-owned-child
 * can run before its OPT-dirty child propagates).
 */
function recomputeLane(el: Computed<any>, own: boolean): OptimisticLane | null {
  if (own) return resolveLane(el) ?? null;
  for (let d: Link | null = el._deps; d; d = d._nextDep) {
    const dep = d._dep as Computed<any>;
    if (dep._flags & REACTIVE_OPTIMISTIC_DIRTY) {
      const depLane = resolveLane(dep);
      if (depLane) {
        el._flags |= REACTIVE_OPTIMISTIC_DIRTY;
        assignOrMergeLane(el as any, depLane);
        return depLane;
      }
    }
  }
  return null;
}

/** recompute()'s catch path: track pending async in the current lane. */
function laneAsyncPending(el: Computed<any>): void {
  const lane = findLane(currentOptimisticLane!);
  if (lane._source !== el) {
    lane._pendingAsync.add(el);
    el._optimisticLane = lane;
    GlobalQueue._updatePendingSignal !== null && GlobalQueue._updatePendingSignal(lane._source);
  }
}

/** recompute()'s success path: the node's async settled, clear it from its lane. */
function laneAsyncSettled(el: Computed<any>): void {
  const resolvedLane = resolveLane(el);
  if (resolvedLane) {
    resolvedLane._pendingAsync.delete(el);
    GlobalQueue._updatePendingSignal !== null &&
      GlobalQueue._updatePendingSignal(resolvedLane._source);
  }
}

function trackOptimisticStore(store: any): void {
  // After initTransition, globalQueue._optimisticStores IS activeTransition._optimisticStores (same reference)
  globalQueue._optimisticStores.add(store);
  schedule();
}

/**
 * Installs the engine's hooks. Idempotent; called by every module that can
 * create optimistic state (verdict.ts at module top level, createOptimistic
 * and createOptimisticStore at first call) BEFORE any optimistic node exists.
 */
export function installOptimisticEngine(): void {
  if (GlobalQueue._optimisticWrite !== null) return;
  GlobalQueue._optimisticWrite = optimisticWrite;
  GlobalQueue._resolveOptimistic = resolveOptimisticNodes;
  GlobalQueue._stashOptimistic = stashOptimistic;
  GlobalQueue._transitionBlocked = transitionBlocked;
  GlobalQueue._cleanupLanes = cleanupCompletedLanes;
  GlobalQueue._runLaneEffects = runLaneEffects;
  GlobalQueue._readStashed = readStashed;
  GlobalQueue._gatedRead = gatedRead;
  GlobalQueue._laneSuspends = laneSuspends;
  GlobalQueue._laneReadsCommitted = laneReadsCommitted;
  GlobalQueue._recomputeLane = recomputeLane;
  GlobalQueue._laneAsyncPending = laneAsyncPending;
  GlobalQueue._laneAsyncSettled = laneAsyncSettled;
  GlobalQueue._trackOptimisticStore = trackOptimisticStore;
}
