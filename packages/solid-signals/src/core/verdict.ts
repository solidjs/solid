/**
 * The isPending()/latest() verdict layer, moved out of core.ts. Importing this
 * module installs the companion-maintenance hooks on GlobalQueue; apps that
 * never import isPending/latest never pay for any of it.
 */
import {
  NOT_PENDING,
  unwrapOverride,
  REACTIVE_CHECK,
  REACTIVE_DIRTY,
  REACTIVE_DISPOSED,
  REACTIVE_MANUAL_WRITE,
  REACTIVE_OPTIMISTIC_DIRTY,
  REACTIVE_RECOMPUTING_DEPS,
  REACTIVE_ZOMBIE,
  STATUS_ERROR,
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
import { enqueueSub, insertIntoHeap, markHeap, queueFor } from "./heap.js";
import { devTrackCompanionOwner, InvariantHooks } from "./invariants.js";
import { assignOrMergeLane, findLane, hasActiveOverride } from "./lanes.js";
import { installOptimisticEngine } from "./optimistic.js";
import {
  activeAffectsMarks,
  activeTransition,
  clock,
  currentTransition,
  dirtyQueue,
  GlobalQueue,
  insertSubs,
  schedule,
  zombieQueue,
  type Transition
} from "./scheduler.js";
import type { Computed, FirewallSignal, Signal } from "./types.js";

// Companions (pending signals / latest shadows) are optimistic nodes: their
// writes go through the optimistic write path and their reversion rides the
// same lanes, so the verdict layer brings the engine with it.
installOptimisticEngine();

interface PendingProbe {
  found: boolean;
  sources: Set<Signal<any> | Computed<any>>;
  freshReads: Set<Signal<any> | Computed<any>>;
  suppressed: Array<Signal<any> | Computed<any>>;
}
let pendingProbe: PendingProbe | null = null;

/**
 * Probes whose verdict was suppressed by the fresh-read pairing rule while
 * the held write's fate was still undecided (see recordFreshRead /
 * wakeSuppressedProbes): held node → the wrapper computeds that probed it.
 * Entries die with the hold — the commit/revert snap clears them.
 */
const suppressedProbes: Map<Signal<any> | Computed<any>, Set<Computed<any>>> = new Map();

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

/**
 * The affects() coverage walk — the read half of the dedicated mark channel.
 * A node is covered by a live mark iff it carries one (`_affectsCount`) or
 * derives, through its CURRENT deps (hopping store firewalls), from a node
 * that does. Pull-based coverage means graph rewires, mid-window recomputes,
 * and probe-triggered recomputes can never strand or strip a mark — there is
 * nothing stored downstream to corrupt. Probe-created links
 * (`_pendingObserver`) are skipped so an `isPending` wrapper memo never
 * inherits the coverage it reports on.
 */
function markWalk(
  el: Signal<any> | Computed<any>,
  seen: Set<Signal<any> | Computed<any>>
): boolean {
  if (el._affectsCount) return true;
  // A real error outranks an inherited mark (A16/A24c): an errored node
  // answers probes with its error, not a coverage verdict, and coverage does
  // not flow through it — matching the rails' behavior, where propagation
  // stopped at errored nodes. A DIRECT mark on an errored node still reads
  // pending (the count check above), also matching.
  if ((el as Computed<any>)._statusFlags & STATUS_ERROR) return false;
  if (seen.has(el)) return false;
  seen.add(el);
  const firewall = (el as FirewallSignal<any>)._firewall;
  if (firewall && markWalk(firewall, seen)) return true;
  // Mid-recompute (the clearStatus companion poke runs before
  // trimStaleDeps), only the validated prefix [_deps.._depsTail] is this
  // pass's dependency set — walking past it would read dropped deps and
  // latch a stale verdict on the companion.
  const comp = el as Computed<any>;
  const tail = comp._flags & REACTIVE_RECOMPUTING_DEPS ? comp._depsTail : undefined;
  if (tail !== null) {
    for (let d = comp._deps ?? null; d !== null; d = d._nextDep) {
      if (!d._pendingObserver && markWalk(d._dep, seen)) return true;
      if (d === tail) break;
    }
  }
  return false;
}

/** Gated entry: apps with no live mark pay one integer compare. */
function markCovered(el: Signal<any> | Computed<any>): boolean {
  return activeAffectsMarks !== 0 && markWalk(el, new Set());
}

function quietPending(el: Computed<any>): boolean {
  if (el._pendingSources) {
    for (const source of el._pendingSources) if (!source._reask) return false;
    return true;
  }
  return el._reask;
}

// NOTE: a loadingValue node's open loading window (_loading) is verdict-quiet
// on purpose: commit #0 answers the question by declaration, so the window
// reads NOT pending — first-load affordances live in the value channel
// (null / skeleton provenance the author encoded), and isPending stays what
// it always was: refetch truth for an answered question. This keeps the
// verdict fully correlated with transition-class machinery and keeps server
// (always false) and client hydration trivially consistent.
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
  // Mark coverage is transitive by dep-graph reachability: a latest() shadow
  // reaches its owner (and a store leaf its firewall) through its own deps,
  // so the one walk covers direct marks, derivation, and companion chains.
  if (markCovered(el)) return true;
  const firewall = (el as FirewallSignal<any>)._firewall;
  if (el._parentSource) {
    const parentNode = el._parentSource as FirewallSignal<any>;
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
  // `!comp._loading`: a hold created while the loading window is still open is
  // the window's own landing in flight to its commit — verdict-quiet like the
  // rest of the window (the UNINITIALIZED check suppresses exactly this frame
  // for windowless first loads; born-committed nodes need their own gate, #2990).
  if (
    el._pendingValue !== NOT_PENDING &&
    !(comp._statusFlags & STATUS_UNINITIALIZED) &&
    !comp._loading
  ) {
    if (hasActiveOverride(el))
      return !el._equals || !el._equals(el._pendingValue as any, unwrapOverride(el._overrideValue));
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

/**
 * Re-derive every verdict companion downstream of `el` (subs + firewall
 * children, dedup'd). The affects() channel's poke walk: registration and
 * re-ask flips use the live write path (companion setSignal — its own lane
 * lets the wake escape an incomplete transition's effect stash, #2887);
 * mark release passes `snap` because it runs inside queue finalization,
 * where companion writes must land committed (a setSignal there would open
 * a fresh override window that nothing settles).
 */
function repollDownstreamVerdicts(el: Computed<any>, snap: boolean = false): void {
  const update = snap ? snapCompanionsToState : updatePendingSignal;
  const visited = new Set<Signal<any> | Computed<any>>();
  const visit = (node: Signal<any> | Computed<any>) => {
    if (visited.has(node)) return;
    visited.add(node);
    if (node._pendingSignal || node._latestValueComputed) update(node);
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

/**
 * The correction half of the provisional fresh-read suppression (see
 * collectPending): fired from the sanctioned async-registration site
 * (GlobalQueue.notify) when a transaction gains an in-flight async blocker.
 * Every probe that returned "not pending" purely because it read a held
 * value belonging to that transaction re-runs — its re-probe now sees the
 * live blocker through heldAwaitingAsync and lands the true verdict. The
 * wake mirrors a companion write's own notification (optimistic-dirty on the
 * companion's lane) so the corrected verdict commits and flushes immediately
 * instead of being held with the transaction it reports on.
 */
function wakeSuppressedProbes(transition: Transition): void {
  if (suppressedProbes.size === 0) return;
  let woke = false;
  for (const [node, probes] of suppressedProbes) {
    const t = node._transition ? currentTransition(node._transition) : null;
    if (!t) {
      suppressedProbes.delete(node);
      continue;
    }
    if (t !== transition) continue;
    suppressedProbes.delete(node);
    const lane = node._pendingSignal?._optimisticLane;
    for (const p of probes) {
      if (p._flags & REACTIVE_DISPOSED) continue;
      p._flags |= REACTIVE_OPTIMISTIC_DIRTY;
      if (lane) assignOrMergeLane(p, lane);
      else p._optimisticLane = undefined;
      enqueueSub(p);
      woke = true;
    }
  }
  if (woke) schedule();
}

function snapCompanionsToState(owner: Signal<any> | Computed<any>): void {
  suppressedProbes.size !== 0 && suppressedProbes.delete(owner);
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
      insertIntoHeap(shadow, queueFor(shadow));
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
      ? unwrapOverride(el._overrideValue)
      : el._value
  ) as T;
  let value: T;
  try {
    // An untracked latest() read has no reading context, so read() never
    // performs its mid-tick pull — a plain write queued between two latest()
    // calls left a still-subscribed shadow at its previous speculative value
    // until the flush (#2922). Mirror the tracked-read pull here: mark the
    // queued staleness through the graph, then bring the shadow up to date.
    const queue = queueFor(pendingComputed);
    if (
      pendingComputed._height >= queue._min &&
      !(pendingComputed._flags & (REACTIVE_DISPOSED | REACTIVE_ZOMBIE))
    ) {
      markHeap(queue);
      prepareComputed(pendingComputed as Computed<unknown>, true);
    }
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
  // A shadow recomputed by the pull above (not at creation) holds its fresh
  // speculative value in _pendingValue; a contextless read() only surfaces
  // _value. Overrides stay authoritative (A17), and stale readers keep the
  // other transition's committed view, matching read()'s own selection.
  if (
    pendingComputed._pendingValue !== NOT_PENDING &&
    !hasActiveOverride(pendingComputed) &&
    !(stale && pendingComputed._transition && activeTransition !== pendingComputed._transition)
  )
    return pendingComputed._pendingValue as T;
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

/**
 * A held node whose transaction still has an async question in flight. The
 * probe's fresh-read pairing rule (#2831 — "a reader that sees the fresh
 * value must not also be told it is pending") only applies to LANDED answers
 * awaiting reveal; while the answer is still computing, the fresh value the
 * reader saw is an input, and pending remains the truth for every reader
 * (#3028).
 */
function heldAwaitingAsync(el: Signal<any> | Computed<any>): boolean {
  const t = el._transition ? currentTransition(el._transition) : null;
  if (!t || t._done) return false;
  for (const [source, reporters] of t._asyncReporters) {
    if (
      reporters.size &&
      source._statusFlags & STATUS_PENDING &&
      (source._error as NotReadyError | undefined)?.source === source
    )
      return true;
  }
  return false;
}

function recordFreshRead(el: Signal<any> | Computed<any>, value: any): void {
  if (pendingProbe !== null && el._pendingValue !== NOT_PENDING && value === el._pendingValue) {
    if (heldAwaitingAsync(el)) return;
    pendingProbe.freshReads.add(el);
  }
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
    freshReads: new Set(),
    suppressed: []
  });
  const collectPending = () => {
    setPendingCheckActive(false);
    const prevStrictRead = __DEV__ ? strictRead : false;
    if (__DEV__) setStrictRead(false);
    try {
      probe.sources.forEach(source => {
        if (read(getPendingSignal(source))) {
          if (!probe.freshReads.has(source)) probe.found = true;
          else probe.suppressed.push(source);
        }
      });
    } finally {
      if (__DEV__) setStrictRead(prevStrictRead);
      setPendingCheckActive(true);
    }
    // A "not pending" verdict that exists only because this reader saw the
    // fresh held value is provisional: if the write turns out NOT to commit
    // this flush (a downstream async pends and holds it), the suppression was
    // wrong and the wrapper must re-ask (#3028). Remember who to wake — the
    // async registration (GlobalQueue.notify) triggers wakeSuppressedProbes.
    if (
      !probe.found &&
      probe.suppressed.length &&
      context &&
      typeof (context as Partial<Computed<unknown>>)._fn === "function"
    ) {
      for (const source of probe.suppressed) {
        let probes = suppressedProbes.get(source);
        if (!probes) suppressedProbes.set(source, (probes = new Set()));
        probes.add(context as Computed<any>);
      }
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
GlobalQueue._wakeSuppressedProbes = wakeSuppressedProbes;

if (__DEV__) {
  InvariantHooks.pendingProbeActive = () => pendingProbe !== null;
  InvariantHooks.computePendingState = computePendingState;
}
