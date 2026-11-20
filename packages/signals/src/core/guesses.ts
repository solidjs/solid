// The guess layer: written optimistic values (F-11, D-33, D-34). lanes.ts
// holds what every lane needs; this module holds what only a guess reaches.
// Installed through `installGuessLayer` and `installGuessHooks`, and only
// this module sets CONFIG_GUESS, so a bundle without optimism drops it all.

import {
  CONFIG_GUESS,
  CONFIG_HELD,
  CONFIG_INPUTS_PUBLISHED,
  CONFIG_OVERRIDE,
  CONFIG_SLOT_NODE,
  NOT_PENDING,
  REACTIVE_ZOMBIE
} from "./constants.js";
import { attrHooks } from "./attribution-hooks.js";
import { ext } from "./core.js";
import { devWarnOptimisticWhileLoading } from "./dev.js";
import { covers, latestOf, underOf } from "./truth.js";
import {
  armGuessing,
  clock,
  GlobalQueue,
  holdNode,
  insertSubs,
  installGuessHooks,
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
  type Transaction
} from "./scheduler.js";
import {
  armGuessed,
  dissolveLane,
  guessFlights,
  inFlight,
  installGuessLayer,
  landBeneath,
  lanes,
  marked,
  markJudged,
  newLane,
  readGuesses,
  setLaneValue
} from "./lanes.js";
import type { Computed, Signal } from "./types.js";

/** Guesses written since the last seam, as `[node, value, question, …]`.
 * Applied at the seam: only then is it known whether there is a hold to
 * guess over (D-33). */
const pendingGuesses: any[] = [];
/** The lanes this seam's guesses read from (D-33). */
const readFrom: Transaction[] = [];
/** What an optimistic updater composes on (F-10: the writer sees its own
 * unflushed writes). */
export function guessedValueOf<T>(n: Signal<T> | Computed<T>): T {
  let g = pendingGuessOf(n);
  return g !== NOT_PENDING || (n._config & CONFIG_OVERRIDE && (g = latestOf(n)) !== NOT_PENDING)
    ? (g as T)
    : n._value;
}
export function pendingGuessOf(n: Signal<any> | Computed<any>): unknown {
  for (let i = pendingGuesses.length - 3; i >= 0; i -= 3)
    if (pendingGuesses[i] === n) return pendingGuesses[i + 1];
  return NOT_PENDING;
}
export function optimisticWrite<T>(n: Signal<T> | Computed<T>, v: T | ((prev: T) => T)): T {
  if (__DEV__) devWarnOptimisticWhileLoading(n as Computed<T>);
  const prev = guessedValueOf(n);
  if (typeof v === "function") v = (v as (prev: T) => T)(prev);
  // Equal is no guess, unless the node carries one: re-asking renews its question (#3347).
  if (n._equals && n._equals(prev, v) && !(n._config & CONFIG_GUESS)) return v;
  pendingGuesses.push(n, v, question || nextQuestion());
  if (__OBSERVE__ && attrHooks !== null) attrHooks.staged(n);
  for (let i = 0; i < readGuesses.length; i += 2)
    if (readGuesses[i + 1] === question) readFrom.push(readGuesses[i] as Transaction);
  armGuessing();
  armGuessed();
  schedule();
  return v;
}
/** Each guess becomes its node's lane value. With no hold to guess over
 * and no flight of its own, the guess is dropped (D-33). */
function applyGuesses(parent: Transaction | null): void {
  let lane: Transaction | null = null;
  for (let i = 0; i < pendingGuesses.length; i += 3) {
    const n = pendingGuesses[i] as Signal<any>;
    const v = pendingGuesses[i + 1];
    let changed = true,
      wait = false;
    // A guess over a slot another frame holds entangles the frames (D-8, D-33).
    let holder: Transaction | null = null;
    if (n._config & CONFIG_OVERRIDE) {
      changed = !n._equals || !n._equals(latestOf(n), v);
      if (!(n._config & CONFIG_GUESS)) {
        n._pendingValue = NOT_PENDING;
        n._config |= CONFIG_GUESS;
      } else if (n._x!._shown) wait = true;
      // A shown guess re-asked waits for the lane's next reveal (F-1, S-30).
      if (wait) txOf(n)._reguessed = clock;
      setLaneValue(n, txOf(n), v, wait);
      holder = txOf(n)._parent;
    } else {
      let l: Transaction;
      // Over a held node the guess composes on the held value, so it lives
      // until both holds end (F-11).
      if (n._config & CONFIG_HELD) l = newLane((holder = txOf(n)));
      else {
        if (parent === null && inFlight(n)) parent = newTransaction(false);
        if (parent === null) continue;
        l = lane ??= newLane(parent);
      }
      // Even a guess equal to the truth beneath it re-derives its readers in
      // the lane: a lane derivation must not show the hold's other writes (F-1).
      n._config |= CONFIG_OVERRIDE | CONFIG_GUESS;
      list(n, l);
      setLaneValue(n, l, v);
    }
    if (parent !== null && holder !== null) merge(parent, holder);
    ext(n)._q = pendingGuesses[i + 2];
    if (changed) {
      // As lane work, so a blocked lane's re-guess does not republish the committed view (#3460).
      laneDirty(n, txOf(n));
    }
  }
  pendingGuesses.length = 0;
}
/** `markJudged` first: a lane born at this seam has no work to judge yet. */
const applyGuessesAt = (parent: Transaction | null): void => {
  markJudged();
  if (pendingGuesses.length !== 0) {
    // A guess written after reading another hold's guess entangles the holds (D-33).
    if (parent !== null) for (const r of readFrom) if (lanes.includes(r)) merge(parent, r._parent!);
    applyGuesses(parent);
  }
  // Keep reads of live lanes: the reading action may guess after a yield.
  let k = 0;
  for (let i = 0; i < readGuesses.length; i += 2)
    if (lanes.includes(readGuesses[i] as Transaction))
      ((readGuesses[k++] = readGuesses[i]), (readGuesses[k++] = readGuesses[i + 1]));
  readFrom.length = 0;
  readGuesses.length = k;
};

/** A guess's truth arrived: a different one corrects, an equal one confirms
 * (F-11, D-34). The truth is held by the guess's hold, not by the tick that
 * carried it, so one landing answering two actions' guesses does not
 * entangle them (D-33). */
export function supersede(n: Signal<any> | Computed<any>, value: unknown, changed: boolean): void {
  const l = txOf(n);
  // The parent may have merged since the lane opened (D-33).
  const parent = resolveTx(l._parent ?? l);
  // A new server object that reconciles to the guessed row unchanged confirms (#3898).
  if (changed && n._config & CONFIG_SLOT_NODE && GlobalQueue._echoes?.(latestOf(n), value))
    changed = false;
  if (changed) {
    dissolveLane(l, parent, n);
    // A shown guess stays on screen until the commit (D-34), so the
    // published-inputs mark no longer applies (#4795).
    if (l._shown) (marked.add(n), (n._config &= ~CONFIG_INPUTS_PUBLISHED));
    n._config &= ~(CONFIG_OVERRIDE | CONFIG_GUESS);
    n._x!._shown = n._x!._revert = false;
    covers.delete(n);
    holdNode(n, parent);
    n._pendingValue = value;
    // A zombie reading the slot is still on screen (D-9). If this flush
    // parks, its queued pass is cancelled: the correction's landing re-runs
    // it, or it keeps showing the guess (#5077).
    for (let s = n._subs; s; s = s._nextSub)
      if (s._sub._flags & REACTIVE_ZOMBIE) staleReader(s._sub, parent);
    if (n._subs !== null) insertSubs(n);
  } else {
    landBeneath(n, value);
    GlobalQueue._confirmed?.(l);
  }
}

/** Body-end correction (D-34): once the action body has returned and no
 * truth is in flight, the truth at hand judges each guess. Runs before the
 * park decision so the correction's flights are the parent's (#3409). True
 * when a lane was judged. */
function laneCorrections(): boolean {
  let judged = false;
  const live = lanes.slice();
  for (let k = 0; k < live.length; k++) {
    const l = live[k];
    if (lanes.indexOf(l) === -1) continue;
    const p = resolveTx(l._parent!);
    if (!p._acted || p._open !== 0 || p._lane || ownFlights(p) || guessFlights(l)) continue;
    judged = true;
    // A correction dissolves the lane, so re-check membership each step.
    for (let i = 0; i < l._nodes.length && lanes.indexOf(l) !== -1; i++) {
      const n = l._nodes[i];
      if (n._config & CONFIG_GUESS && n._x!._transaction === l) {
        const truth = underOf(n);
        supersede(n, truth, !n._equals || !n._equals(latestOf(n), truth));
      }
    }
  }
  return judged;
}

/** A write landing on a guess: its truth, judged or held beneath (D-34). */
function guessWrite(el: Signal<any> | Computed<any>, v: unknown): void {
  GlobalQueue._slotMerge?.(el);
  // Provenance (D-34): an older question's answer is held beneath, not judged.
  const older = stale(el, question);
  if (GlobalQueue._laneRebase?.(el, v, older) || older) landBeneath(el, v);
  else supersede(el, v, !el._equals || !el._equals(latestOf(el), v));
  schedule();
}

/** A guess's own pass finished: whatever recomputes the node is its
 * source (D-34). An errored pass stages nothing; a stale answer is held
 * beneath (provenance, D-34). */
function laneOutcome(el: Computed<any>, value: unknown, errored: boolean): boolean {
  if (errored) return true;
  if (stale(el, answered(el))) {
    landBeneath(el, value);
    return true;
  }
  supersede(el, value, !el._equals || !el._equals(latestOf(el), value));
  return true;
}

/** Provenance (D-34): unstamped (0) answers are current. */
function stale(el: Signal<any> | Computed<any>, q: number): boolean {
  return q !== 0 && q < el._x!._q;
}

/** The newest question among the sources that changed this round; 0 when none is stamped. */
function answered(el: Computed<any>): number {
  let q = 0;
  for (let l = el._deps; l !== null; l = l._nextDep) {
    const d = l._dep as Computed<any>;
    if (d._x !== null && d._x._q > q && d._time === clock) q = d._x._q;
  }
  return q;
}

installGuessLayer(guessWrite);
installGuessHooks(laneOutcome, applyGuessesAt, () => lanes.length !== 0 && laneCorrections());
