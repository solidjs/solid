import { CONFIG_AUTO_DISPOSE, REACTIVE_RECOMPUTING_DEPS, REACTIVE_ZOMBIE } from "./constants.js";
import { deleteFromHeap, queueFor } from "./heap.js";
import { disposeChildren } from "./owner.js";
import { dirtyQueue, zombieQueue } from "./scheduler.js";
import type { Computed, Link, Signal } from "./types.js";

// https://github.com/stackblitz/alien-signals/blob/v2.0.3/src/system.ts#L100
export function unlinkSubs(link: Link): Link | null {
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
      dep._unobserved?.();
      // No more subscribers; only tear down if CONFIG_AUTO_DISPOSE is set.
      const c = dep as Computed<any>;
      (c as any)._fn &&
        c._config & CONFIG_AUTO_DISPOSE &&
        !(c._flags & REACTIVE_ZOMBIE) &&
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

export function unobserved(el: Computed<unknown>) {
  deleteFromHeap(el, queueFor(el));
  let dep = el._deps;
  while (dep !== null) {
    dep = unlinkSubs(dep);
  }
  el._deps = null;
  el._depsTail = null;
  disposeChildren(el, true);
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
}
