import { NOT_PENDING } from "./constants.js";
import { activeTransition, type QueueCallback, type Transition } from "./scheduler.js";
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
  const parentSource = signal._parentSource;
  const parentLane = parentSource?._optimisticLane ? findLane(parentSource._optimisticLane) : null;
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
  // Snapshot override version at lane creation for correction gating
  (signal as any)._laneVersion = (signal as any)._overrideVersion || 0;
  return lane;
}

/**
 * Union-find: find the root lane.
 */
export function findLane(lane: OptimisticLane): OptimisticLane {
  while (lane._mergedInto) lane = lane._mergedInto;
  return lane;
}

/**
 * Merge two lanes when their dependency graphs overlap.
 */
export function mergeLanes(lane1: OptimisticLane, lane2: OptimisticLane): OptimisticLane {
  lane1 = findLane(lane1);
  lane2 = findLane(lane2);
  if (lane1 === lane2) return lane1;

  lane2._mergedInto = lane1;
  for (const node of lane2._pendingAsync) lane1._pendingAsync.add(node);
  lane1._effectQueues[0].push(...lane2._effectQueues[0]);
  lane1._effectQueues[1].push(...lane2._effectQueues[1]);

  return lane1;
}

/**
 * Resolve a node's lane: follow union-find chain, verify active, clear if stale.
 */
export function resolveLane(el: { _optimisticLane?: OptimisticLane }): OptimisticLane | undefined {
  const lane = el._optimisticLane;
  if (!lane) return undefined;
  const root = findLane(lane);
  if (activeLanes.has(root)) return root;
  el._optimisticLane = undefined;
  return undefined;
}

/**
 * Check if a node has an active optimistic override (pending value differs from base).
 */
export function hasActiveOverride(el: { _optimistic?: boolean; _pendingValue?: any }): boolean {
  return !!(el._optimistic && el._pendingValue !== NOT_PENDING);
}

/**
 * Assign or merge a lane onto a node. At convergence points (node already has
 * a different active lane), merge unless the node has an active override.
 */
export function assignOrMergeLane(
  el: { _optimisticLane?: OptimisticLane; _optimistic?: boolean; _pendingValue?: any },
  sourceLane: OptimisticLane
): void {
  const sourceRoot = findLane(sourceLane);
  const existing = el._optimisticLane;
  if (existing) {
    // If the subscriber's lane was merged into another lane, it's stale —
    // replace it with the new source lane instead of following the merge chain
    // (which would incorrectly merge the new lane into the old group)
    if (existing._mergedInto) {
      el._optimisticLane = sourceLane;
      return;
    }
    const existingRoot = findLane(existing);
    if (activeLanes.has(existingRoot)) {
      if (existingRoot !== sourceRoot && !hasActiveOverride(el)) {
        // Parent-child lanes stay independent so isPending resolves without
        // waiting for the parent's async. The child keeps ownership.
        if (sourceRoot._parentLane && findLane(sourceRoot._parentLane) === existingRoot) {
          el._optimisticLane = sourceLane;
        } else if (existingRoot._parentLane && findLane(existingRoot._parentLane) === sourceRoot) {
          // Existing is already the child — keep it
        } else mergeLanes(sourceRoot, existingRoot);
      }
      return;
    }
  }
  el._optimisticLane = sourceLane;
}

