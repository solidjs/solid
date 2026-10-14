// The mark core: a declared not-final state on a node that reads pending
// (`isPending` → true) on the node and everything derived from it, without
// holding anything or entangling a reader. Two declarers share it:
// `affects()` (affects.ts — a mark scoped to a transaction, with a store
// half) and `createDeferred` (deferred.ts — a mark whose lifetime is the
// node's own flight). Split out so the second does not ship the first.
//
// Representation: a count on the marked node (`_x._marks`). Coverage of the
// derivations is pull-derived at probe time — `isPending`'s read walks the
// probed node's dependencies for a marked one (verdict.ts → `_marked`) — so
// nothing is stored downstream and a mid-window recompute strands nothing.
// The push half is the verdict readers' re-derivation when a node's marks
// start and end (`repoll`): the only notification a mark makes.

import {
  CONFIG_AUTHORITATIVE,
  CONFIG_SLOT_NODE,
  CONFIG_VERDICT,
  REACTIVE_RECOMPUTING_DEPS,
  STATUS_ERROR
} from "./core/constants.js";
import { ext } from "./core/core.js";
import { enqueueSub } from "./core/heap.js";
import { GlobalQueue } from "./core/scheduler.js";
import type { Computed, Signal } from "./core/types.js";

export type Marked = Signal<any> | Computed<any>;

/** Live marks, every declarer — the gate on the probe's walk. */
let active = 0;

/** The verdict readers downstream of `node` — through derivations, stopping
 * at effects — re-derive: the mark's one notification (a probe's answer
 * changed with no value notifying anyone). Truth readers (`until`, the
 * `refresh` waiter) too, which a lagging flight parked (deferred.ts) — but
 * not through a derived store, whose leaves change only once its derive
 * re-runs: they re-derive at that write. */
export function repoll(
  node: Marked,
  seen = new Set<Computed<any>>(),
  readers = CONFIG_VERDICT | CONFIG_AUTHORITATIVE
): void {
  for (let s = node._subs; s !== null; s = s._nextSub) {
    const sub = s._sub;
    if (seen.has(sub)) continue;
    seen.add(sub);
    if (sub._config & readers) enqueueSub(sub);
    if (!(sub as any)._type) repoll(sub, seen, readers);
    // A derived store's derive: its leaves' readers derive from it too
    // (store/projection.ts; a live target's property, has and keys nodes).
    const fam = (sub as any).fam;
    if (fam)
      for (const t of fam.live)
        for (const o of [t.n, t.h, { k: t.k, d: t.dk }])
          if (o) for (const k of Reflect.ownKeys(o)) o[k] && repoll(o[k], seen, CONFIG_VERDICT);
  }
}

/** A node is covered by a live mark iff it carries one, or derives — through
 * its current dependencies — from one that does. A store slot derives from
 * its family's derive (a derived store's leaves are not the derive's
 * dependents, store/projection.ts), so coverage hops there. A real error
 * outranks an inherited mark (A24 (c)): coverage does not flow through an
 * errored node (a direct mark on one still reads pending). Mid-recompute,
 * only the validated prefix of the dependency list is this pass's. */
function marked(el: Marked, seen: Set<Marked>): boolean {
  if (el._x !== null && el._x._marks !== 0) return true;
  const c = el as Computed<any>;
  if (c._statusFlags & STATUS_ERROR || seen.has(el)) return false;
  seen.add(el);
  if (c._config & CONFIG_SLOT_NODE) {
    const derive: Marked | null | undefined = (c as any)._host?.fam?.node;
    return derive != null && marked(derive, seen);
  }
  const tail = c._flags & REACTIVE_RECOMPUTING_DEPS ? c._depsTail : undefined;
  if (tail !== null)
    for (let d = c._deps ?? null; d !== null; d = d._nextDep) {
      if (marked(d._dep, seen)) return true;
      if (d === tail) break;
    }
  return false;
}

/** One mark on `node`. The declarer repolls once its bookkeeping is done. */
export function mark(node: Marked): void {
  ext(node)._marks++;
  active++;
}

/** Drops one mark from `node`: true when it was the last — the node's
 * verdict readers have re-derived. */
export function unmark(node: Marked): boolean {
  active--;
  if (--node._x!._marks !== 0) return false;
  repoll(node);
  return true;
}

GlobalQueue._marked = el => active !== 0 && marked(el, new Set());
GlobalQueue._mark = mark;
