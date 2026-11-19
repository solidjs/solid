// Nothing in the core imports this module: it is reached only through the
// attribution entry, and the core keeps two slots for it (scheduler.ts
// `viewHold`, `viewSkip`) that fold away in a bundle that never opens a view
// (bundle size).

import {
  CONFIG_GUESS,
  CONFIG_HELD,
  EFFECT_TRACKED,
  EFFECT_USER,
  NOT_PENDING,
  REACTIVE_DISPOSED
} from "./constants.js";
import { optimisticWrite } from "./guesses.js";
import { enqueueSub } from "./heap.js";
import { dissolveLane, landBeneath, lanes } from "./lanes.js";
import {
  actionDepth,
  flush,
  globalQueue,
  liveTx,
  newTransaction,
  resolveTx,
  schedule,
  setView,
  txOf,
  type Transaction
} from "./scheduler.js";
import type { Computed, Signal } from "./types.js";

type Node = Signal<any> | Computed<any>;

/** @experimental */
export interface ViewOptions {
  /**
   * Run user effects (`createEffect`, `createTrackedEffect`) while the view
   * is open. Default `false`: each waits for the landing, and runs then only
   * if a source's truth moved beneath the view.
   */
  effects?: boolean;
}

/** @experimental */
export interface View {
  /**
   * Show `values`: each node is shown at its value, as an optimistic guess
   * over a hold only the view closes ("pin"). Replaces the whole pin set: a
   * node pinned before and absent here goes back to what it showed when the
   * view opened. A signal, a store property and an async derivation are
   * pinned; a synchronous derivation is not, it re-derives from the pins.
   * Disposed nodes are skipped. Throws after the view was left.
   */
  show(values: ReadonlyMap<object, unknown>): void;
  /**
   * Leave the view: everything the program did beneath it lands as one
   * transition, and each held-back pass (an async derivation's, a user
   * effect's) runs once if a source's truth moved. Returns `false` while
   * that transition waits on async work; the view stays on screen until it
   * lands (`landing()`).
   */
  resume(): boolean;
  /**
   * Leave the view by making the shown values the truth: the writes made
   * beneath it are dropped, and the program continues from the pins.
   */
  branch(): void;
  /** After `resume()`: its transition has not landed yet. */
  landing(): boolean;
}

let open: View | null = null;

function isComputed(n: Node): n is Computed<any> {
  return (n as Computed<any>)._fn !== undefined;
}

function height(n: Node): number {
  return isComputed(n) ? n._height : -1;
}

function disposed(n: Node): boolean {
  return isComputed(n) && (n._flags & REACTIVE_DISPOSED) !== 0;
}

// No field says a derivation asked: `_q` is stamped by every flight, and by
// a guess too, so a synchronous optimistic memo that carried a guess reads as
// one that asked (D-34).
function asked(n: Computed<any>): boolean {
  return n._x !== null && n._x._q !== 0;
}

function pinnable(n: Node): boolean {
  return !isComputed(n) || (!disposed(n) && asked(n));
}

function idle(what: string): void {
  if (globalQueue._running || actionDepth !== 0)
    throw new Error(
      `${what} was called inside a flush, an effect or an action body. ` +
        "A view flushes on its own: call it from an event handler or a timer."
    );
}

/**
 * Opens a view: from now on every flush joins one hold that only the view
 * closes, so the program keeps running beneath it and nothing it does shows
 * until `resume()`. `show()` chooses what the screen shows meanwhile.
 *
 * One view at a time: throws while another is open, and inside a flush, an
 * effect or an action body.
 *
 * A view records nothing: the steps a time-travel tool shows come from the
 * attribution engine's `flush` record. It works with the engine on or off.
 *
 * Observe and dev tiers. The prod twin shows nothing and resumes at once.
 *
 * @experimental The semantics may change in a minor release.
 */
export function openView(options?: ViewOptions): View {
  if (open !== null) throw new Error("openView: a view is already open.");
  idle("openView");
  const effects = options?.effects === true;
  const pins = new Map<Node, unknown>();
  const present = new Map<Node, unknown>();
  const frozen = new Set<Computed<any>>();
  let hold: Transaction | null = null;
  let landed: Transaction | null = null;

  const skip = (n: Computed<any>): boolean => {
    if (pins.has(n)) return true;
    if (effects) return false;
    const type = (n as { _type?: number })._type;
    if (type !== EFFECT_USER && type !== EFFECT_TRACKED) return false;
    frozen.add(n);
    return true;
  };

  // A held-back pass is owed when a truth beneath the view ended somewhere
  // other than where the view opened over it, upstream of the pass.
  const owes = (n: Computed<any>, seen: Set<Node>): boolean => {
    for (let d = n._deps; d !== null; d = d._nextDep) {
      const dep = d._dep;
      if (seen.has(dep)) continue;
      seen.add(dep);
      if (present.has(dep)) {
        if (dep._pendingValue !== NOT_PENDING && !Object.is(dep._pendingValue, present.get(dep)))
          return true;
        if (isComputed(dep) && owes(dep, seen)) return true;
      } else if (isComputed(dep)) {
        if (owes(dep, seen)) return true;
      } else if (dep._pendingValue !== NOT_PENDING && !Object.is(dep._pendingValue, dep._value))
        return true;
    }
    return false;
  };

  const close = (t: Transaction, kept: Node[] | null): boolean => {
    open = null;
    hold = null;
    pins.clear();
    frozen.clear();
    t = resolveTx(t);
    t._open--;
    landed = t;
    setView(null, kept && (n => kept.indexOf(n) !== -1));
    schedule();
    try {
      flush();
    } finally {
      setView(null);
    }
    if (liveTx(landed) === null) landed = null;
    present.clear();
    return landed === null;
  };

  const view: View = {
    show(values) {
      if (hold === null) throw new Error("View.show: the view was left.");
      idle("View.show");
      const next = new Map<Node, unknown>();
      for (const [n, v] of values as ReadonlyMap<Node, unknown>) if (pinnable(n)) next.set(n, v);
      // A guess is replaced, never withdrawn (D-33).
      for (const n of pins.keys()) if (!next.has(n) && !disposed(n)) next.set(n, present.get(n));
      for (const n of pins.keys()) if (!next.has(n)) pins.delete(n);
      // Async derivations before their inputs, readers before their sources:
      // a guess on a node an earlier guess of the same seam put in its lane
      // opens a lane nested under that one, and `blocked` recurses on the pair
      // forever (lanes.ts `linkBlocked`, `nestedBlocked`).
      const order = [...next.keys()].sort((a, b) => height(b) - height(a));
      for (const n of order) {
        if (!present.has(n)) present.set(n, n._value);
        pins.set(n, next.get(n));
        optimisticWrite(n, next.get(n));
      }
      schedule();
      flush();
      // The present is the truth beneath each pin: an updater the program
      // runs composes on it (F-10).
      for (const n of pins.keys())
        if (n._config & CONFIG_GUESS && n._pendingValue === NOT_PENDING)
          landBeneath(n, present.get(n));
    },
    resume() {
      const t = hold;
      if (t === null) return landed === null || liveTx(landed) === null;
      idle("View.resume");
      const kept: Node[] = [];
      const owed: Computed<any>[] = [];
      for (const n of pins.keys())
        if (isComputed(n) && !disposed(n)) (owes(n, new Set()) ? owed : kept).push(n);
      for (const n of frozen) if (!disposed(n)) (owes(n, new Set()) ? owed : kept).push(n);
      // The view's lanes dissolve into the hold: each pin's truth is the
      // hold's to land, and its readers re-derive there (F-1, D-34).
      const h = resolveTx(t);
      for (const l of lanes.slice())
        if (l._parent !== null && resolveTx(l._parent) === h && l._nodes.some(n => pins.has(n)))
          dissolveLane(l, h);
      for (let i = 0; i < owed.length; i++) enqueueSub(owed[i]);
      return close(t, kept);
    },
    branch() {
      const t = hold;
      if (t === null) return;
      idle("View.branch");
      const h = resolveTx(t);
      for (const [n, v] of pins) if (n._config & CONFIG_GUESS && !disposed(n)) landBeneath(n, v);
      for (let i = 0; i < h._nodes.length; i++) {
        const n = h._nodes[i];
        if (
          !isComputed(n) &&
          (n._config & (CONFIG_HELD | CONFIG_GUESS)) === CONFIG_HELD &&
          n._x !== null &&
          n._x._transaction !== null &&
          txOf(n) === h &&
          n._pendingValue !== NOT_PENDING &&
          !Object.is(n._pendingValue, n._value)
        ) {
          n._pendingValue = n._value;
          for (let s = n._subs; s !== null; s = s._nextSub) enqueueSub(s._sub);
        }
      }
      close(t, null);
      landed = null;
    },
    landing: () => landed !== null && liveTx(landed) !== null
  };

  // What is staged now is the present the view opens over.
  flush();
  hold = newTransaction(false);
  hold._open = 1;
  open = view;
  setView(hold, skip);
  return view;
}
