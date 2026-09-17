import {
  CONFIG_DERIVED_OVERRIDE,
  CONFIG_HAS_LANE,
  NOT_PENDING,
  REACTIVE_DISPOSED
} from "./constants.js";
import { currentOptimisticLane, ext, hasActiveOverride } from "./core.js";
export { hasActiveOverride };
import { enqueueSub } from "./heap.js";
import {
  activeTransition,
  currentTransition,
  waitingTransition,
  type QueueCallback,
  type Transition
} from "./scheduler.js";
import type { Computed, Signal } from "./types.js";

// ============================================================================
// Per-Override Optimistic Lane Architecture
// ============================================================================

/**
 * OptimisticLane represents the context for a single optimistic write.
 * Each optimistic signal creates its own lane. Lanes merge when their
 * dependency graphs overlap.
 */
export interface OptimisticLane {
  _source: Signal<any>; // The optimistic signal that created this lane
  _pendingAsync: Set<Computed<any>>; // Async nodes triggered by this lane
  _effectQueues: [QueueCallback[], QueueCallback[]]; // [render, user] effects for this lane
  _mergedInto: OptimisticLane | null; // Union-find: points to merged lane, or null if root
  _transition: Transition | null; // Which transition owns this lane (null = orphan)
  _parentLane: OptimisticLane | null; // Parent lane for child lanes (e.g., pendingSignal's lane → pendingComputed's lane)
}

// Map from optimistic signal to its lane (reused for multiple writes to same signal)
export const signalLanes = new WeakMap<Signal<any>, OptimisticLane>();

// All active lanes (for cleanup on transition completion)
export const activeLanes = new Set<OptimisticLane>();

/**
 * Get an existing lane for a signal or create a new one.
 * Reuses lane for multiple writes to the same signal.
 */
export function getOrCreateLane(signal: Signal<any>): OptimisticLane {
  let lane = signalLanes.get(signal);
  if (lane) {
    return findLane(lane);
  }
  // Detect parent lane: _parentSource chains from pendingSignal → pendingValueComputed → original.
  // The child lane should not merge with the parent lane.
  const parentSource = signal._x?._parentSource;
  const parentOptLane = parentSource?._x?._optimisticLane;
  const parentLane = parentOptLane ? findLane(parentOptLane) : null;
  lane = {
    _source: signal,
    _pendingAsync: new Set(),
    _effectQueues: [[], []],
    _mergedInto: null,
    _transition: activeTransition,
    _parentLane: parentLane
  };
  signalLanes.set(signal, lane);
  activeLanes.add(lane);
  // A companion may have written before the owner's first optimistic write
  // (affects() as an action's first statement pokes the verdict companion of a
  // still lane-less node, #2887), leaving its lane parentless. Adopt it now:
  // parent-child is a property of the nodes, not of write order — otherwise
  // the owner's write merges the companion's subscribers into this lane and
  // their effects wait on its async instead of flushing immediately.
  adoptCompanionLane(signal._x?._pendingSignal, lane);
  adoptCompanionLane(signal._x?._latestValueComputed, lane);
  return lane;
}

function adoptCompanionLane(
  companion: Signal<any> | Computed<any> | undefined,
  parent: OptimisticLane
): void {
  if (!companion) return;
  const companionLane = signalLanes.get(companion);
  if (!companionLane) return;
  const root = findLane(companionLane);
  // Only the companion's own unmerged root is safely re-parentable: a root
  // that absorbed other lanes carries work that is not a child of this owner.
  if (root !== parent && root._source === companion && !root._parentLane) root._parentLane = parent;
}

/**
 * Union-find: find the root lane.
 */
export function findLane(lane: OptimisticLane): OptimisticLane {
  while (lane._mergedInto) lane = lane._mergedInto;
  return lane;
}

/**
 * Is the lane held? `_pendingAsync` records the async the lane OWNS (derived
 * under it); a transaction's reporter map records the async a render effect
 * OBSERVED pending with no boundary taking it (INV-3, the one registration
 * site). A hold needs both — the same rule the transaction itself uses, so a
 * memo nobody renders, or one a fallback-showing boundary caught, cannot tear
 * a frame and holds nothing (#3289). An orphan lane has no observation record
 * and never holds.
 *
 * The observation is looked up per NODE, in whichever live transaction
 * recorded it — not in this lane's transaction. Lanes merge across
 * transactions (#2912: ownership never travels through lanes), so after a
 * merge the root's transaction holds the observations of only one member;
 * the async the other member's transaction observed must hold the merged
 * reveal just the same (A15 for lanes, #3335).
 */
export function laneHeld(lane: OptimisticLane): boolean {
  if (!lane._transition) return false;
  for (const node of lane._pendingAsync) if (waitingTransition(node) !== null) return true;
  return false;
}

/**
 * Lanes mirror transitions (#3460): a render effect OFF a HELD lane that reads
 * a value the lane is revealing — an override, a `latest()` shadow — sees the
 * committed value, exactly as a stale reader of a held transaction does
 * (A15 reveal corollary): it publishes now, with the frame that is on screen
 * (the lane defers its own readers' runs, so the committed value is what is
 * visible), entangles nothing — a sync write is never held by a lane — and
 * re-derives at the release. The release re-run rides the lane's own render
 * queue, which runs when the lane reveals (runLaneEffects) or its transaction
 * commits (cleanupCompletedLanes). A reader ON the lane computes the lane's
 * reveal and takes the value as before.
 *
 * OFF the lane is provenance, not membership — the transaction mirror
 * exactly: a stale reader of a transaction is a pass that runs outside it. A
 * pass under the lane's own transaction is the lane's work — its write (lane
 * posture), or the landing of its async, which re-enters the transaction
 * (#3334) and runs a member with no ambient lane. Read as an outsider, that
 * pass published the committed view and queued a replay that revealed the
 * override beside its unready derivation at the release (`1:0` for an
 * optimistic frame that never became ready; #3479 review). Membership is the
 * wrong test the other way: a member re-run by a sibling's sync write is a
 * mainline pass and shows the committed view.
 */
export function readsHeldCommitted(owner: Computed<any>, c: Computed<any>): boolean {
  const lane = resolveLane(owner);
  if (!lane || !laneHeld(lane)) return false;
  const t = activeTransition && resolveTransition(owner);
  if (
    (t && currentTransition(t) === currentTransition(activeTransition!)) ||
    (currentOptimisticLane !== null && findLane(currentOptimisticLane) === lane)
  )
    return false;
  lane._effectQueues[0].push(() => c._flags & REACTIVE_DISPOSED || enqueueSub(c));
  return true;
}

/**
 * Merge two lanes when their dependency graphs overlap.
 */
export function mergeLanes(lane1: OptimisticLane, lane2: OptimisticLane): OptimisticLane {
  lane1 = findLane(lane1);
  lane2 = findLane(lane2);
  if (lane1 === lane2) return lane1;

  lane2._mergedInto = lane1;
  // Move (not copy) the merged lane's work: after the merge all routing goes
  // through findLane() to the root, so anything left behind here is dead —
  // and anything *added* here later is a routing bug (INV-5).
  for (const node of lane2._pendingAsync) lane1._pendingAsync.add(node);
  lane2._pendingAsync.clear();
  lane1._effectQueues[0].push(...lane2._effectQueues[0]);
  lane1._effectQueues[1].push(...lane2._effectQueues[1]);
  lane2._effectQueues[0].length = 0;
  lane2._effectQueues[1].length = 0;

  return lane1;
}

/**
 * Resolve a node's lane: follow union-find chain, verify active, clear if stale.
 */
export function resolveLane(el: Signal<any> | Computed<any>): OptimisticLane | undefined {
  const lane = el._x?._optimisticLane;
  if (!lane) return undefined;
  const root = findLane(lane);
  if (activeLanes.has(root)) return root;
  if (el._x !== null) el._x._optimisticLane = undefined;
  return undefined;
}

export function resolveTransition(el: Signal<any> | Computed<any>): Transition | null | undefined {
  // An active override answers with its owner, not its lane: lanes are
  // scheduling affinity and a shared subscriber merges them across
  // transactions (#2912) — the merged root's _transition would hand this
  // node's override to whichever action wrote last through the shared
  // reader. Chase merge chains; a dead owner settled through another path.
  if (hasActiveOverride(el) && el._x?._overrideOwner) {
    const owner = (ext(el)._overrideOwner = currentTransition(el._x?._overrideOwner));
    if (owner._done !== true) return owner;
    if (el._x !== null) el._x._overrideOwner = null;
  }
  return resolveLane(el)?._transition ?? el._transition;
}

/**
 * Assign or merge a lane onto a node. At convergence points (node already has
 * a different active lane), merge unless the node has an active override.
 */
export function assignOrMergeLane(
  el: Signal<any> | Computed<any>,
  sourceLane: OptimisticLane
): void {
  const sourceRoot = findLane(sourceLane);
  const existing = el._x?._optimisticLane;
  if (existing) {
    // A merged lane is followed to its root like any other: the root is where
    // the subscriber's affinity lives now. Replacing it with the source lane
    // outright (as this once did) skipped the parent/child check below — an
    // isPending reader of two async siblings had their two companion lanes
    // merge, and the next parent-lane notification then moved it onto the
    // held parent, where its verdict waited on the async it reports (#3409).
    const existingRoot = findLane(existing);
    if (activeLanes.has(existingRoot)) {
      // A WRITTEN override is its own lane's source and merges nothing
      // through it; a derived one (lanes stage, #3479) is a plain member —
      // the shared reader that merges two writers' lanes carries one.
      if (
        existingRoot !== sourceRoot &&
        (!hasActiveOverride(el) || (el as any)._config & CONFIG_DERIVED_OVERRIDE)
      ) {
        // Parent-child lanes stay independent so isPending resolves without
        // waiting for the parent's async. The child keeps ownership.
        if (sourceRoot._parentLane && findLane(sourceRoot._parentLane) === existingRoot) {
          ext(el)._optimisticLane = sourceLane;
          (el as any)._config |= CONFIG_HAS_LANE;
        } else if (existingRoot._parentLane && findLane(existingRoot._parentLane) === sourceRoot) {
          // Existing is already the child — keep it
        } else mergeLanes(sourceRoot, existingRoot);
      }
      return;
    }
  }
  ext(el)._optimisticLane = sourceLane;
  (el as any)._config |= CONFIG_HAS_LANE;
}
