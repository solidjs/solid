/**
 * The isPending()/latest() verdict layer, moved out of core.ts. Importing this
 * module installs the companion-maintenance hooks on GlobalQueue; apps that
 * never import isPending/latest never pay for any of it.
 */
import {
  NOT_PENDING,
  REACTIVE_CHECK,
  REACTIVE_DIRTY,
  REACTIVE_DISPOSED,
  REACTIVE_MANUAL_WRITE,
  REACTIVE_ZOMBIE,
  STATUS_PENDING,
  STATUS_UNINITIALIZED
} from "./constants.js";
import {
  context,
  currentOptimisticLane,
  latestReadActive,
  optimisticComputed,
  optimisticSignal,
  pendingCheckActive,
  prepareComputed,
  read,
  setContextInternal,
  setLatestReadActive,
  setPendingCheckActive,
  setSignal,
  setStrictRead,
  stale,
  strictRead,
  tracking
} from "./core.js";
import { NotReadyError } from "./error.js";
import { link } from "./graph.js";
import { insertIntoHeap } from "./heap.js";
import { devTrackCompanionOwner, InvariantHooks } from "./invariants.js";
import { findLane, hasActiveOverride } from "./lanes.js";
import { installOptimisticEngine } from "./optimistic.js";
import { clock, dirtyQueue, GlobalQueue, insertSubs, schedule, zombieQueue } from "./scheduler.js";
import type { Computed, FirewallSignal, Signal } from "./types.js";

// Companions (pending signals / latest shadows) are optimistic nodes: their
// writes go through the optimistic write path and their reversion rides the
// same lanes, so the verdict layer brings the engine with it.
installOptimisticEngine();

interface PendingProbe {
  found: boolean;
  sources: Set<Signal<any> | Computed<any>>;
  freshReads: Set<Signal<any> | Computed<any>>;
}
let pendingProbe: PendingProbe | null = null;

/**
 * Get or create the pending signal for a node (lazy).
 * Used by isPending() to track pending state reactively.
 */
function getPendingSignal(el: Signal<any> | Computed<any>): Signal<boolean> {
  if (!el._pendingSignal) {
    // Start false, write true if pending - ensures reversion returns to false
    el._pendingSignal = optimisticSignal(false, { ownedWrite: true });
    el._pendingSignal._parentSource = el;
    if (computePendingState(el)) setSignal(el._pendingSignal, true);
    if (__DEV__) devTrackCompanionOwner(el);
  }
  return el._pendingSignal;
}

function collectPendingSources(el: Signal<any> | Computed<any>): void {
  if (!pendingProbe) return;
  pendingProbe.sources.add(el);
  const owner = (el as FirewallSignal<any>)._firewall || el;
  if (owner !== el) pendingProbe.sources.add(owner);
}

/**
 * Adds a node to the active isPending() probe without reading it. The store's
 * untracked-probe fallback (`witnessAffectsMark`) reaches this through
 * `GlobalQueue._witnessAffects` — its callers guard on `pendingCheckActive`,
 * which only flips inside `isPending()`, so the hook is always installed by
 * the time it can fire.
 */
function witnessAffects(node: Signal<any> | Computed<any>): void {
  pendingProbe?.sources.add(node);
}

function quietPending(el: Computed<any>): boolean {
  if (el._pendingSources) {
    for (const source of el._pendingSources) if (!source._reask) return false;
    return true;
  }
  if (el._pendingSource) return el._pendingSource._reask;
  return el._reask;
}

function newQuestionInFlight(comp: Computed<any>): boolean {
  return (
    !!(comp._statusFlags & STATUS_PENDING) &&
    !(comp._statusFlags & STATUS_UNINITIALIZED) &&
    !quietPending(comp)
  );
}

function computePendingState(el: Signal<any> | Computed<any>): boolean {
  const comp = el as Computed<any>;
  if (comp._flags & REACTIVE_DISPOSED) return false;
  if (el._affectsCount) return true;
  const firewall = (el as FirewallSignal<any>)._firewall;
  if (el._parentSource) {
    const parentNode = el._parentSource as FirewallSignal<any>;
    if (parentNode._affectsCount) return true;
    const parent = (parentNode._firewall || parentNode) as Computed<any>;
    return newQuestionInFlight(parent);
  }
  if (firewall && el._pendingValue !== NOT_PENDING && !hasActiveOverride(el)) {
    return (
      !!(firewall._flags & REACTIVE_MANUAL_WRITE) ||
      (!firewall._inFlight && !(firewall._statusFlags & STATUS_PENDING)) ||
      (!!(firewall._statusFlags & STATUS_PENDING) && quietPending(firewall))
    );
  }
  if (el._pendingValue !== NOT_PENDING && !(comp._statusFlags & STATUS_UNINITIALIZED)) {
    if (hasActiveOverride(el))
      return !el._equals || !el._equals(el._pendingValue as any, el._overrideValue as any);
    return true;
  }
  return newQuestionInFlight(comp);
}

function syncCompanions<T>(el: Signal<T> | Computed<T>, value: T): void {
  if (el._pendingSignal) updatePendingSignal(el);
  if (el._latestValueComputed) setSignal(el._latestValueComputed, value);
}

function updatePendingSignal(el: Signal<any> | Computed<any>): void {
  if (el._pendingSignal) {
    setSignal(el._pendingSignal, computePendingState(el));
  }
  if (el._latestValueComputed) updatePendingSignal(el._latestValueComputed);
}

function updateChildCompanions(el: Computed<any>): void {
  for (
    let child: FirewallSignal<any> | null = el._child;
    child !== null;
    child = child._nextChild
  ) {
    if (child._pendingSignal || child._latestValueComputed) updatePendingSignal(child);
  }
}

function repollDownstreamVerdicts(el: Computed<any>): void {
  const visited = new Set<Signal<any> | Computed<any>>();
  const visit = (node: Signal<any> | Computed<any>) => {
    if (visited.has(node)) return;
    visited.add(node);
    if (node._pendingSignal || node._latestValueComputed) updatePendingSignal(node);
    for (let s = node._subs; s !== null; s = s._nextSub) visit(s._sub);
    for (
      let child: FirewallSignal<any> | null = (node as Computed<any>)._child ?? null;
      child !== null;
      child = child._nextChild
    ) {
      visit(child);
    }
  };
  visit(el);
}

function snapCompanionsToState(owner: Signal<any> | Computed<any>): void {
  const sig = owner._pendingSignal;
  if (sig && (sig._overrideValue === undefined || sig._overrideValue === NOT_PENDING)) {
    const pending = computePendingState(owner);
    if (sig._value !== pending || sig._pendingValue !== NOT_PENDING) {
      sig._value = pending;
      sig._pendingValue = NOT_PENDING;
      sig._time = clock;
      insertSubs(sig);
      schedule();
    }
  }
  const shadow = owner._latestValueComputed;
  if (shadow && !(shadow._flags & REACTIVE_DISPOSED)) {
    if (
      (shadow._overrideValue === undefined || shadow._overrideValue === NOT_PENDING) &&
      shadow._pendingValue === NOT_PENDING &&
      !Object.is(shadow._value, owner._value) &&
      !(shadow._flags & (REACTIVE_DIRTY | REACTIVE_CHECK))
    ) {
      shadow._flags |= REACTIVE_DIRTY;
      insertIntoHeap(shadow, shadow._flags & REACTIVE_ZOMBIE ? zombieQueue : dirtyQueue);
      insertSubs(shadow);
      schedule();
    }
    snapCompanionsToState(shadow);
  }
}

function getLatestValueComputed<T>(el: Signal<T> | Computed<T>): Computed<T> {
  if (!el._latestValueComputed) {
    const prevPending = latestReadActive;
    setLatestReadActive(false);
    const prevCheck = pendingCheckActive;
    setPendingCheckActive(false);
    const prevContext = context;
    setContextInternal(null); // Detach from owner so it isn't disposed with effects
    el._latestValueComputed = optimisticComputed(() => read(el));
    el._latestValueComputed._parentSource = el; // Parent-child lane relationship
    if (__DEV__) devTrackCompanionOwner(el);
    setContextInternal(prevContext);
    setPendingCheckActive(prevCheck);
    setLatestReadActive(prevPending);
  }
  return el._latestValueComputed;
}

/** The latest()-mode read path, installed as GlobalQueue._latestRead. */
function latestRead<T>(el: Signal<T> | Computed<T>): T {
  const pendingComputed = getLatestValueComputed(el);
  const prevPending = latestReadActive;
  setLatestReadActive(false);
  const visibleValue = (
    el._overrideValue !== undefined && el._overrideValue !== NOT_PENDING
      ? el._overrideValue
      : el._value
  ) as T;
  let value: T;
  try {
    value = read(pendingComputed);
  } catch (e) {
    if (
      e instanceof NotReadyError &&
      (!context || !((el as Computed<T>)._statusFlags & STATUS_UNINITIALIZED))
    )
      return visibleValue;
    throw e;
  } finally {
    setLatestReadActive(prevPending);
  }
  if (pendingComputed._statusFlags & STATUS_PENDING) return visibleValue;
  if (stale && currentOptimisticLane && pendingComputed._optimisticLane) {
    const pcLane = findLane(pendingComputed._optimisticLane);
    const curLane = findLane(currentOptimisticLane);
    if (pcLane !== curLane && pcLane._pendingAsync.size > 0) {
      return visibleValue;
    }
  }
  return value as T;
}

/** The isPending()-probe read path, installed as GlobalQueue._pendingCheck. */
function pendingCheckRead(
  el: Signal<any> | Computed<any>,
  c: Computed<any> | null,
  owner: Signal<any> | Computed<any>,
  firewall: Computed<any> | null
): void {
  setPendingCheckActive(false);
  if (typeof (el as Partial<Computed<unknown>>)._fn === "function")
    prepareComputed(el as Computed<unknown>, true);
  const ownerStatus = (owner as Computed<any>)._statusFlags!;
  if (c && ownerStatus & STATUS_PENDING && ownerStatus & STATUS_UNINITIALIZED) {
    if (tracking && el !== c) link(el, c);
    setPendingCheckActive(true);
    throw (owner as Computed<any>)._error;
  }
  collectPendingSources(el);
  if (firewall) collectPendingSources(firewall);
  setPendingCheckActive(true);
}

function recordFreshRead(el: Signal<any> | Computed<any>, value: any): void {
  if (pendingProbe !== null && el._pendingValue !== NOT_PENDING && value === el._pendingValue)
    pendingProbe.freshReads.add(el);
}

function applyReask(el: Computed<any>, hadReask: boolean): boolean {
  const wasPending = !!(el._statusFlags & STATUS_PENDING);
  const isReask = hadReask && !(wasPending && !el._reask);
  const changed = wasPending && el._reask !== isReask;
  el._reask = isReask;
  return changed;
}

export function latest<T>(fn: () => T): T {
  const prevLatest = latestReadActive;
  setLatestReadActive(true);
  try {
    return fn();
  } finally {
    setLatestReadActive(prevLatest);
  }
}

export function isPending(fn: () => any): boolean {
  const prevPendingCheck = pendingCheckActive;
  const prevProbe = pendingProbe;
  setPendingCheckActive(true);
  const probe: PendingProbe = (pendingProbe = {
    found: false,
    sources: new Set(),
    freshReads: new Set()
  });
  const collectPending = () => {
    setPendingCheckActive(false);
    const prevStrictRead = __DEV__ ? strictRead : false;
    if (__DEV__) setStrictRead(false);
    try {
      probe.sources.forEach(source => {
        if (read(getPendingSignal(source)) && !probe.freshReads.has(source)) probe.found = true;
      });
    } finally {
      if (__DEV__) setStrictRead(prevStrictRead);
      setPendingCheckActive(true);
    }
  };
  try {
    fn();
    collectPending();
    return probe.found;
  } catch (e) {
    collectPending();
    if (e instanceof NotReadyError) {
      const uninitialized = !!(e.source?._statusFlags & STATUS_UNINITIALIZED);
      if (probe.found && !uninitialized) return true;
      if (context && uninitialized) throw e;
    }
    return probe.found;
  } finally {
    setPendingCheckActive(prevPendingCheck);
    pendingProbe = prevProbe;
  }
}

// Hook installation (same late-binding pattern as GlobalQueue._update /
// _propagateAffects): core call sites fire these behind the same guards the
// direct calls used, so behavior is identical once this module loads.
GlobalQueue._syncCompanions = syncCompanions;
GlobalQueue._updatePendingSignal = updatePendingSignal;
GlobalQueue._updateChildCompanions = updateChildCompanions;
GlobalQueue._snapCompanions = snapCompanionsToState;
GlobalQueue._latestRead = latestRead;
GlobalQueue._pendingCheck = pendingCheckRead;
GlobalQueue._recordFresh = recordFreshRead;
GlobalQueue._applyReask = applyReask;
GlobalQueue._repollVerdicts = repollDownstreamVerdicts;
GlobalQueue._witnessAffects = witnessAffects;

if (__DEV__) {
  InvariantHooks.pendingProbeActive = () => pendingProbe !== null;
  InvariantHooks.computePendingState = computePendingState;
}
