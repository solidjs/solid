// Lanes (plan sec. 28 replay, 2026-10-02; maintainer rulings 2026-10-01/02). A lane
// is "a new base of a transition": the sub-frame an optimistic write opens
// in the transition of the frame it is made in. It sees the screen plus its
// own guesses (plan sec. 19), breaks out of the parent's hold — its effects run now —
// and holds itself if its own derivations hit async (and, blocked, holds its
// parent). It ends when the parent lands: a guess reverts to the truth it
// covered, or lands as the truth that superseded it. A frame that does not
// park has nothing to be optimistic over: the write is void.
//
// Two places per node, as for any held node: `_value` is what the screen
// shows, `_pendingValue` what its hold will commit. A lane pass's derivation
// is staged in `_pendingValue` until the lane reveals (`laneSeam`). A guess
// waits in the lane's record (truth.ts `covers`) until its reveal moves it
// to `_value`; its `_pendingValue` is its hold's: the value it reverts to,
// staged at the reveal, or a truth landed beneath it (F-11). The lane carries the state machine: `_shown`
// once it has revealed. A direct read sees the lane's latest throughout
// (A17); an authoritative reader (`until`) sees the truth beneath it (Q3,
// 2026-10-02: "optimistic overrides are intentionally not part of
// authoritative truth").
//
// The seat of a pass is its node's (core.ts `recompute`): a node carrying a
// lane's derived value runs as the lane's whoever dirtied it; a derivation's
// tracked read of a lane's value moves its pass into the lane (`enterLane`);
// a leaf's never does — it reads the screen, a stale reader of a lane that
// has not shown (#3460). Lane work's values are the lane's staging, revealed
// at the next seam; its runs go to the lane's queues.
//
// This module is the lane engine, installed on `GlobalQueue` when something
// imports it (`createOptimistic`, or verdict.ts for its verdict lanes). The
// core keeps only bit tests and `passLane`: a program with no optimism
// carries none of this.

import {
  CONFIG_AUTHORITATIVE,
  CONFIG_CHILDREN_FORBIDDEN,
  CONFIG_FRAME,
  CONFIG_ASYNC,
  CONFIG_GUESS,
  CONFIG_HELD,
  CONFIG_HELD_FRAME,
  CONFIG_INPUTS_PUBLISHED,
  CONFIG_LAGS,
  CONFIG_MOUNT_AHEAD,
  CONFIG_OVERRIDE,
  CONFIG_SLOT_NODE,
  CONFIG_STAGED,
  CONFIG_STAGED_ERROR,
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
  REACTIVE_STAGED_READ,
  STATUS_ERROR,
  STATUS_PENDING,
  STATUS_UNINITIALIZED
} from "./constants.js";
import { bornInto, creatorReads, ext, stagedRead, tracking } from "./core.js";
import { NotReadyError, type StatusError } from "./error.js";
import { removePendingSource, settlePendingSource } from "./async.js";
import { covers, latestOf, underOf } from "./truth.js";
import { enqueueSub } from "./heap.js";
import {
  actionDepth,
  blocked,
  question,
  clock,
  commitPendingNode,
  flushTransaction,
  GlobalQueue,
  holdNode,
  insertSubs,
  joinFuture,
  laneDirty,
  list,
  stagedReaders,
  staleReader,
  merge,
  newTransaction,
  ownFlights,
  passLane,
  queuePendingNode,
  releaseQueues,
  reruns,
  liveTx,
  resolveTx,
  transactions,
  sameLane,
  schedule,
  setPassLane,
  txOf,
  type Transaction,
  globalQueue,
  hiddenHook,
  installLaneHooks,
  r5Hook,
  reasks
} from "./scheduler.js";
import { SLOT_C, SLOT_DV, SLOT_LV, SLOT_P, SLOT_T, shadowActual } from "./seat.js";
import type { Computed, Owner, Signal } from "./types.js";

export { latestOf };

/** Live lanes (parented). Scanned at every seam while non-empty. */
export const lanes: Transaction[] = [];
/** A pass left a shown lane (`laneStage`): the node's notify stamp
 * (`_notifiedAt`, never negative once it notifies — `insertSubs` overwrites
 * it, so a pass that does notify clears the mark). The seam wakes its
 * readers (#3892). */
const LEFT_SHOWN = -2;
export function newLane(parent: Transaction): Transaction {
  const l = newTransaction(true, parent);
  lanes.push(l);
  return l;
}

/** `v` is lane `l`'s value of `n` from now. A guess goes to the lane's
 * record and is revealed at once when the lane has shown, unless `wait`:
 * a shown guess re-asked reveals with its lane's passes (F-1, S-30). */
export function setLaneValue(n: Signal<any>, l: Transaction, v: unknown, wait?: boolean): void {
  if (n._config & CONFIG_GUESS) {
    covers.set(n, v);
    if (!wait && (l._shown || n._x!._shown)) reveal(n);
  } else if (l._shown || n._x!._shown) {
    n._value = v;
    n._x!._shown = true;
    if ((n as Computed<any>)._statusFlags & STATUS_UNINITIALIZED)
      (n as Computed<any>)._statusFlags &= ~STATUS_UNINITIALIZED;
  } else n._pendingValue = v;
}
/** A guess leaves its lane's record for the screen. With no truth held
 * beneath it, what it shows over is staged as the value it reverts to: the
 * revert is its hold's write (F-11). */
export function reveal(n: Signal<any>): void {
  const g = covers.get(n);
  covers.delete(n);
  if (n._pendingValue === NOT_PENDING) ((n._pendingValue = n._value), (n._x!._revert = true));
  n._value = g;
  n._x!._shown = true;
  if ((n as Computed<any>)._statusFlags & STATUS_UNINITIALIZED)
    (n as Computed<any>)._statusFlags &= ~STATUS_UNINITIALIZED;
}
/** What the screen shows of a node: NOT_PENDING when nothing (uninitialized). */
export function screenOf(el: Signal<any> | Computed<any>): unknown {
  return (el as Computed<any>)._statusFlags & STATUS_UNINITIALIZED ? NOT_PENDING : el._value;
}
/** A truth landed beneath a guess: the parent's staging, held for its
 * landing to commit (CONFIG_HELD) — an older question's answer (A18), or the
 * guess's confirmation (A24). The guess stays the value. */
export function landBeneath(n: Signal<any> | Computed<any>, truth: unknown): void {
  n._pendingValue = truth;
  n._x!._revert = false;
  n._config |= CONFIG_HELD;
}

/** This module's copy of scheduler.ts `guessing`: its readers here stay
 * foldable when a bundler splits lanes.ts from scheduler.ts into separate
 * chunks (a cross-chunk binding is not folded; the compiled live page). */
let guessed = false;
/** A guess was written (guesses.ts `optimisticWrite`). */
export function armGuessed(): void {
  guessed = true;
}
// The guess layer (guesses.ts; installed with `createOptimistic` or
// `createOptimisticStore`): `guessWrite` is a write landing on a guess
// (`laneWrite`). The site is behind CONFIG_GUESS, which nothing but the
// layer sets: a bundle without it folds the site.
export let guessWriteHook: ((el: Signal<any> | Computed<any>, v: unknown) => void) | null = null;
export function installGuessLayer(write: NonNullable<typeof guessWriteHook>): void {
  guessWriteHook = write;
}
/** Shown guesses a correction re-homed into their hold (guesses.ts
 * `supersede`, `dissolveLane`): the slot's value for the screen and untracked
 * reads until that hold lands (D-34). Each keeps the hold open on its own
 * flight as it did while a guess (`lanesBlocked`); the hold's landing clears
 * them (`endLanes`). */
export const marked = /* @__PURE__ */ new WeakSet<Signal<any>>();
/** A shown guess a correction re-homed into its hold (guesses.ts `supersede`,
 * `dissolveLane`): the screen's and the untracked reads' value until the
 * commit, and `latest`'s (D-34, decision 3 of 2026-11-05, #4689) — the
 * displayed slot's newest value is the guess, the truth its staging. */
export function keptGuess(n: Signal<any> | Computed<any>): boolean {
  return guessed && marked.has(n);
}
/** `n`'s readers are stale readers of `t` (re-derived at its landing). */
export function rerun(n: Signal<any>, t: Transaction): void {
  for (let s = n._subs; s !== null; s = s._nextSub) staleReader(s._sub, t);
  // A store's guess carrier: the readers of the keys it changed read their
  // leaves (store/optimistic.ts).
  if (n._config & CONFIG_SLOT_NODE) GlobalQueue._slotRerun?.(n, t);
}
/** A guess's own truth is in flight: the node's own refetch — or, a store
 * leaf's, its family's derive (the slot's flight; store/optimistic.ts
 * installs the resolver). A17: the guess stands in for the flight. */
export function inFlight(n: Signal<any>): unknown {
  return (
    (n as Computed<any>)._statusFlags & STATUS_PENDING ||
    (n._config & CONFIG_SLOT_NODE && GlobalQueue._slotFlight?.(n))
  );
}

/** The running pass read lane `l`'s work as a derivation: it is `l`'s — or,
 * already another lane's, the frame it computes derives from both guesses
 * and cannot show one without the other (#3335, A15 for lanes): the two
 * lanes are linked — one reveal unit, each blocked while any is — while
 * their lifetimes stay their own (#2912: a guess reverts with its own
 * action, not with the one it shares a reader with). (Lanes never nest: a
 * lane is never the flush's transaction, D-37, so no guess is parented to
 * one.) */
export function enterLane(l: Transaction, c: Computed<any>): void {
  const f = (c._flags |= REACTIVE_LANE_READ),
    p = passLane;
  if (p === null) {
    const verdict = isVerdict(l);
    // A verdict lane's value (a memo of `latest` / `isPending`, F-6) read by
    // a derivation that already read the frame's staging or joined its
    // hold, or by any pass a pass that did is creating: the verdict read
    // does not break it out — it stays the frame's, as the same read inline
    // does (verdict.ts `markVerdictReader`, `route`; D-25, D-26). An
    // effect's own reads do not count (its `_type`, 1–3, carries neither bit).
    // Nor by a member of the frame a held pass of that lane's hold built,
    // on any later run (CONFIG_HELD_FRAME, `bornInto`): born in the hold's
    // world, it is the hold's own work and its run is the frame's, at the
    // landing (D-25, D-27) — as `route` keeps it for the inline `latest()`.
    // Nor by a pass that re-entered the hold holding its node at its head
    // (core.ts `recompute`: held, with no verdict posture — an async memo's
    // was dropped there — not a frame, not lagging, not a lane's node), when
    // `l` is another hold's verdict lane: re-run by the write its hold
    // holds, the pass is that hold's work and reads plainly in either read
    // order (D-25), as it does reading its hold's staging before `l`'s
    // value. Moved into `l`, it read its own hold's landing as the screen
    // (D-26) and asked a question already asked (#4399: `m1:15` again, over
    // `m0b`'s committed value beside the landing of its next question). Its
    // own hold's verdict lane is its display-ahead read: it enters that one
    // (D-25, #4050).
    let hold: Transaction;
    if (
      !(
        verdict &&
        (creatorReads(c, (c as any)._type || f) ||
          ((hold = resolveTx(l._parent!)),
          (c._config &
            (CONFIG_HELD | CONFIG_VERDICT | CONFIG_FRAME | CONFIG_LAGS | CONFIG_OVERRIDE)) ===
            CONFIG_HELD && txOf(c) !== hold) ||
          (c._config & CONFIG_HELD_FRAME && bornInto(c, hold!)))
      )
    ) {
      setPassLane(l);
      // The pass read a held write before its first lane read (it joined the
      // frame's future as mainline would): lane work sees the screen — the
      // seam re-derives it on the committed world next round (`stagedReaders`,
      // the park's repair), as it does a lane pass that read a staging. Not a
      // pass whose held reads were all of nodes born held (no staged read,
      // `stagedRead`): it has no committed world to re-derive on (#3969).
      // (A pass not joined: a held write beside a guess, #4336; a leaf of a
      // verdict lane — its plain reads are the screen's, D-26 `[s(), L()]`.)
      if (f & REACTIVE_STAGED_READ && (guessed || verdict || f & REACTIVE_JOINED)) stagedRead(c);
    }
  } else if (sameLane(p, l)) setPassLane(l);
  else {
    linkLanes(p, l);
    setPassLane(l);
  }
}
/** Is `l` a verdict lane (its parent's `_verdict`)? False for none. */
export function isVerdict(l: Transaction | null | undefined): boolean {
  return l?._parent?._verdict === l;
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
  // F-2's producer clause (S-57): a pass this flush dirtied — it read the
  // flush's staging — that ran as a lane's and asked: the flush holds on
  // that flight and reveals with the lane, whatever the async's source (the
  // lane took the only question).
  if (!create && el._statusFlags & STATUS_PENDING && el._flags & REACTIVE_STAGED_READ) {
    // Pending on a flight it waits on as the frame's work (core.ts `read`:
    // it read the flush's staging, then the flight that staging re-asked)
    // with none of the lane's world read: it left the lane, its pending the
    // frame's — a boundary catches it as a mainline pass's (F-4).
    if (!(el._flags & REACTIVE_LANE_READ) && !(el._config & CONFIG_ASYNC)) errored = false;
    else laneWait(el, l);
  }
  if (!(create || errored || el._flags & REACTIVE_LANE_READ || el._config & CONFIG_GUESS)) {
    const x = el._x;
    if (x !== null) {
      const tx = x._transaction;
      if (tx?._lane) {
        // Left a shown lane: this pass's answer is the frame's. While a
        // transaction's flush runs the pass and the lane's frame is still
        // held, what the screen shows stays the screen until the landing
        // (`_value` keeps the lane's value), and the answer — a change
        // against it — reaches the screen with the frame's commit. Otherwise
        // the answer is judged against the committed value the lane covered
        // (`under`), and the seam wakes the readers (#3892; always for a pass
        // outside any transaction's flush, #4367): a return to the committed
        // value notifies nobody itself, and a pass that does notify has
        // woken them (an effect has no comparator, #4557).
        if (
          tx._shown &&
          !(el._statusFlags & STATUS_PENDING) &&
          (!flushTransaction || !blocked(resolveTx(tx._parent!)))
        ) {
          el._notifiedAt = LEFT_SHOWN;
        }
        x._shown = false;
        x._transaction = null;
      }
      // The lane's staging of it is void, and so is what its readers derived
      // from it in the lane: they re-derive, or a lane run released after
      // this pass shows the void value and a re-derivation equal to their
      // committed one notifies nobody (a Show's condition read the hold's
      // selection through the lane, F-1, F-7, D-34, #4990).
      if (el._pendingValue !== NOT_PENDING) insertSubs(el);
      el._pendingValue = NOT_PENDING;
    }
    el._config &= ~(CONFIG_OVERRIDE | CONFIG_HELD | CONFIG_HELD_FRAME);
    // A store derive's pass (a projection's): the leaves it wrote in the
    // lane's seat leave with it, what it wrote this pass the frame's staging
    // (the screen kept until the landing, as above). Left in the lane, they
    // revealed with it ahead of the frame they derive from (F-1, D-33).
    if (guessed)
      for (let i = 0; i < l._nodes.length; i++) {
        const n = l._nodes[i] as Computed<any>;
        if ((n as any)._host?._fam?.node === el && n._x!._transaction === l) {
          const v = n._pendingValue;
          laneStage(n, l, false, false);
          if (v !== NOT_PENDING) (queuePendingNode(n), (n._pendingValue = v));
        }
      }
    return false;
  }
  if (!(el as any)._type) {
    if (!(el._config & CONFIG_OVERRIDE)) {
      // A hold's staging of it is void in a guess lane: the readers that
      // derived from that staging re-derive, though the lane's value may
      // equal the screen (no change to notify them by) — their held runs
      // carry the void staging, and the hold's landing would apply them over
      // the guess (#4825; as a mainline pass superseding one does, core.ts
      // `recompute`, #4378). A verdict lane's display-ahead pass leaves the
      // frame's question with its readers (S-51).
      if (el._config & CONFIG_HELD && el._pendingValue !== NOT_PENDING && l._parent!._verdict !== l)
        insertSubs(el);
      el._pendingValue = NOT_PENDING;
      el._config = (el._config & ~(CONFIG_HELD | CONFIG_HELD_FRAME)) | CONFIG_OVERRIDE;
      ext(el);
    }
    // A written guess whose own pass is the lane's work — its source is a
    // derivation of another guess (a guess over `config().courier` under a
    // country guess) — is confirmed or corrected by the lane: a derivation
    // of the lane from here (its value the lane's, its fate the lane's), no
    // longer a written guess. A pass with no answer (pending, errored)
    // leaves the guess.
    // (Read behind `guessed`: a bundle without optimism drops the reads.)
    if (
      guessed &&
      el._config & CONFIG_GUESS &&
      el._x!._transaction?._lane &&
      resolveTx(el._x!._transaction!._parent!) !== resolveTx(l._parent!)
    ) {
      // Another hold's guess is on this slot: the two holds merge, and
      // this pass is their question, not this lane's work. The lane is
      // held with them, at once so a reader seated in the other lane
      // stays on the screen (D-33, D-34).
      const h = resolveTx(el._x!._transaction!._parent!);
      merge(resolveTx(l._parent!), h);
      l.over = resolveTx(h);
      l._held = true;
      return false;
    } else if (!errored) {
      // No longer a guess: what it waited to show and what it would have
      // reverted to are void.
      if (guessed && el._config & CONFIG_GUESS) {
        covers.delete(el);
        if (el._x!._revert) ((el._pendingValue = NOT_PENDING), (el._x!._revert = false));
      }
      el._config &= ~CONFIG_GUESS;
    }
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
  // has nothing on screen: its leaf waits as the lane's. A held leaf stays
  // its frame's even when the node reached it has no value yet: a mount born
  // held whose derivation now waits on a lane's flight (#4998, D-2, F-1).
  else if (errored) {
    if (
      errored !== true &&
      (el._config & CONFIG_HELD ||
        (!(errored._statusFlags & STATUS_UNINITIALIZED) &&
          el._flags & REACTIVE_RECOMPUTING_DEPS)) &&
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
export function dissolveLane(l: Transaction, into: Transaction | null, except?: Signal<any>): void {
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
    // A member disposed since it joined the lane is no reader any more
    // (F-3, D-11): dead, it stays at its last committed value (#3024). Nothing
    // here may queue it: recompute's head wipe would drop REACTIVE_DISPOSED
    // and run it again in a torn-down tree (#4613).
    if (n === except || x._transaction !== l || (n as Computed<any>)._flags & REACTIVE_DISPOSED)
      continue;
    const effect = (n as any)._type;
    const guess = n._config & CONFIG_GUESS;
    // What the screen shows of it.
    const shown = n._value;
    // A guess's truth: a landing held beneath it, else the value it covered.
    const truth = guess ? underOf(n) : NOT_PENDING;
    n._config &= ~(CONFIG_OVERRIDE | CONFIG_GUESS);
    n._x!._shown = n._x!._revert = false;
    covers.delete(n);
    if (into === null) {
      // The parent landed: a guess lands the truth beneath it or reverts to
      // the one it covered; a derivation's latest (its staging, else what it
      // shows) commits, its frame with it; what the screen showed and
      // changes notifies.
      // A derivation the revert re-derives (dirtied by the guess's
      // notification — listed before it), or one still in flight, shows the
      // lane's answer beside inputs that are the truth now: a fresh reader
      // of its flight observes it (#3648, #3651; #3305's commit beneath a
      // flight). A first load the lane produced nothing for stays loading
      // until its flight answers (D-22, A19 exc. 1): nothing is staged.
      x._transaction = null;
      if (guess) n._pendingValue = truth;
      commitPendingNode(n);
      if (!effect) {
        if (
          (n as Computed<any>)._flags & (REACTIVE_IN_HEAP | REACTIVE_DIRTY | REACTIVE_CHECK) ||
          (n as Computed<any>)._statusFlags & STATUS_PENDING
        )
          n._config |= CONFIG_INPUTS_PUBLISHED;
        if (!n._equals || !n._equals(shown, n._value)) insertSubs(n);
      }
      // A stale reader's own error — its pass (a memo's or a render
      // effect's) threw over the committed value of what the parent held
      // (A10), served as the screen — is no answer of the world landing now:
      // it re-derives on it (A15; D-39, the landing is the new answer). The
      // landing's `reruns` skips an errored reader: its error is an errored
      // source's (#3945).
      if (
        (n as Computed<any>)._flags & REACTIVE_FRAME_READ &&
        (n as Computed<any>)._statusFlags & STATUS_ERROR &&
        (x._error as StatusError).source === n
      )
        enqueueSub(n as Computed<any>);
    } else if (
      guess ||
      (guessed && n._config & CONFIG_SLOT_NODE && n._pendingValue !== NOT_PENDING)
    ) {
      // A guess of a dissolving lane: its truth — a landing held beneath it,
      // else the value it covered — is the parent's to land, and its readers
      // re-derive from it there. What the screen showed stays the screen
      // until then (A18 (c)): `_value` has it. A store slot the lane
      // composed (a keyed re-base) over a truth staged on it is no
      // derivation anything re-derives: it lands that truth the same way
      // (D-34, #4642).
      if (guess) n._pendingValue = truth;
      if (l._shown && guessed) marked.add(n);
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
        // Its readers re-derive unless the lane was held: a shown lane's runs,
        // released below, show the void staging, and its own re-derivation
        // may land on what the screen shows and notify nobody (F-1, D-34,
        // #4971).
        if (!l._held && n._pendingValue !== NOT_PENDING) insertSubs(n);
        // A staged error is a staging too: void with it, or the commit below
        // would publish the empty slot as the node's error (#4748).
        n._pendingValue = NOT_PENDING;
        n._config &= ~CONFIG_STAGED_ERROR;
        if ((n as Computed<any>)._statusFlags & STATUS_PENDING) {
          x._inFlight = null;
          enqueueSub(n as Computed<any>);
        }
      }
      if (l._shown) {
        // A derivation born in the lane (its staging, voided above, was its
        // only value) whose frame stays: nothing in the truth may notify it
        // (a row the truth keeps, its fields equal) — it re-derives on the
        // truth now (D-34, F-1; #4861).
        const born = !effect && (n as Computed<any>)._statusFlags & STATUS_UNINITIALIZED;
        commitPendingNode(n);
        if (!effect) {
          n._config |= CONFIG_INPUTS_PUBLISHED;
          if (born) enqueueSub(n as Computed<any>);
        }
        // A render effect born in the lane's frame (it never ran) whose
        // first run the held lane parked, dropped below: the frame stays, so
        // the row it draws must too — it runs on the committed world (F-1,
        // #4831). (A lane's pass of an effect always owes a run.)
        else if (l._held && (n as any)._prevValue === undefined) enqueueSub(n as Computed<any>);
      } else {
        if (x._pendingFirstChild !== null || x._pendingDisposal !== null)
          GlobalQueue._dispose(n as Computed<any>, false, true);
        n._config &= ~(CONFIG_STAGED | CONFIG_HELD | CONFIG_HELD_FRAME);
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
 * member throws like any. A verdict reader entering a lane the seam has
 * not judged reads ahead of it like a staging read: if the seam holds the
 * lane, the pass re-derives on the screen (`entered`, #4284) — `latest()`
 * beside the lane's nodes tears ahead of the hold however the reads are
 * grouped into effects. */
/** #4788: the lanes whose guesses an action read imperatively (its body, a
 * setter: `laneRead`, a store setter's draft), each with the question the
 * reading action asks (`question`): a guess that action writes next derives
 * from them (guesses.ts `optimisticWrite`); another action's reads are not
 * its own. Kept while the lane read lives (guesses.ts `applyGuessesAt`). */
export const readGuesses: unknown[] = [];
export function laneRead(c: Computed<any> | null, el: Signal<any> | Computed<any>): unknown {
  const guess = el._config & CONFIG_GUESS;
  const l = txOf(el);
  // A lane a correction folded under (D-34): store/optimistic.ts reads it.
  // Before the authoritative arm: an `until` outside the lane reads the
  // same truth there, and joins the hold it folded into — its posture over
  // a foreign hold (D-31), which the truth read alone would not take.
  const folded = c !== null && l.folded;
  if (folded) {
    const v = folded(c, el);
    if (v !== NOT_PENDING) {
      if (__TEST__) shadowActual(el._pendingValue !== NOT_PENDING ? SLOT_P : SLOT_C);
      return v;
    }
  }
  if (c !== null && c._config & CONFIG_AUTHORITATIVE) {
    if (__TEST__) shadowActual(SLOT_T);
    return GlobalQueue._truth!(el);
  }
  const status = (el as Computed<any>)._statusFlags;
  // An errored member's lane value predates its error; the error is the answer (#4106).
  if (!guess && status & STATUS_ERROR) {
    // The error still belongs to this lane. A downstream memo must select
    // the same update before read() throws, as it does for a lane value.
    if (c !== null && tracking && !(c._config & CONFIG_CHILDREN_FORBIDDEN)) enterLane(l, c);
    return NOT_PENDING;
  }
  if (c === null) {
    if (__TEST__) shadowActual(SLOT_LV);
    // #4788 (D-33): an action's imperative read of a guess — its body, a
    // setter — that a guess it writes next may derive from.
    // A store target's carrier is noted per key (store/optimistic.ts).
    if (guess && actionDepth && !(el._config & CONFIG_SLOT_NODE)) readGuesses.push(l, question);
    return latestOf(el);
  }
  const pending = !guess && status & STATUS_PENDING;
  if (!tracking || c._config & CONFIG_CHILDREN_FORBIDDEN) {
    // An untracked read inside lane work derives from the lane like a
    // tracked one, minus the subscription — `untrack` is about
    // dependencies, not about which world a pass derives from (a mapper's
    // row reads under its root, store/map): the pass enters the lane (two
    // lanes read by one pass link, as for tracked reads). Outside lane
    // work, the screen.
    if (passLane === null || c._config & CONFIG_CHILDREN_FORBIDDEN) {
      if (__TEST__) shadowActual(SLOT_DV);
      return screenOf(el);
    }
  } else if ((c as any)._type === EFFECT_RENDER) {
    // A flight whose value has never shown: nothing to show — the leaf
    // waits on it, and its own frame holds (A15, #3334), not the lane's
    // parent. The landing lands the frame: its own pass (the flush joined
    // its transaction) reads the answer it waited on — the lane's staging,
    // revealed at this seam. Not a member pending only on `refresh()`
    // re-asks: a re-ask asks no new question and holds nothing new (D-34
    // ¶3), so another lane's leaf reads its screen and shows that lane's
    // guess beside it (F-11, #4889).
    const never = pending && !el._x!._shown && !reasks(el as Computed<any>);
    // D-28: a leaf a verdict read moved into the lane still throws on such
    // a flight — the pass leaves the lane, and its frame holds as if the
    // read had come first (S-39, #4275). Nor does a verdict lane's seat carry
    // the leaf into another lane (no link): it reads that lane as from the
    // frame's seat (#4284).
    const p = passLane;
    const seated = isVerdict(p);
    if (seated && (never || p !== l)) setPassLane(null);
    if (passLane === null || !sameLane(passLane, l)) {
      // (A lane that has never shown: the screen is the committed value.)
      if (never && l._shown) return NOT_PENDING;
      // A held leaf reads a shown verdict lane's staging as its frame's
      // (#4275, S-39). Not a guess lane's: there it is the lane's, for its
      // next reveal — read as the frame's, the leaf's run waited with the
      // frame and the reveal never re-ran it; a guess into a log whose lane
      // has shown stayed hidden behind another action's refresh (F-11,
      // D-26, #4666). It reads the screen and re-derives at the reveal
      // (below), or enters the lane.
      if (
        !guess &&
        l._shown &&
        isVerdict(l) &&
        el._pendingValue !== NOT_PENDING &&
        c._config & CONFIG_HELD &&
        flushTransaction !== null &&
        resolveTx(flushTransaction) === txOf(c)
      ) {
        if (__TEST__) shadowActual(SLOT_P);
        return el._pendingValue;
      }
      if (l._held || pending) {
        // S-58 (D-25): a mount a probing pass opened (CONFIG_MOUNT_AHEAD) is
        // born held on its first pass's plain read of the lane's flight, not
        // served the screen: served, it initializes with S-46's frame, which
        // the lane reveals at its landing. It waits on the flight instead
        // (`read` throws the flight's NotReady below the lane arm).
        if (pending && c._config & CONFIG_MOUNT_AHEAD && c._statusFlags & STATUS_UNINITIALIZED)
          return NOT_PENDING;
        // Re-derived at the reveal; once per pass (the pass may also be a stale
        // reader of a transaction, REACTIVE_FRAME_READ — both reruns apply).
        // Before the throw below: a leaf that waits on a lane that has never
        // shown has no flight to settle it — only the reveal re-derives it,
        // and its pending holds its frame until then (#4338). Not a member's
        // own flight in a lane that showed and is not held: the reveal has
        // nothing new for the leaf, which re-derives when that flight lands
        // — re-queued at every reveal, each re-derivation read the same
        // flight and queued the next, and the flush never settled (#4840).
        if (!(c._flags & REACTIVE_SCREEN_READ) && (l._held || !l._shown)) {
          c._flags |= REACTIVE_FRAME_READ | REACTIVE_SCREEN_READ;
          l._reruns.push(c);
        }
        // Nothing on screen yet (uninitialized: NOT_PENDING).
        const v = screenOf(el);
        if (v === NOT_PENDING) throw new NotReadyError(null);
        if (__TEST__) shadowActual(SLOT_DV);
        return v;
      }
      // A verdict reader reads ahead of the seam's verdict: re-derived on the
      // screen if the lane holds (#4284).
      if (c._config & CONFIG_VERDICT && !isVerdict(l)) entered.push(c);
    }
  }
  // A render effect or memo of the lane reading a member that waits on
  // `refresh()` re-asks only reads what it shows: a re-ask holds nothing new
  // (D-34 ¶3, `blockedBy` lets such a member's lane reveal), so a row the
  // lane builds binds beside the reader that shows it (F-1, #4864), and a
  // memo between shows the guess as the binding beside it does (F-1, #5090).
  // A boundary's tree (CONFIG_FRAME, not an effect) flattens what its insert
  // effects would show: a shown member reads as it shows, the lane's guesses
  // on the screen (D-33, #4999).
  enterLane(l, c);
  if (__TEST__ && !pending) shadowActual(SLOT_LV);
  return pending &&
    !(guessed && !((c as any)._type > EFFECT_RENDER) && reasks(el as Computed<any>)) &&
    !(c._config & CONFIG_FRAME && !(c as any)._type && el._x!._shown)
    ? NOT_PENDING
    : latestOf(el);
}

/** A guess in `l` whose own truth is in flight (its refetch — authoritative:
 * the landing supersedes, not the body's end). */
export function guessFlights(l: Transaction): boolean {
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
function laneSeam(l: Transaction, leaked: boolean): void {
  // Blocked — or one of its passes read a write the frame holds this seam:
  // its runs wait, the pass re-derives on the screen next round.
  // Re-based over a question still parked on another read (#4525): its rows
  // are that answer's, shown only with the question (F-1, D-34 ¶3, #4559).
  if (leaked || blocked(l) || (l.over && blocked(liveTx(l.over) || l))) {
    l._held = true;
    return;
  }
  l._held = false;
  l._shown = true;
  const p = resolveTx(l._parent!),
    v = p._reruns.filter(r => (r as any)._modified && r._x?._transaction === l);
  if (reruns(l)) revealing.push(p);
  // The parent lands this seam and re-derives readers whose runs the lane
  // stashed, voiding them (`reruns`: they are for the frame being replaced).
  // Beside other runs of the lane they show first: the lane's readers show
  // its answer together (F-6), and the re-derivation follows next round
  // (#4677: `pending: true` on an async memo over `isPending(id)` beside a
  // binding still `false`). Restoring a run `reruns` skipped changes nothing.
  else if (l._queues[0].length > v.length)
    l._queues[0].unshift(() => v.forEach(r => ((r as any)._modified = true)));
  for (let i = 0; i < l._nodes.length; i++) {
    const n = l._nodes[i] as Computed<any>;
    // (Not once a pass since has notified them — D-37: a lane does not
    // replay a run the screen made.)
    if (n._notifiedAt === LEFT_SHOWN) insertSubs(n);
    const x = n._x!;
    if (x._transaction !== l) continue;
    // The lane's value is the screen's: a guess moves from the lane's
    // record to `_value` (`reveal`); a derivation's staging commits (a staged error publishes,
    // D-41; the frame it built retires the one it replaces). A truth held
    // beneath a guess stays its staging. An effect's value slot is private.
    if (!(n as any)._type)
      if (n._config & CONFIG_GUESS) {
        if (covers.has(n)) reveal(n);
      } else if (n._pendingValue !== NOT_PENDING) {
        commitPendingNode(n);
        n._x!._shown = true;
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
  if (guessed) for (const n of u._nodes) marked.delete(n);
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
 * up likewise: the question was asked in this frame. So does a shown guess
 * a correction re-homed into `t` (`marked`): still the screen's and the
 * untracked reads' value (F-11, D-34), its flight — the action's `refresh()`
 * after an outside re-ask corrected it — is the answer it waits for, as
 * before the correction (D-7, D-35). With no render effect pending on that
 * flight, `t` landed at the body's end: effects and untracked reads saw the
 * re-ask's answer until the refresh landed, while rendered readers kept the
 * guess (#4690). Not a lane's: guessed again there, its flight blocks the
 * parent, not the lane (A17, `linkBlocked`). */
function lanesBlocked(t: Transaction): boolean {
  if (guessed && !t._lane && t._nodes.some(n => marked.has(n) && inFlight(n))) return true;
  // A lane flight one of the frame's own passes asked (`laneWait`, S-57):
  // the frame holds on it and reveals with the lane. Kept on the lane, and
  // the frame found through `over`, so a frame merged since still waits.
  if (!t._lane)
    for (let i = 0; i < lanes.length; i++) {
      const l = lanes[i];
      if (
        l.waits !== undefined &&
        l.over !== undefined &&
        liveTx(l.over) === t &&
        l.waits.some(n => n._statusFlags & STATUS_PENDING)
      )
        return true;
    }
  // S-46 (D-25): a mount a display-ahead read gates attaches at the
  // landing; the verdict lane that opened it reveals with that landing, not
  // ahead of it (shown now, the branch attached with its hole empty, #4417,
  // or with the committed value a re-derived mount read).
  if (
    t._lane &&
    t._parent!._verdict === t &&
    ((t._opened && holdsOn(resolveTx(t._parent!))) || heldMountUnder(null, t))
  )
    return true;
  // A frame flight the seam parked beside its reader's lane pass (R5) is the
  // hold's question still: the hold waits on it (`park`).
  if (!t._lane && r5Hook && r5Hook(null, t)) return true;
  return (t._lane && linkBlocked(t)) || nestedBlocked(t);
}
/** Mounts a probing pass opened and a hold holds (CONFIG_MOUNT_AHEAD,
 * born held render effects): collected from the live transactions' node
 * lists — each list scanned once past where it was last scanned, so a
 * node is looked at once in its life — and pruned as they attach or go
 * away. Almost always empty: a born-held mount is rare, and every check
 * below is a walk of this list, never of the holds. */
const aheadMounts: Computed<any>[] = [];
function collectMounts(): void {
  for (let k = 0; k < transactions.length; k++) {
    const t = transactions[k],
      nodes = t._nodes;
    for (let i = t.scanned ?? 0; i < nodes.length; i++) {
      const r = nodes[i] as Computed<any>;
      // (A node re-held into a second transaction is listed twice; the
      // second entry is pruned with the first.)
      if (r._config & CONFIG_MOUNT_AHEAD) aheadMounts.push(r);
    }
    t.scanned = nodes.length;
  }
}
/** The hold `t` waits: an action open in its frame, or a flight it holds. */
function holdsOn(t: Transaction): boolean {
  return (
    t._open !== 0 ||
    t._nodes.some(
      n =>
        !(n as any)._type &&
        (n as Computed<any>)._statusFlags! & STATUS_PENDING &&
        !((n as Computed<any>)._flags & REACTIVE_DISPOSED)
    )
  );
}
function shownBy(r: Computed<any>): unknown {
  for (let s = r._subs; s !== null; s = s._nextSub)
    if ((s._sub as any)._type === EFFECT_RENDER && !hiddenHook?.(s._sub)) return 1;
}
/** A collected mount still held, uninitialized, on screen and waiting —
 * on its own flight, an action open in its frame, or a flight its frame
 * holds — under `o`, or under one of lane `l`'s nodes (by its owner
 * chain). */
export function heldMountUnder(o: Owner | null, l: Transaction | null): boolean {
  collectMounts();
  for (let i = aheadMounts.length - 1; i >= 0; i--) {
    const r = aheadMounts[i];
    if (
      !(r._statusFlags & STATUS_UNINITIALIZED) ||
      !(r._config & CONFIG_HELD) ||
      r._flags & REACTIVE_DISPOSED
    ) {
      aheadMounts.splice(i, 1);
      continue;
    }
    const t = resolveTx(r._x!._transaction!);
    const holds = holdsOn(t);
    if (
      // A memo mount is on screen through the render effect that reads it
      // (#4806: a fragment, text beside a hole, returned to the slot). One
      // a memo reads is that memo's: a boundary the mount builds around it
      // shows its fallback (#3851).
      ((r as any)._type ? hiddenHook?.(r) : !shownBy(r)) ||
      !(r._statusFlags & STATUS_PENDING || holds) ||
      // Pending only on `l`'s reveal (a node born in `l`): it waits on `l`, not `l` on it (S-30).
      (l !== null &&
        !holds &&
        !r._x!._pendingSources?.size &&
        (l._links || [l]).some(u => u._reruns.indexOf(r) !== -1))
    )
      continue;
    for (let p: Owner | null = r._parent; p !== null; p = p._parent)
      if (l !== null ? (p as Computed<any>)._x?._transaction === l : p === o) return true;
  }
  return false;
}
/** F-2 (S-57): a pass this flush dirtied — it read the flush's staging —
 * ran as a lane's (a derivation of a guess, or a `latest`-only asker in a
 * verdict lane) and asked: its flight is the lane's, so the flush would
 * have nothing of its own to wait for and would publish the write beside a
 * stale derivation of it (F-1). The flush joins a frame instead and holds
 * on the flight, revealing with the lane at its landing. */
function laneWait(el: Computed<any>, l: Transaction): void {
  // A guess's lane (the row's shape). A verdict lane's `latest`-only asker
  // re-asked by an outside write is the same sentence, not built: the
  // write publishes as before.
  if (!globalQueue._running || l._parent!._verdict === l) return;
  const t = flushTransaction;
  // The hold's own work (the lane's parent is this flush's frame): it
  // already waits on its lane (`nestedBlocked`), a round after the reveal.
  if (t !== null && resolveTx(l._parent!) === t) return;
  // Entangled: the lane's work reads the frame's staging as its own world
  // (core.ts `frameRead`, the `over` arm) and the lane holds while the
  // frame does (`laneSeam`) — one question, one reveal. A lane already
  // over another live frame (a keyed rebase over a landing's answer,
  // #4536) cannot take a second: the write publishes as before, beside the
  // lane's answer to its old question (the limit of this build).
  const o = l.over && liveTx(l.over);
  if (o && o !== t) return;
  joinFuture(null);
  l.over = flushTransaction!;
  (l.waits ??= []).push(el);
  // Not a staged reader to re-derive on the committed world at this seam:
  // that would ask the question of the old world again.
  const k = stagedReaders.indexOf(el);
  if (k !== -1) stagedReaders.splice(k, 1);
}
/** Parents whose lane revealed this seam with readers to re-derive there
 * (`laneSeam`): the lane shows ahead of its parent (F-6), so the parent lands
 * a round later — after those readers have shown the lane's answer — even
 * when nothing else holds it (#4393). */
const revealing: Transaction[] = [];
/** The lanes under `t` (its own; a link group's are each other's). */
function nestedBlocked(t: Transaction): boolean {
  if (revealing.indexOf(t) !== -1) return true;
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
  // A write on a guess is the guess layer's: judged against the guess, or
  // held beneath it (guesses.ts `guessWrite`).
  if (el._config & CONFIG_GUESS) return (guessWriteHook!(el, v), v);
  const l = txOf(el);
  if (el._equals && el._equals(latestOf(el) as T, v)) return v;
  el._pendingValue = v;
  if ((el as any)._fn !== undefined) (el as Computed<T>)._time = clock;
  laneDirty(el, l);
  schedule();
  return v;
}

/** The lanes alive before this seam's guesses opened theirs (a prefix of
 * `lanes`; nothing dissolves one between here and the seam loop): a lane
 * born at the seam has no work to judge yet (its passes run next round) —
 * it is neither shown nor blocked until it has. */
let judged = 0;
/** The guess layer's seam (guesses.ts `applyGuessesAt`), before its
 * guesses open their lanes. */
export function markJudged(): void {
  judged = lanes.length;
}
/** The effects that derive plainly from a landing this round that
 * re-derives a stale reader (A15) reading it as committed: its held runs
 * wait for the re-derivation (`land`), and these runs are that frame too —
 * they wait with them (verdict.ts `attachWaits`; F-1, F-7, #4677). The walk
 * stops at verdict readers: what derives from a display-ahead read shows
 * now (F-6, D-25, #4398). Dropped at the end of the round's effect phase. */
export let waiting: Set<unknown> | null = null;
/** A transaction lands: its lanes end, nested first (`endLanes`). */
function landing(u: Transaction): void {
  walk(u);
  endLanes(u);
}
/** Read before the lanes end: a lane's runs are its reveal's (F-6). */
function walk(u: Transaction): void {
  // As `reruns` judges it: a stale-reader memo re-derives onto a question of
  // its own, and the landing's held runs wait for a re-derivation.
  if (
    !u._reruns.some(r => !(r as any)._type && r._flags & REACTIVE_FRAME_READ) ||
    !u._reruns.some(
      r =>
        (r._flags & REACTIVE_FRAME_READ || r._config & CONFIG_VERDICT) &&
        ((r as any)._type || r._config & CONFIG_HELD)
    )
  )
    return;
  if (!waiting) ((waiting = new Set()), globalQueue._queues[1].push(() => (waiting = null)));
  const q: any[] = u._nodes.filter(n => !(n._config & CONFIG_VERDICT));
  for (let n; (n = q.pop()); )
    for (let s = n._subs; s; s = s._nextSub) {
      const c: any = s._sub;
      if (waiting.has(c) || c._config & CONFIG_VERDICT || c._x?._transaction?._lane) continue;
      waiting.add(c);
      if (!c._type) q.push(c);
    }
}
/** `r`'s pass read a node a transaction holds (#4439). */
function readsHeld(r: Computed<any>): boolean {
  for (let d = r._deps; d; d = d._nextDep) if (d._dep._config & CONFIG_HELD) return true;
  return false;
}
const laneSeams = (t: Transaction | null): void => {
  // Passes that read a write the parked frame holds as the screen
  // (`stagedReaders`: lane work, a verdict reader before the verdict): they
  // re-derive on the committed world next round (and register as stale
  // readers of the transaction there); a lane's runs wait that round — a
  // lane sees the screen plus its own guesses.
  if (revealing.length) revealing.length = 0;
  // #4661 (F-6): a verdict reader whose pass read a flight of the frame
  // ahead of it (`latest`, verdict.ts `pendingVerdict`) before any plain
  // read of one is no frame reader of it, though its stale read of the
  // frame's staging (A10, `stagedScreen`) marked it one
  // (REACTIVE_FRAME_READ, which `blockedBy` counts): the mark comes off and
  // the reader holds nothing. It keeps what it read — the committed value
  // ("It should read the committed value, we can't reveal early outside of
  // latest. This is intentional tearing.", maintainer, 2026-11-03) — and the
  // flight's own landing re-derives it, not the frame's.
  for (const c of ahead.splice(0))
    c._flags & REACTIVE_FRAME_READ &&
      ((c._flags ^= REACTIVE_FRAME_READ), t?._reruns.splice(t._reruns.indexOf(c) >>> 0, 1));
  const leaked: Transaction[] = [];
  if (t !== null)
    for (let i = 0; i < stagedReaders.length; i++) {
      const r = stagedReaders[i],
        // A pass no transaction holds that read the frame's staging (an
        // effect, a `[s(), latest(s)]` reader watched before the frame had
        // a transaction): judged by the frame's — it re-derives only if the
        // frame stays parked; landing here, what it read is the screen (one
        // run, D-22).
        l = r._x?._transaction || (r._flags & REACTIVE_STAGED_READ ? t : null);
      // A verdict reader a later read of the same pass routed into a verdict
      // lane answered for itself: it re-derives at the holder's landing, not
      // now (one run — #3322, #3540). Other verdict-lane work re-derives only
      // if the frame stays parked: a transaction landing at this seam makes
      // what it read the screen (one run). The frame is the transaction that
      // holds what it read (`t`, this flush's — not always the lane's parent:
      // a landing that reached a frame held elsewhere joined that one). A reader a
      // transaction holds that read none of its stagings (a verdict reader
      // that probed only a flight, held as the frame's pending observer or
      // its staged derivation) has nothing to re-derive: its re-run
      // re-enters that transaction and parks it again, every round — it
      // runs at the landing (#4349). Not one whose probe this seam's park
      // answered: a flight it asked about before anything joined is held
      // now, so its re-run routes into the holder's verdict lane and shows
      // the verdict now (F-6, D-23); run only at the landing, its
      // `isPending` read `false` for the whole hold (#4439). One that read a
      // staging, or such a flight, re-derives only if its frame stays
      // parked: landing at this seam, what it read is the screen (one run,
      // D-22). Not one born into that frame (a held pass's child, ruling A):
      // it has no screen, its reads are the transaction's either way — it
      // runs again at the landing, not now. Nor lane work re-based over this
      // frame's answer (#4536, merged since or not): its rows are that
      // answer's, so its other reads are too (core.ts `frameRead`), and the
      // lane holds while the frame does (`laneSeam`).
      // Re-derived on the committed world, it paired the new rows with the
      // old inputs, and the landing revealed that beside them (F-1, D-34 ¶3,
      // #4577). A lane linked to such a lane counts (one reveal unit): a
      // memo seated in one whose pass read through the other read the
      // frame's staging there, and, re-derived, it re-entered that lane,
      // read it again and parked again, every round (#4643).
      if (
        r._flags & REACTIVE_DISPOSED ||
        (l?._lane
          ? (isVerdict(l) &&
              (r._config & CONFIG_VERDICT
                ? !(r._flags & REACTIVE_PROBE_UNANSWERED)
                : !blocked(t!))) ||
            (l._links || [l]).some(u => u.over && liveTx(u.over) == t)
          : l &&
            !(
              r._flags & REACTIVE_PROBE_UNANSWERED ||
              ((r._flags & REACTIVE_STAGED_READ || readsHeld(r)) && blocked(l) && !bornInto(r, l))
            ))
      )
        continue;
      // A leaked effect re-derives seated in its lane from its first read: it
      // carries no lane value (`laneStage`), so without this its pass starts
      // as mainline, joins the parked frame on its first held read and reads
      // the staging, then re-enters the lane at its guess read and leaks
      // again — every round (#4014). A computed is already seated by its
      // override, and a written guess's own pass stays the frame's.
      if (l?._lane && (r as any)._type) r._flags |= REACTIVE_LANE_DIRTY;
      // R5 for an async reader: its frame pass asked the frame's question
      // (F-6's lane gets its own pass now). That flight is the frame's
      // answer: the landing adopts it rather than asking it again (F-9: a
      // re-ask of the same question is no new question; `reruns`). A frame
      // landing at this seam has nothing to re-derive: the pass was the
      // landing's, its flight the screen's answer. Sync or async, the
      // reader's lane pass is still to come: the verdict lane it joins does
      // not reveal this seam (F-6: the lane's readers show its answer
      // together, D-23: atomic with the value) — revealed now, it showed a
      // verdict beside the frame pass's value, before the pass that answers
      // for the lane, and a reader of the re-derived memo read it outside
      // the shown lane and waited for the frame (#4393).
      else if (!l?._lane && r._flags & REACTIVE_PROBE_UNANSWERED) {
        // (verdict.ts `r5`: only the verdict engine leaves a probe unanswered.)
        if (r5Hook!(r, t)) continue;
        if (t?._verdict && leaked.indexOf(t._verdict) === -1) leaked.push(t._verdict);
      }
      enqueueSub(r);
      if (l?._lane && leaked.indexOf(l) === -1) leaked.push(l);
    }
  // A verdict lane born at this seam is judged with it: it exists only once
  // a pass routed into it — the park seam's zombie verdict readers re-run
  // as its work so that this seam reveals them (#3444).
  // A lane a guess re-asked at this seam is judged with that guess's passes,
  // next round: its reveal is whole (#4775).
  for (let k = lanes.length - 1; k >= 0; k--)
    if ((k < judged && lanes[k]._reguessed !== clock) || isVerdict(lanes[k]))
      laneSeam(lanes[k], leaked.indexOf(lanes[k]) !== -1);
  // A verdict reader that entered a lane this seam held: its run waits with
  // the lane, and the verdict beside it would freeze — it re-derives next
  // round from the frame's seat, a stale reader of the lane (#4284).
  for (let r; (r = entered.pop()); )
    if (r._x!._transaction?._held) {
      r._flags &= ~REACTIVE_LANE_DIRTY;
      enqueueSub(r);
    }
  // (verdict.ts `r5`: the round's armed readers and re-asked passes ran.)
  if (r5Hook) r5Hook(null, null);
};
/** A15: lane work or a verdict reader was served `el`'s committed value
 * (core.ts `frameRead`), so its pass does not wait on `el`'s flight: what
 * `el`'s pending propagated onto it before the pass (its origins, `el`
 * included) is not this pass's — the landing re-derives it (`reruns`).
 * Kept, a pass that went pending on another source never woke when that
 * source settled (#4397). Only a reader something made pending has anything
 * to drop. What the drop retires is retired from the dependents that carried
 * it through `c` too: the source's own landing walk stops at `c`, which no
 * longer has it, and a render effect left marked would hold its transaction
 * on a flight that has landed (D-11, F-2, #4576; a nested action's refresh). */
/** Each lane pass served a flight's committed value: that flight, and the
 * pass (`_depGen`), so a later pass of the same node did not read it. Kept
 * per node: a pass that runs another node's pass inside its own (a nested
 * memo created or pulled mid-body) must still find its own record after the
 * inner one recorded (#4927). */
const served = new WeakMap<Computed<any>, [flight: Computed<any>, gen: number]>();
const laneServed = (
  c: Computed<any>,
  el: Signal<any> | Computed<any> | null,
  flight?: true
): unknown => {
  // Lane work read a staging of the flush after it was served the committed
  // value of a flight (core.ts `stagedRead`): it derives from the write that
  // re-asked the flight, so it waits on it — never the new value beside the
  // old answer (F-1, F-2; S-57).
  // Asked with `flight` (core.ts `recompute`): whether it was so served.
  if (el === null) {
    const s = served.get(c);
    if (s && s[1] === c._depGen && s[0]._statusFlags & STATUS_PENDING) {
      if (flight) return true;
      throw s[0]._x!._error;
    }
    return;
  }
  // Lane work reading a flight that is not the lane's own (core.ts `read`,
  // A31): served its committed value — the lane breaks out of its parent's
  // hold — unless the pass read a staging of the flush, which makes it that
  // write's work: it waits on the flight as mainline does (F-2; S-57).
  // Served, the pass still derives from the flight: its stale reader (A15,
  // #3494), so the frame holds on it and re-derives it at the landing.
  if (flight) {
    if (c._flags & REACTIVE_STAGED_READ) return false;
    const u = (el as Computed<any>)._x?._transaction || flushTransaction;
    if (u) staleReader(c, resolveTx(u));
    served.set(c, [el as Computed<any>, c._depGen]);
    return true;
  }
  const from = (el as Computed<any>)._x?._pendingSources;
  if (from && c._x?._pendingSources)
    for (const s of from) if (removePendingSource(c, s)) settlePendingSource(c, s);
};
/** This flush's verdict readers that read a flight ahead of the frame
 * (#4661, the seam). */
export const ahead: Computed<any>[] = [];
/** Render effects that read a verdict and entered a lane before its seam (#4284). */
const entered: Computed<any>[] = [];
installLaneHooks(laneRead, laneStage, laneWrite, laneSeams, landing, lanesBlocked, laneServed);
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
GlobalQueue._verdictLane = verdictLane;
