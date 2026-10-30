// The optimistic layer of the lanes (lanes-core.ts is the sub-hold core: what
// any lane needs — a transaction with `_lane`, link/blocked/reveal/landing,
// the rows of a seated pass, the verdict lane). This module is the guesses:
// a written guess (`optimisticWrite`, `createOptimistic`), its lane opening
// at the seam (`applyGuesses`), its truth arriving (`supersede`, a guess's
// own pass's outcome, a write landing on it), the body-end corrections
// (`laneCorrections`), a guess another action's lane takes (`take`) and
// gives back at a revert landing. Installed when `createOptimistic` or
// `createOptimisticStore` is imported: a build with `isPending`/`latest`
// alone carries the core and none of this.
//
// Lanes (plan sec. 28 replay, 2026-10-02; maintainer rulings 2026-10-01/02). A lane
// is "a new base of a transition": the sub-frame an optimistic write opens
// in the transition of the frame it is made in. It sees the screen plus its
// own guesses (plan sec. 19), breaks out of the parent's hold — its effects run now —
// and holds itself if its own derivations hit async (and, blocked, holds its
// parent). It ends when the parent lands: a guess reverts to the truth it
// covered, or lands as the truth that superseded it. A frame that does not
// park has nothing to be optimistic over: the write is void.

import {
  CONFIG_GUESS,
  CONFIG_HELD,
  CONFIG_OVERRIDE,
  CONFIG_SLOT_NODE,
  NOT_PENDING,
  STATUS_PENDING
} from "./constants.js";
import { attrHooks } from "./attribution-hooks.js";
import { ext } from "./core.js";
import { laneValueOf } from "./truth.js";
import {
  clock,
  commitPendingNode,
  GlobalQueue,
  holdNode,
  insertSubs,
  laneDirty,
  list,
  merge,
  newTransaction,
  nextQuestion,
  ownFlights,
  question,
  resolveTx,
  schedule,
  staleReader,
  txOf,
  type Transaction,
  armGuessing,
  installGuessHooks
} from "./scheduler.js";
import { dissolveLane, installOptimisticHooks, lanes, markJudged, newLane } from "./lanes-core.js";
import type { Computed, Signal } from "./types.js";

export { laneValueOf };

/** Guesses written since the last seam (`[node, value, question, …]`).
 * Applied at the seam, once the frame's verdict is known — the parent is
 * the frame's transaction, and there is none to be optimistic over when the
 * frame commits (the write is as if it never happened: nothing was
 * applied). The lane's passes run in the next round of the same flush, so
 * the guess is visible at flush like any write (A28). */
const pendingGuesses: any[] = [];
/** What the writer sees of a node: an unflushed guess to it, else the
 * lane's value or the committed one — what an optimistic updater composes
 * on (a store setter's draft too, store/optimistic.ts). */
export function guessedValueOf<T>(n: Signal<T> | Computed<T>): T {
  let g = pendingGuessOf(n);
  return g !== NOT_PENDING || (n._config & CONFIG_OVERRIDE && (g = laneValueOf(n)) !== NOT_PENDING)
    ? (g as T)
    : n._value;
}
/** The unflushed guess to `n`, else NOT_PENDING. */
export function pendingGuessOf(n: Signal<any> | Computed<any>): unknown {
  for (let i = pendingGuesses.length - 3; i >= 0; i -= 3)
    if (pendingGuesses[i] === n) return pendingGuesses[i + 1];
  return NOT_PENDING;
}
/** This module's copy of scheduler.ts `guessing`: its readers here stay
 * foldable when a bundler splits lanes.ts from scheduler.ts into separate
 * chunks (a cross-chunk binding is not folded; the compiled live page). */
let guessed = false;
/** Shadow (seat-oracle.ts): the old `enterLane`'s read of `guessed`. */
export function laneGuessed(): boolean {
  return guessed;
}
/** Guesses another action's lane took over (#4336): the node, its guess,
 * the guess's lane, its question, the lane that took it. */
const kept: any[] = [];
/** Lanes a revert dissolved: the guesses they took come back at their
 * parent's landing (`endLanes`). */
const reverted = /* @__PURE__ */ new WeakSet<Transaction>();
/** Lane `l` takes `n`'s guess (another action's), kept to come back if `l`
 * reverts. Its readers saw the guess: they re-derive at the lane's reveal
 * (and, a flight's, hold the lane while they would show it). `d`: a guess
 * `l` takes without writing it (a store target's other slots) — the node
 * shows its truth in `l`'s world until the guess comes back. */
export function take(n: Signal<any>, l: Transaction, d?: boolean): void {
  const x = n._x!;
  kept.push(n, x._lane, x._transaction, x._q, l);
  rerun(n, l);
  n._config &= d ? ~(CONFIG_GUESS | CONFIG_OVERRIDE) : ~CONFIG_GUESS;
  if (d) ((x._transaction = null), (x._lane = NOT_PENDING));
  else list(n, l);
}
/** `n`'s readers are stale readers of `t` (re-derived at its landing). */
function rerun(n: Signal<any>, t: Transaction): void {
  for (let s = n._subs; s !== null; s = s._nextSub) staleReader(s._sub, t);
}
export function optimisticWrite<T>(n: Signal<T> | Computed<T>, v: T | ((prev: T) => T)): T {
  // What the user sees: an unflushed guess to the same node, else the lane's
  // value or the committed one. The updater composes on it; guessing it
  // again is no guess (the node's comparator, as for any write) — unless
  // the node already carries one: the user re-asked, and the re-ask renews
  // the guess's question and entangles its frame (#3347) without notifying.
  const prev = guessedValueOf(n);
  if (typeof v === "function") v = (v as (prev: T) => T)(prev);
  if (n._equals && n._equals(prev, v) && !(n._config & CONFIG_GUESS)) return v;
  pendingGuesses.push(n, v, question || nextQuestion());
  armGuessing();
  guessed = true;
  schedule();
  return v;
}
/** The seam: each guess becomes its node's lane value, in a lane — the
 * node's own if it carries one (a later write into the same lane), else a
 * new one under `parent` (the frame's transaction), under the hold already
 * on the node (a guess over that transition's world — the truth it holds
 * stays staged beneath, for the lane's end to commit), or under a
 * transaction opened for the node's own in-flight refetch (the guess is
 * that flight's observer — A17, "visible until its own fetch settles"). No
 * parent: the guess is dropped. The truth is untouched; readers are
 * dirtied for the next round. */
/** A guess's own truth is in flight: the node's own refetch — or, a store
 * leaf's, its family's derive (the slot's flight; store/optimistic.ts
 * installs the resolver). A17: the guess stands in for the flight. */
function inFlight(n: Signal<any>): unknown {
  return (
    (n as Computed<any>)._statusFlags & STATUS_PENDING ||
    (n._config & CONFIG_SLOT_NODE && GlobalQueue._slotFlight?.(n))
  );
}

function applyGuesses(parent: Transaction | null): void {
  let lane: Transaction | null = null;
  for (let i = 0; i < pendingGuesses.length; i += 3) {
    const n = pendingGuesses[i] as Signal<any>;
    const v = pendingGuesses[i + 1];
    let changed = true;
    // The frame already holding the slot: a guess over it is a second
    // suggestion for the slot, and two cannot finish apart (A34 (1)) — the
    // frames entangle.
    let holder: Transaction | null = null;
    if (n._config & CONFIG_OVERRIDE) {
      // A lane's node already: a guess re-asked, or a derivation guessed
      // over (its staging is void — the guess is the value now). The same
      // value re-asked renews the question; nothing to notify.
      changed = !n._equals || !n._equals(laneValueOf(n), v);
      if (!(n._config & CONFIG_GUESS)) {
        n._pendingValue = NOT_PENDING;
        n._config |= CONFIG_GUESS;
      }
      n._x!._lane = v;
      holder = txOf(n)._parent;
    } else {
      let l: Transaction;
      // A held node: a truth staged there, or what a corrected guess showed.
      // The guess composes on it, so it ends with that hold — and with its
      // own frame's (F-11): it lands only when both have (the board's rapid
      // adds — a later add's row reverted with an earlier add's landing).
      if (n._config & CONFIG_HELD) l = newLane((holder = txOf(n)));
      else {
        if (parent === null && inFlight(n)) parent = newTransaction(false);
        if (parent === null) continue;
        l = lane ??= newLane(parent);
      }
      // (A guess equal to a truth staged beneath it is confirmed at birth —
      // A24 — and still re-derives its readers as the lane's: the truth's
      // derivations are the transaction's world, the lane's are the
      // screen's plus the guess (plan sec. 19) — a derivation reading a held write
      // beside the guess must not show it. Two flights for one input, when
      // the worlds coincide, is the price.)
      ext(n)._lane = v;
      n._config |= CONFIG_OVERRIDE | CONFIG_GUESS;
      list(n, l);
    }
    if (parent !== null && holder !== null) merge(parent, holder);
    ext(n)._q = pendingGuesses[i + 2];
    if (changed) {
      // The lane's members re-derive as its work (REACTIVE_LANE_DIRTY): a
      // blocked lane's re-guess does not re-run its render effects as stale
      // readers republishing the committed view (#3460).
      insertSubs(n);
      laneDirty(n, txOf(n));
    }
  }
  pendingGuesses.length = 0;
}

/** The truth arrived for a written guess (A18): a correction dissolves the
 * lane — the guess and everything derived from it is void, the truth is
 * the parent's held write and the graph re-derives from it there, one frame
 * at the parent's landing — while the display keeps what it shows until
 * then. A confirmation is silent (A17): the truth stays staged beneath the
 * guess for the parent's commit, the guess stays the value; only a reader
 * of the truth (CONFIG_AUTHORITATIVE) is told its view changed. Either way
 * the parent takes this node, not the tick that carried the truth (D-33):
 * one landing answering two actions' guesses (a store re-ask over two
 * rows) must not tie them together; a pass that derives from the held
 * truth joins the parent on its own (`joinPass`). */
/** The correction round is replacing a guess with the value it covered (no
 * landing beneath it): observe's "reverted"; the lane gives back the
 * guesses it took (#4336, `endLanes`). */
let reverting = false;

export function supersede(n: Signal<any> | Computed<any>, value: unknown, changed: boolean): void {
  const l = txOf(n);
  // Resolved: the parent may have merged into another transaction since the
  // lane opened (two actions guessing one slot entangle, A34 (1)) — the
  // truth is held by the transaction that lands, not the merged-away one.
  const parent = resolveTx(l._parent ?? l);
  // A store row answered by a new object the store would reconcile into
  // the guessed one unchanged is an echo, not a correction (#3898): the
  // server's object never matches the guess by reference.
  if (changed && n._config & CONFIG_SLOT_NODE && GlobalQueue._echoes?.(n._x!._lane, value))
    changed = false;
  if (changed) {
    // Observe: a displayed guess is being replaced by a differing truth — a
    // landing's (superseded), or the value it covered (reverted: the body
    // ended with nothing coming true).
    if (__OBSERVE__ && l._shown && attrHooks !== null)
      attrHooks.optimisticReverted(n, n._x!._lane, value, reverting ? "reverted" : "superseded");
    dissolveLane(l, parent, n);
    if (guessed && reverting) reverted.add(l);
    // What the screen showed stays the screen until the parent lands (A18
    // (c): display and untracked reads keep the override until the commit).
    if (l._shown) n._value = n._x!._lane;
    n._config &= ~(CONFIG_OVERRIDE | CONFIG_GUESS);
    n._x!._lane = NOT_PENDING;
    holdNode(n, parent);
    if (n._subs !== null) insertSubs(n);
  } else {
    n._config |= CONFIG_HELD;
    // A confirmation is silent (A17); only truth readers are told.
    GlobalQueue._confirmed?.(l);
  }
  n._pendingValue = value;
}

/** The value a guess covered: the node's committed value — a store slot's
 * asked of the store (a chained link follows the inner store's commits). */
function covered(n: Signal<any>): unknown {
  return n._config & CONFIG_SLOT_NODE && GlobalQueue._slotCovered !== undefined
    ? GlobalQueue._slotCovered(n)
    : n._value;
}

/** A guess in `l` whose own truth is in flight (its refetch — authoritative:
 * the landing supersedes, not the body's end). */
function guessFlights(l: Transaction): boolean {
  for (let i = 0; i < l._nodes.length; i++) {
    const n = l._nodes[i] as Computed<any>;
    if (n._config & CONFIG_GUESS && n._x!._transaction === l && inFlight(n)) return true;
  }
  return false;
}

/** The seam's verdict on a lane. Blocked — its own flight is up — nothing
 * moves: the screen keeps what it shows, the lane's runs wait. Unblocked,
 * the lane shows: its values are the screen from now (`_shown`), the
 * staging its passes made since the last reveal is promoted, their frames
 * (children) apply, the stale readers re-derive (#3460), its runs go. */
/** A18 body-end corollary (#3427), at the seam before the park decision
 * (the guesses' own passes have run; a correction's re-derivations run in
 * one more pure round and are the parent's flights before it is judged —
 * #3409: the indicators clear together): the action body having returned,
 * a guess whose own truth is not in flight has no answer coming — the truth
 * beneath it is its truth, and the correction starts now rather than at the
 * lane's flight. (A guess whose own refetch is up is superseded by its
 * landing.) True when a lane was judged. */
function laneCorrections(): boolean {
  let judged = false;
  const live = lanes.slice();
  for (let k = 0; k < live.length; k++) {
    const l = live[k];
    if (lanes.indexOf(l) === -1) continue;
    const p = resolveTx(l._parent!);
    if (!p._acted || p._open !== 0 || p._lane || ownFlights(p) || guessFlights(l)) continue;
    judged = true;
    // Each guess's truth: the one beneath it (a landing held there), else
    // the one it covered. (A correction dissolves the lane — the others are
    // re-homed with theirs, `dissolveLane`.)
    for (let i = 0; i < l._nodes.length && lanes.indexOf(l) !== -1; i++) {
      const n = l._nodes[i];
      if (n._config & CONFIG_GUESS && n._x!._transaction === l) {
        const truth = n._pendingValue !== NOT_PENDING ? n._pendingValue : covered(n);
        if (__OBSERVE__ || guessed) reverting = n._pendingValue === NOT_PENDING;
        supersede(n, truth, !n._equals || !n._equals(n._x!._lane, truth));
        if (__OBSERVE__ || guessed) reverting = false;
      }
    }
  }
  return judged;
}

/** A written guess's own pass finished: its source recomputed it — the
 * truth (A18: "the source is whatever recomputes the node"), authoritative
 * or the lane's own derivation (a guess over `config().courier` under a
 * country guess: the lane's config landing confirms or corrects it). An
 * errored pass stages nothing. Provenance (A18, #3331): "the source" is the
 * guess's own question or a newer one; an older action's answer landing
 * over a newer guess (the two entangled when the newer guess was written)
 * is stale — a slow source leaking back in over the user's latest intent.
 * It is staged beneath the guess, for the commit like any landing, and
 * nothing moves: no downstream re-ask, no pending flip on the guess's
 * readers (`isPending` of the guess itself says the held truth differs,
 * A24). The guess's own question answering supersedes as usual. */
function laneOutcome(el: Computed<any>, value: unknown, errored: boolean): boolean {
  if (errored) return true;
  if (stale(el, answered(el))) {
    el._pendingValue = value;
    el._config |= CONFIG_HELD;
    return true;
  }
  supersede(el, value, !el._equals || !el._equals(el._x!._lane, value));
  return true;
}

/** THE provenance test, for a derivation's pass and a write alike: an
 * answer to question `q` landing on a guess is stale when `q` is older
 * than the guess's own; unstamped (0) and mainline are current. */
function stale(el: Signal<any> | Computed<any>, q: number): boolean {
  return q !== 0 && q < el._x!._q;
}

/** The question a derivation's pass answered: the newest among the stamped
 * sources that changed this round (a flight's landing carries the question
 * that started it); 0 when none is stamped. */
function answered(el: Computed<any>): number {
  let q = 0;
  for (let l = el._deps; l !== null; l = l._nextDep) {
    const d = l._dep as Computed<any>;
    if (d._x !== null && d._x._q > q && d._time === clock) q = d._x._q;
  }
  return q;
}

/** A write landing on a written guess (lanes-core.ts `laneWrite`): its truth
 * (A18 — an async guess's own landing), judged against the guess. False
 * when the slot's guess was its derive's re-ask in another action's lane:
 * the write is that lane's derivation from here (store `_slotTake`, #4336),
 * and `laneWrite` goes on with it. */
function guessWrite(el: Signal<any> | Computed<any>, v: unknown): boolean {
  if (guessed && GlobalQueue._slotTake?.(el)) return false;
  // Provenance (A18, #3331; Q-D, plan sec. 39): a write asking an OLDER
  // question than the guess's — another action's landing beneath it —
  // is not its answer: held beneath (the truth for the commit; the
  // guess's own question judges), and nothing moves. The writer's
  // question is the one being asked (`question`: a slice's, a derive's
  // continuation's — the flight's); unstamped writes and mainline are
  // current.
  // A store re-bases a keyed arrangement guess over an older truth, and
  // folds a current one beneath it (D-34): true.
  const older = stale(el, question);
  if (GlobalQueue._laneRebase?.(el, v, older) || older) {
    el._pendingValue = v;
    el._config |= CONFIG_HELD;
    schedule();
    return true;
  }
  supersede(el, v, !el._equals || !el._equals(el._x!._lane, v));
  schedule();
  return true;
}

/** The seam: the lanes alive before this seam's guesses open theirs are
 * judged this seam (lanes-core.ts `markJudged`); then the guesses written
 * since the last seam open their lanes (`applyGuesses`). */
const applyGuessesAt = (parent: Transaction | null): void => {
  markJudged();
  if (pendingGuesses.length !== 0) applyGuesses(parent);
};

/** The parent `u` landed (lanes-core.ts `endLanes`): a revert landing
 * (#4336) gives back the guesses its lane took from another action that is
 * still out, in this frame, over the truth it lands — its readers re-derive
 * with the landing (one frame, no bare truth between). Taken by a later
 * lane since, a node stays that lane's. */
function revertLanding(u: Transaction): void {
  for (let i = kept.length - 5; i >= 0; i -= 5)
    if (resolveTx(kept[i + 4]._parent) === u) {
      let [n, v, g, q, t] = kept.splice(i, 5);
      // (A store slot's node now: the one taken, or a read's since.)
      if (
        reverted.has(t) &&
        lanes.includes(g) &&
        (!(n._config & CONFIG_SLOT_NODE) || (n = GlobalQueue._slotTake!(n, true)))
      ) {
        const x = ext(n);
        if (x._transaction === null || txOf(n) === u) {
          commitPendingNode(n);
          x._lane = v;
          x._q = q;
          n._config |= CONFIG_OVERRIDE | CONFIG_GUESS;
          list(n, g);
          rerun(n, u);
        }
      }
    }
}

installGuessHooks(laneOutcome, applyGuessesAt, () => lanes.length !== 0 && laneCorrections());
installOptimisticHooks(guessFlights, take, covered, guessWrite, revertLanding);
if (__OBSERVE__)
  GlobalQueue._laneGuesses = t => {
    const out: Signal<any>[] = [];
    for (let i = 0; i < lanes.length; i++) {
      const l = lanes[i];
      if (resolveTx(l._parent!) !== t) continue;
      for (let j = 0; j < l._nodes.length; j++)
        if (l._nodes[j]._config & CONFIG_GUESS && l._nodes[j]._x!._transaction === l)
          out.push(l._nodes[j]);
    }
    return out;
  };
