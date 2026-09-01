/**
 * The isPending()/latest() verdict layer, moved out of core.ts. Importing this
 * module installs the companion-maintenance hooks on GlobalQueue; apps that
 * never import isPending/latest never pay for any of it.
 */
import {
  CONFIG_CHILD_COMPANIONS,
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
  STATUS_UNINITIALIZED,
  CONFIG_HAS_COMPANIONS
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
  tracking,
  ext
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
/** #3038: register a companion-carrying firewall child on its firewall's
 * companion set and arm the post-recompute snap (CONFIG_CHILD_COMPANIONS is
 * the one-load gate at the call sites). The snap then iterates exactly the
 * children someone asked verdicts of — O(companions) — never the full
 * `_child` chain, which carries one node per materialized leaf (the
 * O(all-leaves-ever-read)-per-update pathology). Entries are permanent like
 * the companions themselves; a store with no leaf-level isPending()/latest()
 * reads never allocates the set or pays the walk. */
function markFirewallChildCompanions(el: Signal<any> | Computed<any>): void {
  const fw = (el as FirewallSignal<any>)._firewall;
  if (!fw) return;
  fw._config |= CONFIG_CHILD_COMPANIONS;
  (ext(fw)._companionChildren ??= new Set()).add(el as FirewallSignal<any>);
}

function getPendingSignal(el: Signal<any> | Computed<any>): Signal<boolean> {
  let ps = el._x?._pendingSignal;
  if (!ps) {
    // Start false, write true if pending - ensures reversion returns to false
    ps = optimisticSignal(false, { ownedWrite: true });
    ext(el)._pendingSignal = ps;
    el._config |= CONFIG_HAS_COMPANIONS;
    markFirewallChildCompanions(el);
    ext(ps)._parentSource = el;
    if (computePendingState(el)) setSignal(ps, true);
    if (__DEV__) devTrackCompanionOwner(el);
  }
  return ps;
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
  if (el._x?._affectsCount) return true;
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
  if (el._x?._pendingSources) {
    for (const source of el._x._pendingSources) if (!source._x?._reask) return false;
    return true;
  }
  return el._x?._reask ?? false;
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
  if (el._x?._parentSource) {
    const parentNode = el._x?._parentSource as FirewallSignal<any>;
    const parent = (parentNode._firewall || parentNode) as Computed<any>;
    return newQuestionInFlight(parent);
  }
  if (firewall && el._pendingValue !== NOT_PENDING && !hasActiveOverride(el)) {
    return (
      !!(firewall._flags & REACTIVE_MANUAL_WRITE) ||
      (!firewall._x?._inFlight && !(firewall._statusFlags & STATUS_PENDING)) ||
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
      return (
        !el._equals || !el._equals(el._pendingValue as any, unwrapOverride(el._x?._overrideValue))
      );
    return true;
  }
  return newQuestionInFlight(comp);
}

function syncCompanions<T>(el: Signal<T> | Computed<T>, value: T): void {
  if (el._x?._pendingSignal) updatePendingSignal(el);
  if (el._x?._latestValueComputed) setSignal(el._x?._latestValueComputed, value);
}

function updatePendingSignal(el: Signal<any> | Computed<any>): void {
  if (el._x?._pendingSignal) {
    setSignal(el._x?._pendingSignal, computePendingState(el));
  }
  if (el._x?._latestValueComputed) updatePendingSignal(el._x?._latestValueComputed);
}

function updateChildCompanions(el: Computed<any>): void {
  const companions = el._x?._companionChildren;
  if (companions === undefined) return;
  for (const child of companions) updatePendingSignal(child);
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
    if (node._x?._pendingSignal || node._x?._latestValueComputed) update(node);
    for (let s = node._subs; s !== null; s = s._nextSub) visit(s._sub);
    for (
      let child: FirewallSignal<any> | null = (node as Computed<any>)._x?._child ?? null;
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
    const nt = node._transition;
    const t = nt ? currentTransition(nt) : null;
    if (!t) {
      suppressedProbes.delete(node);
      continue;
    }
    if (t !== transition) continue;
    suppressedProbes.delete(node);
    const lane = node._x?._pendingSignal?._x?._optimisticLane;
    for (const p of probes) {
      if (p._flags & REACTIVE_DISPOSED) continue;
      p._flags |= REACTIVE_OPTIMISTIC_DIRTY;
      if (lane) assignOrMergeLane(p, lane);
      else if (p._x !== null) p._x._optimisticLane = undefined;
      enqueueSub(p);
      woke = true;
    }
  }
  if (woke) schedule();
}

function snapCompanionsToState(owner: Signal<any> | Computed<any>): void {
  suppressedProbes.size !== 0 && suppressedProbes.delete(owner);
  const sig = owner._x?._pendingSignal;
  if (sig && (sig._x?._overrideValue === undefined || sig._x?._overrideValue === NOT_PENDING)) {
    const pending = computePendingState(owner);
    if (sig._value !== pending || sig._pendingValue !== NOT_PENDING) {
      sig._value = pending;
      sig._pendingValue = NOT_PENDING;
      insertSubs(sig);
      schedule();
    }
  }
  const shadow = owner._x?._latestValueComputed;
  if (shadow && !(shadow._flags & REACTIVE_DISPOSED)) {
    if (
      (shadow._x?._overrideValue === undefined || shadow._x?._overrideValue === NOT_PENDING) &&
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
  let lvc = el._x?._latestValueComputed;
  // A shadow disposed while unobserved (its gated reader unmounted at a
  // landing) is a corpse: sync writes into it equality-swallow against its
  // frozen _value, and a later read revives it via recompute — clearing
  // DISPOSED and re-deriving from the committed view, so the banner showed
  // the previous transition's target (#3041 follow-up). Treat it as absent;
  // recreation backfills from the in-flight write below.
  if (lvc && lvc._flags & REACTIVE_DISPOSED) lvc = undefined;
  if (!lvc) {
    const prevPending = latestReadActive;
    setLatestReadActive(false);
    const prevCheck = pendingCheckActive;
    setPendingCheckActive(false);
    const prevContext = context;
    setContextInternal(null); // Detach from owner so it isn't disposed with effects
    lvc = optimisticComputed(() => read(el));
    ext(el)._latestValueComputed = lvc;
    el._config |= CONFIG_HAS_COMPANIONS;
    markFirewallChildCompanions(el);
    ext(lvc)._parentSource = el; // Parent-child lane relationship
    // Backfill an in-flight write (mirrors getPendingSignal): the companion is
    // created lazily, possibly after the write was processed — syncCompanions
    // only pushes into companions that already exist, so the first latest()
    // read inside a held transition showed the committed value (#3041).
    if (el._pendingValue !== NOT_PENDING && !hasActiveOverride(el))
      setSignal(lvc, el._pendingValue as T);
    if (__DEV__) devTrackCompanionOwner(el);
    setContextInternal(prevContext);
    setPendingCheckActive(prevCheck);
    setLatestReadActive(prevPending);
  }
  return lvc;
}

/** The latest()-mode read path, installed as GlobalQueue._latestRead. */
function latestRead<T>(el: Signal<T> | Computed<T>): T {
  const pendingComputed = getLatestValueComputed(el);
  const prevPending = latestReadActive;
  setLatestReadActive(false);
  const visibleValue = (
    el._x?._overrideValue !== undefined && el._x?._overrideValue !== NOT_PENDING
      ? unwrapOverride(el._x?._overrideValue)
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
      // Suspend probe collection during the pull (mirrors pendingCheckRead's
      // prepare): a probe through latest() answers for the SHADOW — the
      // read() dispatch collects it deliberately, so the verdict reflects
      // async still in flight for the latest view, not the parent's held
      // write. A stale shadow recomputing HERE ran its `read(parent)` with
      // the probe still live and collected the parent too, so the verdict
      // depended on whether anything had pulled the shadow current earlier
      // in the tick (#3104: reading latest(m) flipped a later
      // latest(() => isPending(x)) from true to false).
      const prevCheck = pendingCheckActive;
      setPendingCheckActive(false);
      try {
        prepareComputed(pendingComputed as Computed<unknown>, true);
      } finally {
        setPendingCheckActive(prevCheck);
      }
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
  if (stale && currentOptimisticLane && pendingComputed._x?._optimisticLane) {
    const pcLane = findLane(pendingComputed._x?._optimisticLane);
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

/**
 * A latest() shadow that is uninitialized only because it was CREATED during
 * an active flight — its parent source already has a committed value, so
 * latest() serves that as the visible value and a tracked reader has
 * something to pair a verdict with (#3166). Same parent resolution as
 * computePendingState. The pending signal companion also carries
 * `_parentSource` but is a plain signal (no `_fn`) that never goes pending,
 * so the `_fn` check is belt-and-braces for this call site.
 */
function latestShadowWithInitializedParent(owner: Signal<any> | Computed<any>): boolean {
  if (typeof (owner as Partial<Computed<any>>)._fn !== "function") return false;
  const parentNode = owner._x?._parentSource as FirewallSignal<any> | undefined;
  if (parentNode === undefined) return false;
  const parent = (parentNode._firewall || parentNode) as Computed<any>;
  return !(parent._statusFlags & STATUS_UNINITIALIZED);
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
  if (
    c &&
    ownerStatus & STATUS_PENDING &&
    ownerStatus & STATUS_UNINITIALIZED &&
    // The suspend-throw is for a genuinely-first-load source: the tracked
    // reader has nothing to pair a verdict with, so it parks on the source.
    // A latest() SHADOW created lazily mid-flight is born uninitialized even
    // though its parent has a committed value latest() will serve — throwing
    // here (swallowed by latestRead's fallback) dropped the shadow from the
    // probe, so a tracked latest(isPending()) probe created during a
    // new-question flight cached `false` for that whole flight (#3166).
    // Defer to the PARENT's initialization state and fall through to normal
    // collection; the plain pending throw downstream still links the reader.
    !latestShadowWithInitializedParent(owner)
  ) {
    if (tracking && el !== c) link(el, c);
    setPendingCheckActive(true);
    throw (owner as Computed<any>)._x?._error;
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
  const et = el._transition;
  const t = et ? currentTransition(et) : activeTransition;
  if (!t || t._done) return false;
  // A plain staged write (a signal/store leaf — no _fn) held while an action
  // is still running is an INPUT to a computation still in flight (#3078):
  // the pairing rule must not suppress the verdict, or a memo recomputing
  // mid-action reads the staged value, gets told "not pending", and
  // disagrees with a direct isPending() probe for the whole action window.
  // A computed's staged value is the opposite case — a LANDED answer
  // awaiting reveal — where the pairing rule stands even inside an open
  // action (#2831: a reader that saw the new value must not also see
  // pending); still-computing answers are covered by the reporter scan.
  if (t._actions.length && !(el as Partial<Computed<any>>)._fn) return true;
  // A node not yet stamped with a transition only qualifies through the
  // action check above; the reporter scan below is for transition-held
  // writes whose source async is still computing.
  if (!et) return false;
  for (const [source, reporters] of t._asyncReporters) {
    if (
      reporters.size &&
      source._statusFlags & STATUS_PENDING &&
      (source._x?._error as NotReadyError | undefined)?.source === source
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
  const isReask = hadReask && !(wasPending && !el._x?._reask);
  const changed = wasPending && (el._x?._reask ?? false) !== isReask;
  // Allocation-free for the quiet case: false is the extension default.
  if (isReask) ext(el)._reask = true;
  else if (el._x !== null) el._x._reask = false;
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
    // Companion reads are mode-neutral plumbing: under an outer latest()
    // (isPending inside a latest window — #3104's memo shape) leaving latest
    // mode active dispatched these reads through latestRead, which built a
    // SHADOW OF THE PENDING SIGNAL itself. The next updatePendingSignal then
    // wrote that companion-on-companion from inside a recompute
    // (syncCompanions → setSignal on a shadow created without ownedWrite)
    // and halted dev with the owned-scope write guard. The creation paths
    // (getLatestValueComputed / getPendingSignal) already suspend both
    // modes; this read site must too.
    const prevLatest = latestReadActive;
    setLatestReadActive(false);
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
      setLatestReadActive(prevLatest);
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
