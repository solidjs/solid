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
  EFFECT_RENDER,
  EFFECT_USER,
  NOT_PENDING,
  OVERRIDE_UNDEFINED,
  REACTIVE_MANUAL_WRITE,
  unwrapOverride,
  REACTIVE_OPTIMISTIC_DIRTY,
  REACTIVE_ZOMBIE,
  STATUS_PENDING,
  STATUS_UNINITIALIZED
} from "./constants.js";
import { currentOptimisticLane, latestReadActive, stale } from "./core.js";
import { NotReadyError } from "./error.js";
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
  GlobalQueue,
  globalQueue,
  insertSubs,
  schedule,
  type QueueCallback,
  type Transition
} from "./scheduler.js";
import type { Computed, Link, Signal } from "./types.js";

type OptimisticNode = Signal<any> | Computed<any>;

/** The optimistic half of setSignal, fired when `_overrideValue !== undefined`. */
function optimisticWrite<T>(el: Signal<T> | Computed<T>, v: T | ((prev: T) => T)): T {
  const hasOverride = el._overrideValue !== NOT_PENDING;
  const currentValue = hasOverride ? unwrapOverride<T>(el._overrideValue) : el._value;

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
  else globalQueue._batch._optimisticNodes.push(el);

  // Stamp ownership on the node (post-merge, so entangled writers share the
  // joint root). resolveTransition prefers this over the lane's _transition,
  // which a shared subscriber can merge across transactions (#2912).
  el._overrideOwner = activeTransition;

  const lane = getOrCreateLane(el as Signal<any>);
  el._optimisticLane = lane;

  // Literal undefined must not land raw: the slot doubles as the optimistic
  // brand, and erasing it makes the write invisible and routes follow-up
  // writes off the optimistic path into permanent commits (#2898).
  el._overrideValue = v === undefined ? (OVERRIDE_UNDEFINED as T) : v;
  if (__DEV__) devTrackOptimistic(el);

  // syncCompanions only pokes _pendingSignal/_latestValueComputed — with
  // neither companion present the call is a guaranteed no-op.
  (el._pendingSignal !== undefined || el._latestValueComputed !== undefined) &&
    GlobalQueue._syncCompanions !== null &&
    GlobalQueue._syncCompanions(el, v);

  el._time = clock;
  insertSubs(el, true);
  schedule();
  return v;
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
      (node as Computed<any>)._error instanceof NotReadyError
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
    if (prevOverride !== NOT_PENDING && node._value !== unwrapOverride(prevOverride))
      insertSubs(node, true);
    node._transition = null;
    node._overrideOwner = null;
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
  // After initTransition, globalQueue._batch IS activeTransition (same reference)
  globalQueue._batch._optimisticStores.add(store);
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
  GlobalQueue._transitionBlocked = transitionBlocked;
  GlobalQueue._cleanupLanes = cleanupCompletedLanes;
  GlobalQueue._runLaneEffects = runLaneEffects;
  GlobalQueue._gatedRead = gatedRead;
  GlobalQueue._laneSuspends = laneSuspends;
  GlobalQueue._laneReadsCommitted = laneReadsCommitted;
  GlobalQueue._recomputeLane = recomputeLane;
  GlobalQueue._laneAsyncPending = laneAsyncPending;
  GlobalQueue._laneAsyncSettled = laneAsyncSettled;
  GlobalQueue._trackOptimisticStore = trackOptimisticStore;
}
