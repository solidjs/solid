// `affects()` — the declaration verb of the pending model (A24 (4), ruled
// 2026-07-13; the #2893 audit corollaries; rebuilt on L2 2026-10-02 as ruled:
// transaction-inert).
//
// A mark is a declared in-flight change: the marked node — and everything
// derived from it — reads pending (`isPending` → true) from the declaration
// until the surrounding transaction lands (an ambient mark, declared outside
// one, releases at the next seam). The marked values stay readable: no reader
// suspends on a mark, a mark holds nothing and entangles nothing — it is not
// a node of its transaction (`blocked` never sees it), and a reader of marked
// data joins nothing through it. A mark is never a re-ask, so a declared
// reload's own `refresh()` cannot silence it; a real error outranks it.
//
// Representation: a count on the marked node (`_x._marks`), listed with its
// scope (the transaction's `_marks`, or the ambient list). Coverage of the
// derivations is pull-derived at probe time — `isPending`'s read walks the
// probed node's dependencies for a marked one (verdict.ts → `_marked`) — so
// nothing is stored downstream and a mid-window recompute strands nothing.
// The push half is the verdict readers' re-derivation at registration and at
// release (`repoll`): the only notification a mark makes.
//
// Installed on `GlobalQueue` when imported: a program that never declares a
// mark carries none of this.

import {
  REACTIVE_RECOMPUTING_DEPS,
  STATUS_ERROR,
  STATUS_PENDING,
  CONFIG_SLOT_NODE,
  CONFIG_VERDICT,
  $REFRESH
} from "./core/constants.js";
import { ext } from "./core/core.js";
import { emitDiagnostic } from "./core/dev.js";
import { enqueueSub } from "./core/heap.js";
import { flushTransaction, GlobalQueue, resolveTx, schedule } from "./core/scheduler.js";
import type { Computed, Signal } from "./core/types.js";
import type { Accessor } from "./signals.js";
import { installStoreAffects, releaseMarkScope, storeMarks } from "./store/affects.js";
import { $TARGET, type Store } from "./store/types.js";

type Marked = Signal<any> | Computed<any>;

/** Live marks, every scope — the gate on the probe's walk. */
let active = 0;
/** Marks declared outside a transaction: released at the next seam. */
const ambient: Marked[] = [];

/** The verdict readers downstream of `node` — through derivations, stopping
 * at effects — re-derive: the mark's one notification (a probe's answer
 * changed with no value notifying anyone). */
function repoll(node: Marked, seen = new Set<Computed<any>>()): void {
  for (let s = node._subs; s !== null; s = s._nextSub) {
    const sub = s._sub;
    if (seen.has(sub)) continue;
    seen.add(sub);
    if (sub._config & CONFIG_VERDICT) enqueueSub(sub);
    if (!(sub as any)._type) repoll(sub, seen);
  }
}

/** A node is covered by a live mark iff it carries one, or derives — through
 * its current dependencies — from one that does. A real error outranks an
 * inherited mark (A24 (c)): coverage does not flow through an errored node
 * (a direct mark on one still reads pending). Mid-recompute, only the
 * validated prefix of the dependency list is this pass's. */
function marked(el: Marked, seen: Set<Marked>): boolean {
  if (el._x !== null && el._x._marks !== 0) return true;
  const c = el as Computed<any>;
  if (c._statusFlags & STATUS_ERROR || seen.has(el)) return false;
  seen.add(el);
  const tail = c._flags & REACTIVE_RECOMPUTING_DEPS ? c._depsTail : undefined;
  if (tail !== null)
    for (let d = c._deps ?? null; d !== null; d = d._nextDep) {
      if (marked(d._dep, seen)) return true;
      if (d === tail) break;
    }
  return false;
}

/** Releases one scope's marks (a landed transaction's, the ambient list at
 * the seam): a node whose last mark drops re-derives its verdict readers. */
function release(nodes: Marked[]): void {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    active--;
    if (--n._x!._marks === 0) {
      repoll(n);
      // A store mark's carrier: its scope (and the marks the nodes born in
      // its window inherited) goes with it.
      releaseMarkScope(n);
    }
  }
  nodes.length = 0;
}

/** One registration: a count on the node, listed with the scope — the
 * flush's transaction, or the ambient list (released at the seam). */
function register(node: Marked): void {
  mark(node);
  const t = flushTransaction;
  if (t === null) ambient.push(node);
  else {
    const u = resolveTx(t);
    (u._marks ??= []).push(node);
  }
  repoll(node);
}
function mark(node: Marked): void {
  ext(node)._marks++;
  active++;
}

/**
 * Declares that in-flight work will change the targeted data: the source —
 * and everything derived from it — reads as pending (`isPending` → `true`)
 * from the declaration until the surrounding transaction settles. A mark is
 * a promise of change, not an absence of value: the marked values stay
 * readable, no reader suspends on one, and it holds nothing — the
 * transaction's completion never waits on a mark. Pendingness is additive:
 * a mark can turn pending on for data the graph cannot see changing yet
 * (a declared reload's `refresh()` is a quiet re-ask on its own); nothing
 * turns it off while the mark is live.
 *
 * Typically called at the top of an `action` alongside optimistic writes —
 * both are up-front declarations about the same mutation. Outside any
 * transaction the mark is released at the end of the current flush.
 *
 * @example
 * ```ts
 * const reload = action(function* () {
 *   affects(thing);      // `thing` and its derivations pend…
 *   refresh(thing);      // …over this otherwise-quiet re-ask
 *   yield api.done();
 * });
 * ```
 */
export function affects(target: Accessor<unknown> | Store<object>): void;
export function affects<T extends object>(target: Store<T>, key: keyof T): void;
export function affects(target: any, key?: PropertyKey): void {
  if (__DEV__ && arguments.length > 2)
    invalid(
      "affects() takes a single optional key — extra keys are not a path. Mark each slot " +
        'with its own affects(record, key) call, or pass the nested record itself: affects(state.user, "name").'
    );
  // A store (the store half, store/affects.ts): the slot's leaf, or the
  // record's carrier and every live node under it.
  const t = target?.[$TARGET];
  if (t !== undefined) {
    installStoreAffects();
    const nodes = storeMarks(t, key);
    for (let i = 0; i < nodes.length; i++) register(nodes[i]);
    schedule();
    return;
  }
  const node: Marked | undefined = target?.[$REFRESH];
  if (!node) {
    if (__DEV__)
      invalid(
        "affects() expects a Solid source accessor or a store. Pass the store proxy (optionally " +
          "with a property key) or the original accessor, not a wrapper function or an already-read value."
      );
    return;
  }
  if (__DEV__ && key !== undefined)
    invalid(
      "affects() keys are only valid on store targets. An accessor is a single slot — pass it " +
        "alone, or target the store record that owns the property."
    );
  register(node);
  schedule();
}

function invalid(detail: string): never {
  const message = "[INVALID_AFFECTS_TARGET] " + detail;
  emitDiagnostic({ code: "INVALID_AFFECTS_TARGET", kind: "write", severity: "error", message });
  throw new Error(message);
}

GlobalQueue._marked = el => active !== 0 && marked(el, new Set());
GlobalQueue._mark = mark;
GlobalQueue._releaseMarks = release;
GlobalQueue._releaseAmbientMarks = parked => {
  if (ambient.length === 0) return;
  // The flush parked: the declaration's window is the frame's — the marks
  // are its transaction's ("nothing async below ⇒ no window").
  if (parked !== null) {
    const list = (parked._marks ??= []);
    for (let i = 0; i < ambient.length; i++) list.push(ambient[i]);
    ambient.length = 0;
    return;
  }
  // Nothing parked, but a marked node's own flight is up (a declared
  // reload's quiet re-ask — the node's, or a store leaf's family derive):
  // the window is the flight's; the mark stays to the seam after the
  // landing. The rest release: verdict-only, nothing to show.
  let kept = 0;
  const done: Marked[] = [];
  for (let i = 0; i < ambient.length; i++) {
    const n = ambient[i];
    if (inFlight(n)) ambient[kept++] = n;
    else done.push(n);
  }
  ambient.length = kept;
  if (done.length !== 0) release(done);
};
function inFlight(n: Marked): boolean {
  return (
    ((n as Computed<any>)._statusFlags & STATUS_PENDING) !== 0 ||
    ((n._config & CONFIG_SLOT_NODE) !== 0 && GlobalQueue._slotFlight?.(n) === true)
  );
}
