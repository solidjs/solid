import {
  CONFIG_AUTO_DISPOSE,
  CONFIG_SLOT_NODE,
  REACTIVE_DISPOSED,
  REACTIVE_RECOMPUTING_DEPS,
  REACTIVE_ZOMBIE,
  STATUS_PENDING
} from "./constants.js";
import { runSlotUnobserved } from "./core.js";
import { noteGraphLink, unnoteGraphLink } from "./dev.js";
import { deleteFromHeap, queueFor } from "./heap.js";
import { disposeChildren } from "./owner.js";
import { bumpNotifyEpoch, dirtyQueue, zombieQueue } from "./scheduler.js";
import type { Computed, Link, Signal } from "./types.js";

// https://github.com/stackblitz/alien-signals/blob/v2.0.3/src/system.ts#L100
export function unlinkSubs(link: Link): Link | null {
  if (__DEV__) unnoteGraphLink(link);
  const dep = link._dep;
  const nextDep = link._nextDep;
  const nextSub = link._nextSub;
  const prevSub = link._prevSub;
  if (nextSub !== null) nextSub._prevSub = prevSub;
  else dep._subsTail = prevSub;

  if (prevSub !== null) prevSub._nextSub = nextSub;
  else {
    dep._subs = nextSub;
    if (nextSub === null) {
      // Slot nodes (store leaves) dispatch to the ONE shared hook — no
      // per-node unobserved closure, no NodeExtension to hold it.
      if (dep._config & CONFIG_SLOT_NODE) runSlotUnobserved(dep as Signal<any>);
      else dep._x?._unobserved?.();
      // No more subscribers; only tear down if CONFIG_AUTO_DISPOSE is set.
      // A pending node is exempt: its in-flight async work (or the
      // transition holding it) is an observer — tearing down would orphan
      // the work and re-execute it on the next read. The settle path runs
      // this same last-one-out check when that observer releases (the
      // untracked-read dormancy sweep guards on pending identically).
      const c = dep as Computed<any>;
      (c as any)._fn &&
        c._config & CONFIG_AUTO_DISPOSE &&
        !(c._flags & REACTIVE_ZOMBIE) &&
        !(c._statusFlags & STATUS_PENDING) &&
        unobserved(c);
    }
  }
  return nextDep;
}

export function trimStaleDeps(el: Computed<any>): void {
  const depsTail = el._depsTail;
  let toRemove = depsTail !== null ? depsTail._nextDep : el._deps;
  if (toRemove !== null) {
    do {
      toRemove = unlinkSubs(toRemove);
    } while (toRemove !== null);
    if (depsTail !== null) depsTail._nextDep = null;
    else el._deps = null;
  }
}

// Shared by unobserved() and the disposeChildren child loop. The truthy guard
// (not `!== null`) matters: plain Owners in a child chain have no _deps field,
// and skipping early also avoids adding one (hidden-class churn) via the
// null-out below.
export function clearDeps(el: Computed<unknown>): void {
  let dep = el._deps;
  if (!dep) return;
  do {
    dep = unlinkSubs(dep);
  } while (dep !== null);
  el._deps = null;
  el._depsTail = null;
}

export function unobserved(el: Computed<unknown>) {
  deleteFromHeap(el, queueFor(el));
  clearDeps(el);
  disposeChildren(el, true);
}

/**
 * Deferred dormancy for never-observed auto-dispose computeds (#3078).
 *
 * An untracked top-level read of a subscriber-less observation-lifecycle memo
 * used to call unobserved() inline at the end of read(). That kept the leak
 * closed (the compute links the memo into its deps' sub lists — without a
 * teardown point a never-observed memo is retained by its sources forever;
 * upstream alien-signals has exactly this retention), but it made reads
 * destructive: each read disposed the node, the next read revived it with a
 * full recompute in whatever ambient transition/lane context happened to be
 * current, so consecutive reads could return different answers with no write
 * in between.
 *
 * Instead, reads queue the node here and the scheduler sweeps at the top of
 * the next flush (before runHeap, so a same-tick dirtying is reclaimed
 * instead of recomputed). Reads become idempotent within a tick (the node
 * stays alive and serves its cache, uniform with observed memos) while
 * reclamation still happens within one microtask — the enqueue site arms
 * schedule(), so a flush is guaranteed even when no other work is queued.
 */
export const dormantNodes = new Set<Computed<unknown>>();

export function sweepDormant(): void {
  if (dormantNodes.size === 0) return;
  for (const el of dormantNodes) {
    // Re-validate at sweep time: the node may have gained a subscriber (its
    // lifecycle is the unlinkSubs cascade now), gone pending (in-flight async
    // is an observer; the settle path re-runs last-one-out), lost its
    // AUTO_DISPOSE bit (owner teardown strips it, #3024), or already been
    // torn down.
    if (
      !el._subs &&
      el._config & CONFIG_AUTO_DISPOSE &&
      !(el._statusFlags & STATUS_PENDING) &&
      !(el._flags & (REACTIVE_DISPOSED | REACTIVE_ZOMBIE))
    ) {
      unobserved(el);
    }
  }
  dormantNodes.clear();
}

// https://github.com/stackblitz/alien-signals/blob/v2.0.3/src/system.ts#L52
export function link(
  dep: Signal<any> | Computed<any>,
  sub: Computed<any>,
  pendingObserver: boolean = false
) {
  // Repeat touches within one pass AND-combine `_pendingObserver`: a probe
  // read (`isPending(() => x())`) beside a value read of the same dep must
  // not relabel the value dependency as probe-only — the value read is what
  // real-error propagation and affects() coverage key off, regardless of
  // read order within the computation.
  const prevDep = sub._depsTail;
  if (prevDep !== null && prevDep._dep === dep) {
    prevDep._pendingObserver &&= pendingObserver;
    return;
  }

  let nextDep: Link | null = null;
  const isRecomputing = sub._flags & REACTIVE_RECOMPUTING_DEPS;
  if (isRecomputing) {
    nextDep = prevDep !== null ? prevDep._nextDep : sub._deps;
    if (nextDep !== null && nextDep._dep === dep) {
      nextDep._gen = sub._depGen;
      sub._depsTail = nextDep;
      // First touch of this pass: the previous pass's label is stale.
      nextDep._pendingObserver = pendingObserver;
      return;
    }
  }

  // A link stamped with the current pass generation was created or reused
  // in-order during this recompute, i.e. it already sits in the validated
  // [deps.._depsTail] prefix — the O(1) equivalent of scanning the dep list
  // (the old alien-signals `isValidLink` walk, O(n²) when a computation
  // re-reads earlier deps non-consecutively, e.g. store leaf reads).
  const prevSub = dep._subsTail;
  if (
    prevSub !== null &&
    prevSub._sub === sub &&
    (!isRecomputing || prevSub._gen === sub._depGen)
  ) {
    // Gen-matched during a recompute = repeat touch this pass (AND); outside
    // a recompute there is no pass boundary, so the latest read labels it.
    if (isRecomputing) prevSub._pendingObserver &&= pendingObserver;
    else prevSub._pendingObserver = pendingObserver;
    return;
  }

  const newLink =
    (sub._depsTail =
    dep._subsTail =
      {
        _dep: dep,
        _sub: sub,
        _nextDep: nextDep,
        _prevSub: prevSub,
        _nextSub: null,
        _gen: sub._depGen,
        _pendingObserver: pendingObserver
      });
  if (prevDep !== null) prevDep._nextDep = newLink;
  else sub._deps = newLink;

  if (prevSub !== null) prevSub._nextSub = newLink;
  else dep._subs = newLink;

  // New subscriber edge: staged-rewrite skips (§12d) must not miss it.
  bumpNotifyEpoch();

  if (__DEV__) noteGraphLink(dep, sub);
}
