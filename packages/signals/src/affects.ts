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
// Representation: the mark core (affects-affects-marks.ts) — a count on the marked node,
// coverage pull-derived at probe time, readers repolled at registration and
// release. Here: each mark's scope (the transaction's `_marks`, or the
// ambient list) and the store half.
//
// Installed on `GlobalQueue` when imported: a program that never declares a
// mark carries none of this.

import { STATUS_PENDING, CONFIG_SLOT_NODE, $REFRESH } from "./core/constants.js";
import { emitDiagnostic } from "./core/dev.js";
import { flushTransaction, GlobalQueue, resolveTx, schedule } from "./core/scheduler.js";
import type { Computed } from "./core/types.js";
import { mark, repoll, unmark, type Marked } from "./affects-marks.js";
import type { Accessor } from "./signals.js";
import { installStoreAffects, releaseMarkScope, storeMarks } from "./store/affects.js";
import { $TARGET, type Store } from "./store/types.js";

/** Marks declared outside a transaction: released at the next seam. */
const ambient: Marked[] = [];

/** Releases one scope's marks (a landed transaction's, the ambient list at
 * the seam): a node whose last mark drops re-derives its verdict readers. */
function release(nodes: Marked[]): void {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    // A store mark's carrier: its scope (and the marks the nodes born in
    // its window inherited) goes with the last mark.
    if (unmark(n)) releaseMarkScope(n);
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
