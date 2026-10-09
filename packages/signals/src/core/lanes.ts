// Lanes (plan sec. 28 replay, 2026-10-02; maintainer rulings 2026-10-01/02). A lane
// is "a new base of a transition": the sub-frame an optimistic write opens
// in the transition of the frame it is made in. It sees the screen plus its
// own guesses (plan sec. 19), breaks out of the parent's hold — its effects run now —
// and holds itself if its own derivations hit async (and, blocked, holds its
// parent). It ends when the parent lands: a guess reverts to the truth it
// covered, or lands as the truth that superseded it. A frame that does not
// park has nothing to be optimistic over: the write is void.
//
// Three places per node, each meaning one thing always: `_value` is the
// committed truth, `_pendingValue` a transaction's staging (the future), and
// `_x._lane` the lane's value — a written guess or a lane pass's derivation.
// The lane carries the state machine: `_shown` once it has revealed. The
// screen shows a lane's value once the lane has shown (`display`); a direct
// read sees it throughout (A17); an authoritative reader (`until`) sees the
// truth beneath it (Q3, 2026-10-02: "optimistic overrides are intentionally
// not part of authoritative truth").
//
// The seat of a pass is its node's (core.ts `recompute`): a node carrying a
// lane's derived value runs as the lane's whoever dirtied it; a derivation's
// tracked read of a lane's value moves its pass into the lane (`enterLane`);
// a leaf's never does — it reads the screen, a stale reader of a lane that
// has not shown (#3460). Lane work's values go to the lane slot (or, once
// the lane has shown, to its staging for the next reveal), its runs to the
// lane's queues.
//
// This module is the lane engine, installed on `GlobalQueue` when something
// imports it (`createOptimistic`, or verdict.ts for its verdict lanes). The
// core keeps only bit tests and `passLane`: a program with no optimism
// carries none of this.

import {
  CONFIG_AUTHORITATIVE,
  CONFIG_CHILDREN_FORBIDDEN,
  CONFIG_GUESS,
  CONFIG_HELD,
  CONFIG_INPUTS_PUBLISHED,
  CONFIG_OVERRIDE,
  CONFIG_SLOT_NODE,
  CONFIG_STAGED,
  CONFIG_VERDICT,
  EFFECT_RENDER,
  NOT_PENDING,
  REACTIVE_CHECK,
  REACTIVE_DIRTY,
  REACTIVE_DISPOSED,
  REACTIVE_FRAME_READ,
  REACTIVE_IN_HEAP,
  REACTIVE_JOINED,
  REACTIVE_LANE_DIRTY,
  REACTIVE_LANE_READ,
  REACTIVE_PROBE_UNANSWERED,
  REACTIVE_RECOMPUTING_DEPS,
  REACTIVE_SCREEN_READ,
  STATUS_PENDING,
  STATUS_UNINITIALIZED
} from "./constants.js";
import { attrHooks } from "./attribution-hooks.js";
import { ext, stagedRead, tracking } from "./core.js";
import { NotReadyError } from "./error.js";
import { enqueueSub } from "./heap.js";
import {
  blocked,
  clock,
  commitPendingNode,
  flushTransaction,
  GlobalQueue,
  holdNode,
  insertSubs,
  joinFuture,
  laneDirty,
  list,
  merge,
  newTransaction,
  nextQuestion,
  ownFlights,
  passLane,
  question,
  queuePendingNode,
  releaseQueues,
  reruns,
  resolveTx,
  sameLane,
  schedule,
  setPassLane,
  txOf,
  type Transaction
} from "./scheduler.js";
import type { Computed, Signal } from "./types.js";

/** Live lanes (parented). Scanned at every seam while non-empty. */
const lanes: Transaction[] = [];
/** A pass left a shown slot the equality gate can no longer see (#3892). */
const LEFT_SHOWN = 1 << 20;
function newLane(parent: Transaction): Transaction {
  const l = newTransaction(true, parent);
  lanes.push(l);
  return l;
}

/** A lane node's current value: its guess, or the latest it derived — the
 * staging a shown lane holds for its next reveal, else its slot; the
 * committed value while it has none (its first lane pass in flight). */
export function laneValueOf(el: Signal<any> | Computed<any>): unknown {
  if (!(el._config & CONFIG_GUESS) && el._pendingValue !== NOT_PENDING) return el._pendingValue;
  const v = el._x!._lane;
  return v !== NOT_PENDING ? v : el._value;
}
/** What the screen shows for a lane's node: the lane's value once the lane
 * has revealed, the committed truth before. */
export function display(el: Signal<any> | Computed<any>): unknown {
  const v = el._x!._lane;
  return el._x!._transaction!._shown && v !== NOT_PENDING ? v : el._value;
}

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
  const g = pendingGuessOf(n);
  if (g !== NOT_PENDING) return g as T;
  return n._config & CONFIG_OVERRIDE ? (laneValueOf(n) as T) : n._value;
}
/** The unflushed guess to `n`, else NOT_PENDING. */
export function pendingGuessOf(n: Signal<any> | Computed<any>): unknown {
  for (let i = pendingGuesses.length - 3; i >= 0; i -= 3)
    if (pendingGuesses[i] === n) return pendingGuesses[i + 1];
  return NOT_PENDING;
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
function inFlight(n: Signal<any>): boolean {
  return (
    ((n as Computed<any>)._statusFlags & STATUS_PENDING) !== 0 ||
    ((n._config & CONFIG_SLOT_NODE) !== 0 && GlobalQueue._slotFlight?.(n) === true)
  );
}

function applyGuesses(parent: Transaction | null): void {
  let lane: Transaction | null = null;
  for (let i = 0; i < pendingGuesses.length; i += 3) {
    const n = pendingGuesses[i] as Signal<any>;
    const v = pendingGuesses[i + 1];
    let changed = true;
    if (n._config & CONFIG_OVERRIDE) {
      // A lane's node already: a guess re-asked, or a derivation guessed
      // over (its staging is void — the guess is the value now). Two
      // suggestions for one slot cannot finish apart (A34 (1)): the frames
      // entangle. The same value re-asked renews the question; nothing to
      // notify.
      changed = !n._equals || !n._equals(laneValueOf(n), v);
      if (!(n._config & CONFIG_GUESS)) {
        n._pendingValue = NOT_PENDING;
        n._config |= CONFIG_GUESS;
      }
      n._x!._lane = v;
      const holder = txOf(n)._parent;
      if (parent !== null && holder !== null) merge(parent, holder);
    } else {
      let l: Transaction;
      if (n._config & CONFIG_HELD) l = newLane(txOf(n));
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

/** The running pass read lane `l`'s work as a derivation: it is `l`'s — or,
 * already another lane's, the frame it computes derives from both guesses
 * and cannot show one without the other (#3335, A15 for lanes): the two
 * lanes are linked — one reveal unit, each blocked while any is — while
 * their lifetimes stay their own (#2912: a guess reverts with its own
 * action, not with the one it shares a reader with). A nested lane reading
 * through an ancestor's guess stays its own (the screen plus its own
 * guesses). */
export function enterLane(l: Transaction, c: Computed<any>): void {
  c._flags |= REACTIVE_LANE_READ;
  const p = passLane;
  if (p === null) {
    setPassLane(l);
    // The pass read a held write before its first lane read (it joined the
    // frame's future as mainline would): lane work sees the screen — the
    // seam re-derives it on the committed world next round (`stagedReaders`,
    // the park's repair), as it does a lane pass that read a staging.
    if (c._flags & REACTIVE_JOINED) stagedRead(c);
    return;
  }
  if (sameLane(p, l)) return setPassLane(l);
  if (under(p, l)) return;
  if (under(l, p)) return setPassLane(l);
  linkLanes(p, l);
  setPassLane(l);
}
/** Is `l` nested under `a` (an ancestor lane)? */
function under(l: Transaction, a: Transaction): boolean {
  for (let t = l._parent; t !== null && t._lane; t = t._parent) if (t === a) return true;
  return false;
}
/** One link group (a shared array) for both lanes' groups. */
function linkLanes(a: Transaction, b: Transaction): void {
  const ga = a._links ?? (a._links = [a]);
  const gb = b._links;
  if (gb === ga) return;
  if (gb === null) {
    ga.push(b);
    b._links = ga;
  } else
    for (let i = 0; i < gb.length; i++) {
      ga.push(gb[i]);
      gb[i]._links = ga;
    }
}
/** A linked lane blocked on its own account blocks the group — `blocked(k)`
 * without the group recursion. (A guess in `k` whose own truth is in flight
 * blocks `k`'s parent, not `k` — nor, through the link, `l`: the guess
 * shows, A17.) */
function linkBlocked(l: Transaction): boolean {
  const g = l._links;
  if (g !== null)
    for (let i = 0; i < g.length; i++) {
      const k = g[i];
      if (k !== l && (k._open !== 0 || ownFlights(k) || nestedBlocked(k))) return true;
    }
  return false;
}
function unlink(l: Transaction): void {
  const g = l._links;
  if (g === null) return;
  const k = g.indexOf(l);
  if (k !== -1) g.splice(k, 1);
  l._links = null;
}

/** Verdicts (maintainer, 2026-10-01): `isPending` and `latest` are
 * optimistic state the system supplies — a verdict is a guess ("pending,
 * until this lands"; "the proposal is the value") decided at the seam like
 * a user's, and its readers break out of the hold the same way: work of a
 * lane under the holder, shown now, re-derived at the landing, ending with
 * it. Judged at the seam like any lane: blocked while a verdict reader's
 * own derivation is in flight (lane rule 3), shown otherwise. */
export function verdictLane(t: Transaction): Transaction {
  return (t._verdict ??= newLane(t));
}

/** A lane pass's node (core.ts `recompute`, before its staging; a pending
 * propagation under a lane pass, async.ts): listed, carrying the lane's
 * value from now (a derivation of a guess — its readers become lane work).
 * Entering the lane supersedes a frame staging the node carried: this
 * pass's answer replaces it, and the frame's hold on it is over. An
 * effect's value slot is private (no lane value). A pass in a lane's seat
 * that read none of the lane's world has left it (false): its result is the
 * frame's — a derivation whose branch no longer reaches the guess — and no
 * hold the lane took over from a transaction stays on it (#3698: lane work
 * never makes its node transaction work; a born-held effect's hold went to
 * the lane). A pass interrupted before it got there (pending, errored) did
 * not leave (A30: it never got there). A first pass under a lane is the
 * lane's (ruling A); a guess is written, not derived — it never leaves this
 * way. `errored`: the pass has no answer — or, a lane pass's pending
 * propagation (async.ts `propagateStatus`), the node gone pending. */
export function laneStage(
  el: Computed<any>,
  l: Transaction,
  create: boolean,
  errored: boolean | Computed<any>
): boolean {
  if (!(create || errored || el._flags & REACTIVE_LANE_READ || el._config & CONFIG_GUESS)) {
    const x = el._x;
    if (x !== null) {
      const tx = x._transaction;
      // Cleared before equality, so a return to the committed value notifies
      // nobody. The seam wakes it unless the frame is still held (#3892).
      if (tx?._shown && !blocked(resolveTx(tx!._parent!))) el._flags |= LEFT_SHOWN;
      if (tx?._lane) x._transaction = null;
      x._lane = NOT_PENDING;
    }
    el._config &= ~(CONFIG_OVERRIDE | CONFIG_HELD);
    return false;
  }
  if (!(el as any)._type) {
    if (!(el._config & CONFIG_OVERRIDE)) {
      el._pendingValue = NOT_PENDING;
      el._config = (el._config & ~CONFIG_HELD) | CONFIG_OVERRIDE;
      ext(el);
    }
    // A written guess whose own pass is the lane's work — its source is a
    // derivation of another guess (a guess over `config().courier` under a
    // country guess) — is confirmed or corrected by the lane: a derivation
    // of the lane from here (its value the lane's, its fate the lane's), no
    // longer a written guess. A pass with no answer (pending, errored)
    // leaves the guess.
    if (!errored) el._config &= ~CONFIG_GUESS;
  }
  // A leaf has no lane value to seat it (`recompute`): one left waiting on
  // the lane's flight runs its next pass as the lane's — the landing that
  // wakes it is the lane's re-staging (A31), and the lane holds its render
  // effects until its derivations land (A17; #3766, F5). Not a leaf whose
  // seat is its frame's, reached by a propagation from a node the screen has
  // a value of: one a transaction holds (born held — its frame waits on it,
  // A29), or one whose own mainline pass is running (it pulled the node;
  // `laneRead` decides — its frame holds). Its pending is the frame's: queued
  // for the commit sweep as mainline's (async.ts). A node born in the lane
  // has nothing on screen: its leaf waits as the lane's.
  else if (errored) {
    if (
      errored !== true &&
      !(errored._statusFlags & STATUS_UNINITIALIZED) &&
      (el._config & CONFIG_HELD || el._flags & REACTIVE_RECOMPUTING_DEPS) &&
      !el._x?._transaction?._lane
    ) {
      queuePendingNode(el);
      return false;
    }
    el._flags |= REACTIVE_LANE_DIRTY;
  }
  list(el, l);
  return true;
}

/** The truth arrived for a written guess (A18): a correction dissolves the
 * lane — the guess and everything derived from it is void, the truth is
 * the parent's held write and the graph re-derives from it there, one frame
 * at the parent's landing — while the display keeps what it shows until
 * then. A confirmation is silent (A17): the truth stays staged beneath the
 * guess for the parent's commit, the guess stays the value; only a reader
 * of the truth (CONFIG_AUTHORITATIVE) is told its view changed. */
/** Observe: the correction round is replacing a guess with the value it
 * covered (no landing beneath it) — `optimisticReverted`'s "reverted". */
let reverting = false;

/** Plain data with the same contents: an optimistic row and the source
 * object that echoes it. Not reference equality. A throw (a cycle, a
 * throwing accessor) is not a match, so that landing stays a correction. */
function sameContents(a: unknown, b: unknown): boolean {
  if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export function supersede(n: Signal<any> | Computed<any>, value: unknown, changed: boolean): void {
  const l = txOf(n);
  // Resolved: the parent may have merged into another transaction since the
  // lane opened (two actions guessing one slot entangle, A34 (1)) — the
  // truth is held by the transaction that lands, not the merged-away one.
  const parent = resolveTx(l._parent ?? l);
  // A different object with the same plain contents is the guess's echo, not
  // a correction (#3898). Reference inequality dissolved the lane and held
  // the echo under the open action, so a mainline `until` (after `await`)
  // dropped a source that already contained the acknowledgement. Confirming
  // stages the truth beneath the guess: the screen keeps the guess, and an
  // authoritative reader sees the echo without the pass joining the hold.
  // A real content change still corrects. A held broadcast of a different row
  // (#3482) is not this landing.
  if (changed && sameContents(n._x!._lane, value)) changed = false;
  if (changed) {
    // Observe: a displayed guess is being replaced by a differing truth — a
    // landing's (superseded), or the value it covered (reverted: the body
    // ended with nothing coming true).
    if (__OBSERVE__ && l._shown && attrHooks !== null)
      attrHooks.optimisticReverted(n, n._x!._lane, value, reverting ? "reverted" : "superseded");
    dissolveLane(l, parent, n);
    // What the screen showed stays the screen until the parent lands (A18
    // (c): display and untracked reads keep the override until the commit).
    if (l._shown) n._value = n._x!._lane;
    n._config &= ~(CONFIG_OVERRIDE | CONFIG_GUESS);
    n._x!._lane = NOT_PENDING;
    n._pendingValue = value;
    holdNode(n, parent);
    joinFuture(parent);
    if (n._subs !== null) insertSubs(n);
  } else {
    n._pendingValue = value;
    n._config |= CONFIG_HELD;
    joinFuture(parent);
    for (let s = n._subs; s !== null; s = s._nextSub)
      if (s._sub._config & CONFIG_AUTHORITATIVE) enqueueSub(s._sub);
  }
}

/** A lane's end, two ways. `into === null`: the parent landed — the lane's
 * values are the truth now: a guess lands the truth staged beneath it or
 * reverts to the one it covered (`_value`, untouched by the guess); a
 * derivation's latest value commits (its frame with it); what the screen
 * showed and changes notifies. Otherwise the lane dissolves into `into`
 * (the parent, on a correction): its values are void — what it showed stays
 * the screen (`_value` takes it, so the parent's re-derivation compares
 * against what is seen), a truth staged beneath a guess is the parent's to
 * land, and the runs it held (showing the void guess) are dropped: the
 * parent's re-derivation makes the runs that show. */
function dissolveLane(l: Transaction, into: Transaction | null, except?: Signal<any>): void {
  const k = lanes.indexOf(l);
  if (k !== -1) lanes.splice(k, 1);
  unlink(l);
  // Its verdicts end with it (a correction's dissolution reaches here before
  // `endLanes` would): the readers re-derive from the truth's notification.
  const v = l._verdict;
  if (v !== null) {
    l._verdict = null;
    if (lanes.indexOf(v) !== -1) dissolveLane(v, null);
  }
  for (let i = 0; i < l._nodes.length; i++) {
    const n = l._nodes[i];
    const x = n._x!;
    if (n === except || x._transaction !== l) continue;
    const effect = (n as any)._type;
    const guess = n._config & CONFIG_GUESS;
    const slot = x._lane;
    // What the screen shows of it (NOT_PENDING: nothing — a lane pass that
    // errored or pends staged no value), and the lane's latest.
    const shown = l._shown && !effect ? slot : n._value;
    const latest = laneValueOf(n);
    x._lane = NOT_PENDING;
    n._config &= ~(CONFIG_OVERRIDE | CONFIG_GUESS);
    if (into === null) {
      // The parent landed: a guess lands the truth beneath it or reverts to
      // the one it covered; a derivation's latest commits (its frame with
      // it); what the screen showed and changes notifies. Observe: a
      // displayed guess that lifts to something else — the truth staged
      // beneath it (superseded by a landing held there) or the value it
      // covered (reverted: nothing came true).
      if (__OBSERVE__ && guess && l._shown && attrHooks !== null) {
        const truth = n._pendingValue !== NOT_PENDING ? n._pendingValue : n._value;
        if (truth !== slot)
          attrHooks.optimisticReverted(
            n,
            slot,
            truth,
            n._pendingValue !== NOT_PENDING ? "superseded" : "reverted"
          );
      }
      // A derivation the revert re-derives (dirtied by the guess's
      // notification — listed before it), or one still in flight, shows the
      // lane's answer beside inputs that are the truth now: a fresh reader
      // of its flight observes it (#3648, #3651; #3305's commit beneath a
      // flight).
      x._transaction = null;
      if (!effect && !guess) n._pendingValue = latest;
      commitPendingNode(n);
      if (!effect) {
        if (
          (n as Computed<any>)._flags & (REACTIVE_IN_HEAP | REACTIVE_DIRTY | REACTIVE_CHECK) ||
          (n as Computed<any>)._statusFlags & STATUS_PENDING
        )
          n._config |= CONFIG_INPUTS_PUBLISHED;
        if (shown !== NOT_PENDING && (!n._equals || !n._equals(shown, n._value))) insertSubs(n);
      }
    } else if (guess) {
      // A guess of a dissolving lane: its truth — a landing held beneath it,
      // else the value it covered — is the parent's to land, and its readers
      // re-derive from it there. What the screen showed stays the screen
      // until then (A18 (c)).
      if (n._pendingValue === NOT_PENDING) n._pendingValue = covered(n);
      if (l._shown) n._value = slot;
      holdNode(n, into);
      insertSubs(n);
    } else {
      // A correction: the lane's derivations are void. Shown, what the
      // screen showed stays the screen (committed, inputs published — every
      // one re-derives); never shown, nothing of it reached the screen (a
      // node born in the lane stays uninitialized; its frame goes). One in
      // flight is asking the void world's question: its landing is nobody's
      // answer — it re-asks from the truth (whose notification may not reach
      // it: an input's truth equal to its committed value is silent).
      x._transaction = null;
      if (!effect) {
        if (shown !== NOT_PENDING && l._shown) n._pendingValue = shown;
        if ((n as Computed<any>)._statusFlags & STATUS_PENDING) {
          x._inFlight = null;
          enqueueSub(n as Computed<any>);
        }
      }
      if (l._shown) {
        commitPendingNode(n);
        if (!effect) n._config |= CONFIG_INPUTS_PUBLISHED;
      } else {
        if (x._pendingFirstChild !== null || x._pendingDisposal !== null)
          GlobalQueue._dispose(n as Computed<any>, false, true);
        n._config &= ~(CONFIG_STAGED | CONFIG_HELD);
      }
    }
  }
  // The parent landed: the runs the lane held (blocked on its own judgment
  // alone — a zombie it could not dispose) are the landing's. A correction
  // of a SHOWN lane keeps its runs too: "what it showed stays the screen"
  // means the runs this round's lane passes queued (the body-end seam judges
  // before the lane seam would have released them) must reach the screen —
  // their derivations' values are the committed ones now, and a
  // re-derivation that lands on the same value notifies nobody (a mapArray
  // whose rows the lane pass already built). A never-shown lane's runs are
  // void: nothing of it reached the screen. So are the runs a blocked lane
  // parked: they show a re-guess the seam never revealed, beside derivations
  // that keep what the screen showed.
  if (into === null || (l._shown && !l._held)) releaseQueues(l);
  else l._queues[0].length = l._queues[1].length = 0;
}

/** Lanes. A lane's node is read by its reader's kind: an authoritative
 * reader (`until`) sees the truth — staged beneath a guess, else committed
 * — and is no lane's; an untracked read sees the lane's latest value (A17:
 * "direct read shows optimistic"; A28); a children-forbidden reader sees
 * the frame (A32). A render effect in the frame's seat reading a lane the
 * seam found blocked, or a member whose own flight is up (held or not — the
 * lane-membership ruling, 2026-10-05), sees the screen, re-derived at the
 * reveal (#3460's stale reader) — or, the node a
 * flight that has never shown (nothing to show), waits on it: its own frame
 * holds (A15, #3334), not the lane's parent. Any other tracked reader is
 * the lane's work from this read — a derivation; a leaf reading a lane that
 * has shown, or one the seam has not judged yet (its run waits on the
 * verdict: released if the lane shows, held if it blocks) — and sees the
 * lane's latest. NOT_PENDING falls through: lane work's read of a pending
 * member throws like any. */
export function laneRead(c: Computed<any> | null, el: Signal<any> | Computed<any>): unknown {
  const guess = el._config & CONFIG_GUESS;
  if (c !== null && c._config & CONFIG_AUTHORITATIVE)
    return guess && el._pendingValue !== NOT_PENDING ? el._pendingValue : el._value;
  if (c === null) return laneValueOf(el);
  const l = txOf(el);
  const status = (el as Computed<any>)._statusFlags;
  if (!tracking || c._config & CONFIG_CHILDREN_FORBIDDEN) {
    // An untracked read inside lane work derives from the lane like a
    // tracked one, minus the subscription — `untrack` is about
    // dependencies, not about which world a pass derives from (a mapper's
    // row reads under its root, store/map): the pass enters the lane (two
    // lanes read by one pass link, as for tracked reads). Outside lane
    // work, the screen.
    if (passLane === null || c._config & CONFIG_CHILDREN_FORBIDDEN) return display(el);
    enterLane(l, c);
    if (!guess && status & STATUS_PENDING) return NOT_PENDING;
    return laneValueOf(el);
  }
  if ((c as any)._type === EFFECT_RENDER && (passLane === null || !sameLane(passLane, l))) {
    if (!guess) {
      // A flight whose value has never shown: nothing to show — the leaf
      // waits on it, and its own frame holds (A15, #3334), not the lane's
      // parent. The landing lands the frame: its own pass (the flush
      // joined its transaction) reads the answer it waited on — the lane's
      // staging, revealed at this seam.
      if (status & STATUS_PENDING && el._x!._lane === NOT_PENDING) return NOT_PENDING;
      if (
        el._pendingValue !== NOT_PENDING &&
        c._config & CONFIG_HELD &&
        flushTransaction !== null &&
        resolveTx(flushTransaction) === txOf(c)
      )
        return el._pendingValue;
    }
    if (l._held || (!guess && status & STATUS_PENDING)) {
      if (!guess && !l._shown && status & STATUS_UNINITIALIZED) throw new NotReadyError(null);
      // Re-derived at the reveal; once per pass (the pass may also be a stale
      // reader of a transaction, REACTIVE_FRAME_READ — both reruns apply).
      if (!(c._flags & REACTIVE_SCREEN_READ)) {
        c._flags |= REACTIVE_FRAME_READ | REACTIVE_SCREEN_READ;
        l._reruns.push(c);
      }
      return display(el);
    }
  }
  enterLane(l, c);
  if (!guess && status & STATUS_PENDING) return NOT_PENDING;
  return laneValueOf(el);
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
        if (__OBSERVE__) reverting = n._pendingValue === NOT_PENDING;
        supersede(n, truth, !n._equals || !n._equals(n._x!._lane, truth));
        if (__OBSERVE__) reverting = false;
      }
    }
  }
  return judged;
}

function laneSeam(l: Transaction, leaked: boolean): void {
  // Blocked — or one of its passes read a write the frame holds this seam:
  // its runs wait, the pass re-derives on the screen next round.
  if (leaked || blocked(l)) {
    l._held = true;
    return;
  }
  l._held = false;
  l._shown = true;
  reruns(l);
  for (let i = 0; i < l._nodes.length; i++) {
    const n = l._nodes[i] as Computed<any>;
    if (n._flags & LEFT_SHOWN) {
      n._flags ^= LEFT_SHOWN;
      insertSubs(n);
    }
    const x = n._x!;
    if (x._transaction !== l) continue;
    if (!(n._config & CONFIG_GUESS) && !(n as any)._type && n._pendingValue !== NOT_PENDING) {
      x._lane = n._pendingValue;
      n._pendingValue = NOT_PENDING;
    }
    // The frame this pass built is the screen's now; the one it replaced
    // goes (as `commitPendingNode` retires a committed pass's).
    if (x._pendingFirstChild !== null || x._pendingDisposal !== null)
      GlobalQueue._dispose(n, false, true);
    n._config &= ~CONFIG_STAGED;
  }
  releaseQueues(l);
}

/** The parent landed: its lanes end, nested first. (None is blocked: a
 * blocked lane blocks its parent.) */
function endLanes(u: Transaction): void {
  for (let k = lanes.length - 1; k >= 0; k--) {
    const l = lanes[k];
    if (resolveTx(l._parent!) !== u) continue;
    endLanes(l);
    dissolveLane(l, null);
  }
}

/** A blocked lane blocks its parent (maintainer, 2026-10-01): the lane's
 * pending work derives from the frame's write through the guess, so the
 * frame is not complete without it (A15) — landing it would commit the write
 * beside a derivation still showing the old one. A guess whose own flight is
 * up likewise: the question was asked in this frame. */
function lanesBlocked(t: Transaction): boolean {
  return (t._lane && linkBlocked(t)) || nestedBlocked(t);
}
/** The lanes under `t` (its own; a link group's are each other's). */
function nestedBlocked(t: Transaction): boolean {
  for (let i = 0; i < lanes.length; i++) {
    const l = lanes[i];
    if (resolveTx(l._parent!) !== t) continue;
    if (blocked(l) || guessFlights(l)) return true;
  }
  return false;
}

/** A write landing on a lane's node (core.ts `setSignal`: a user's write, an
 * async landing). On a guess it is its truth (A18 — an async guess's own
 * landing), judged against the guess. On a derivation it is the lane's
 * latest: its staging once the lane has shown (promoted at the next
 * reveal), its slot before; the lane's members re-derive as its work. */
function laneWrite<T>(el: Signal<T> | Computed<T>, v: T): T {
  if (el._config & CONFIG_GUESS) {
    // Provenance (A18, #3331; Q-D, plan sec. 39): a write asking an OLDER
    // question than the guess's — another action's landing beneath it —
    // is not its answer: held beneath (the truth for the commit; the
    // guess's own question judges), and nothing moves. The writer's
    // question is the one being asked (`question`: a slice's, a derive's
    // continuation's — the flight's); unstamped writes and mainline are
    // current.
    if (stale(el, question)) {
      el._pendingValue = v;
      el._config |= CONFIG_HELD;
      GlobalQueue._laneRebase?.(el, v);
      schedule();
      return v;
    }
    supersede(el, v, !el._equals || !el._equals(el._x!._lane as T, v));
  } else {
    const l = txOf(el);
    if (el._equals && el._equals(laneValueOf(el) as T, v)) return v;
    if (l._shown) el._pendingValue = v;
    else el._x!._lane = v;
    if ((el as any)._fn !== undefined) (el as Computed<T>)._time = clock;
    insertSubs(el);
    laneDirty(el, l);
  }
  schedule();
  return v;
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

GlobalQueue._laneRead = laneRead;
GlobalQueue._laneStage = laneStage;
GlobalQueue._laneOutcome = laneOutcome;
GlobalQueue._laneWrite = laneWrite;
/** The lanes alive before this seam's guesses opened theirs (a prefix of
 * `lanes`; nothing dissolves one between here and the seam loop): a lane
 * born at the seam has no work to judge yet (its passes run next round) —
 * it is neither shown nor blocked until it has. */
let judged = 0;
GlobalQueue._applyGuesses = parent => {
  judged = lanes.length;
  if (pendingGuesses.length !== 0) applyGuesses(parent);
};
GlobalQueue._laneSeams = leaks => {
  // Passes that read a write the parked frame holds as the screen
  // (`stagedReaders`: lane work, a verdict reader before the verdict): they
  // re-derive on the committed world next round (and register as stale
  // readers of the transaction there); a lane's runs wait that round — a
  // lane sees the screen plus its own guesses.
  const leaked: Transaction[] = [];
  if (leaks !== null)
    for (let i = 0; i < leaks.length; i++) {
      const r = leaks[i];
      const l = r._x?._transaction;
      // A verdict reader a later read of the same pass routed into a verdict
      // lane answered for itself: it re-derives at the holder's landing, not
      // now (one run — #3322, #3540). Other verdict-lane work re-derives only
      // if the frame stays parked: a transaction landing at this seam makes
      // what it read the screen (one run).
      if (
        r._flags & REACTIVE_DISPOSED ||
        (l != null &&
          l._parent?._verdict === l &&
          (r._config & CONFIG_VERDICT
            ? !(r._flags & REACTIVE_PROBE_UNANSWERED)
            : !blocked(l._parent)))
      )
        continue;
      enqueueSub(r);
      if (l != null && l._lane && leaked.indexOf(l) === -1) leaked.push(l);
    }
  for (let k = Math.min(judged, lanes.length) - 1; k >= 0; k--)
    laneSeam(lanes[k], leaked.indexOf(lanes[k]) !== -1);
};
GlobalQueue._laneCorrections = () => lanes.length !== 0 && laneCorrections();
GlobalQueue._endLanes = endLanes;
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
GlobalQueue._lanesBlocked = lanesBlocked;
GlobalQueue._verdictLane = verdictLane;
