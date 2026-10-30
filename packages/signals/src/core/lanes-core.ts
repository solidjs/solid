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
// This module is the lane engine's sub-hold core — what any lane needs: the
// lane record (a transaction with `_lane`), link/blocked/reveal/landing, the
// rows of a seated pass and of a lane's node (`seatRows`), the verdict lane
// (`verdictLane`, a lane record whose node set is the reveal record of the
// hold's verdict readers) — installed on the scheduler's hooks when
// something imports it (verdict.ts for its verdict lanes, or the optimistic
// layer). The guesses — a written guess, its lane opening at the seam, its
// truth arriving, the corrections — are the optimistic layer (lanes.ts),
// reached from here through `installOptimisticHooks` and carried only by a
// build that imports `createOptimistic`. The core keeps only bit tests and
// `passLane`: a program with no optimism and no verdict carries none of
// this.

import {
  CONFIG_AUTHORITATIVE,
  CONFIG_CHILDREN_FORBIDDEN,
  CONFIG_FRAME,
  CONFIG_GUESS,
  CONFIG_HELD,
  CONFIG_HELD_FRAME,
  CONFIG_INPUTS_PUBLISHED,
  CONFIG_OVERRIDE,
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
import { attrHooks } from "./attribution-hooks.js";
import { claim, ext, joinPass, joinPassAt, markLateLinker } from "./core.js";
import { NotReadyError, type StatusError } from "./error.js";
import { handleAsync, isThenable, notifyStatus, releaseFlightTeardown } from "./async.js";
import { laneValueOf } from "./truth.js";
import { link } from "./graph.js";
import { deleteFromHeap, enqueueSub } from "./heap.js";
import {
  blocked,
  clock,
  commitPendingNode,
  flushTransaction,
  GlobalQueue,
  globalQueue,
  holdNode,
  insertSubs,
  laneDirty,
  latestOpened,
  list,
  stagedReaders,
  staleReader,
  newTransaction,
  ownFlights,
  passLane,
  queuePendingNode,
  releaseQueues,
  reruns,
  dirtyQueue,
  resolveTx,
  sameLane,
  schedule,
  setPassLane,
  txOf,
  type Transaction,
  installLaneHooks,
  verdictApplyHook
} from "./scheduler.js";
import {
  LANE_BITS,
  MARK_AH,
  MARK_ENTERED,
  MARK_JF0,
  MARK_LANE_READ,
  MARK_LATE,
  MARK_LEAVE,
  MARK_LINK,
  MARK_LST,
  MARK_OBS,
  MARK_ST,
  MARK_UNANS,
  MARK_W,
  RAISE_FL,
  RAISE_H,
  RAISE_HAT,
  RAISE_LANE,
  RAISE_MASK,
  RAISE_VSEAT,
  ROW,
  SLOT_C,
  SLOT_DV,
  SLOT_E,
  SLOT_ESHOWN,
  SLOT_ESTAGED,
  SLOT_FOLD,
  SLOT_LV,
  SLOT_MASK,
  SLOT_NONE,
  SLOT_NR,
  SLOT_NR0,
  SLOT_P,
  SLOT_RETRY,
  SLOT_SNAPSHOT,
  SLOT_T,
  VERDICT_BITS,
  bornInto,
  dispNP,
  laneNP,
  laneOf,
  carry,
  plainRows,
  raiseSeatWorld,
  setRow,
  readerVhold,
  SEAT_BORN,
  SEAT_OWN_FL,
  SEAT_READ,
  seatLane,
  seatRow,
  seatTx,
  seatWorld,
  unflushed
} from "./seat.js";
import type { Computed, Owner, Signal } from "./types.js";

export { laneValueOf };

// The optimistic layer (lanes.ts), when a build has it: the guess arms of
// the sub-hold core. A build with `isPending`/`latest` and no
// `createOptimistic` carries this module and not that one; the arms below
// are reached only for a node carrying a guess (CONFIG_GUESS), which only
// the layer writes, so the `!` calls are safe and the `!== null` guards
// are for the arms a lane reaches without one.
/** A guess in `l` whose own truth is in flight (`guessFlights`). */
export let guessFlightsHook: ((l: Transaction) => boolean) | null = null;
/** Lane `l` takes `n`'s guess, another action's (`take`). */
export let takeHook: ((n: Signal<any>, l: Transaction) => void) | null = null;
/** The value a guess covered (`covered`). */
export let coveredHook: ((n: Signal<any>) => unknown) | null = null;
/** A write landing on a guess (`guessWrite`): true when judged against the
 * guess; false when the slot was taken by another lane's derive and the
 * write is a lane derivation's. */
export let guessWriteHook: ((el: Signal<any> | Computed<any>, v: unknown) => boolean) | null = null;
/** A revert landing gives back the guesses its lane took (`revertLanding`). */
export let revertLandingHook: ((u: Transaction) => void) | null = null;
export function installOptimisticHooks(
  flights: NonNullable<typeof guessFlightsHook>,
  take: NonNullable<typeof takeHook>,
  covered: NonNullable<typeof coveredHook>,
  write: NonNullable<typeof guessWriteHook>,
  revert: NonNullable<typeof revertLandingHook>
): void {
  guessFlightsHook = flights;
  takeHook = take;
  coveredHook = covered;
  guessWriteHook = write;
  revertLandingHook = revert;
}

/** Live lanes (parented). Scanned at every seam while non-empty. */
export const lanes: Transaction[] = [];
/** A pass left a shown slot the equality gate can no longer see (#3892). */
const LEFT_SHOWN = 1 << 20;
export function newLane(parent: Transaction): Transaction {
  const l = newTransaction(true, parent);
  lanes.push(l);
  return l;
}

/** What the screen shows for a lane's node: the lane's value once the lane
 * has revealed, the committed truth before — NOT_PENDING when there is none
 * (uninitialized, as `laneValueOf`): its read throws NotReady. */
export function display(el: Signal<any> | Computed<any>): unknown {
  const v = el._x!._lane;
  return el._x!._transaction!._shown && v !== NOT_PENDING
    ? v
    : (el as Computed<any>)._statusFlags & STATUS_UNINITIALIZED
      ? NOT_PENDING
      : el._value;
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
 * propagation (async.ts `propagateStatus`), the node gone pending.
 * `provisional`: the hold whose verdict reader's provisional staging this
 * pass re-derived (D-2, #4417; core.ts `recompute`'s head kept it as the
 * pass's previous value) — superseded here, its readers re-deriving
 * (#4378), unless the lane seats the pass to the end with an answer: then
 * the staging is the lane's value meanwhile — what the pass compares
 * against; the lane's at the seam if the value stands (`adoptReaders`),
 * replaced if not. `l` is null for a provisional pass no lane seats. */
export function laneStage(
  el: Computed<any>,
  l: Transaction | null,
  create: boolean,
  errored: boolean | Computed<any>,
  provisional: Transaction | null = null
): boolean {
  if (provisional !== null && (l === null || errored || !(el._flags & REACTIVE_LANE_READ))) {
    insertSubs(el);
    el._pendingValue = NOT_PENDING;
  }
  if (l === null) return false;
  if (!(create || errored || el._flags & REACTIVE_LANE_READ || el._config & CONFIG_GUESS)) {
    const x = el._x;
    if (x !== null) {
      const tx = x._transaction;
      if (tx?._lane) {
        // Cleared before equality, so a return to the committed value
        // notifies nobody. The seam wakes it (#3892) — always for a pass
        // outside any transaction's flush: its value is the screen's now
        // (#4367). While a transaction's flush runs the pass and the lane's
        // frame is still held, what the screen shows stays the screen until
        // the landing, and `_value` takes it (as `dissolveLane` keeps a shown
        // lane's), so this pass's answer — the frame's — is a change against
        // what is seen and reaches the screen with the frame's commit. (Only
        // a lane is ever `_shown`.)
        if (tx._shown)
          if (!flushTransaction || !blocked(resolveTx(tx._parent!))) el._flags |= LEFT_SHOWN;
          else el._value = display(el);
        x._transaction = null;
      }
      x._lane = NOT_PENDING;
    }
    el._config &= ~(CONFIG_OVERRIDE | CONFIG_HELD | CONFIG_HELD_FRAME);
    return false;
  }
  if (!(el as any)._type) {
    if (!(el._config & CONFIG_OVERRIDE)) {
      const staged = el._pendingValue;
      el._pendingValue = NOT_PENDING;
      el._config = (el._config & ~(CONFIG_HELD | CONFIG_HELD_FRAME)) | CONFIG_OVERRIDE;
      ext(el);
      // A provisional pass seated to the end: the staging is the lane's
      // value for now — in the lane's slot while the lane has not shown,
      // as a lane pass's would be (`recompute`), as its staging once it has.
      if (provisional !== null && !errored) {
        if (l._shown) el._pendingValue = staged;
        else el._x!._lane = staged;
      }
    }
    // A written guess whose own pass is the lane's work — its source is a
    // derivation of another guess (a guess over `config().courier` under a
    // country guess) — is confirmed or corrected by the lane: a derivation
    // of the lane from here (its value the lane's, its fate the lane's), no
    // longer a written guess. A pass with no answer (pending, errored)
    // leaves the guess.
    // Nor a pass of another action's guess: the re-ask is this lane's new
    // question, which the guess (over the old one) does not answer — the
    // lane waits for its own answer (F-1, F-6, #4336). (A guess of the
    // lane's own action, D-33's entangled slot, still stands in.)
    // (The optimistic layer's, lanes.ts `take`: a build without optimism
    // carries no guess.)
    if (
      el._config & CONFIG_GUESS &&
      el._x!._transaction?._lane &&
      resolveTx(el._x!._transaction!._parent!) !== resolveTx(l._parent!)
    )
      takeHook!(el, l);
    else if (!errored) el._config &= ~CONFIG_GUESS;
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
  // First loads this dissolution leaves loading (below).
  const loading: Computed<any>[] = [];
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
      // Not a first load the lane produced nothing for whose own flight is
      // up, nor one pending on such a load kept here (an identity memo of
      // it, a derived store's derive): committing its empty `_value` would
      // initialize it as `undefined`, which `latest()` would serve and
      // `isPending()` call pending. It stays loading until its flight
      // answers (D-22, A19 exc. 1; async-gen 3289 #929, 91501 #504, #156).
      x._transaction = null;
      if (!effect && !guess)
        slot === NOT_PENDING &&
        ((n as Computed<any>)._statusFlags & (STATUS_UNINITIALIZED | STATUS_PENDING)) ===
          (STATUS_UNINITIALIZED | STATUS_PENDING) &&
        (x._inFlight || loading.some(q => x._pendingSources?.has(q)))
          ? loading.push(n as Computed<any>)
          : (n._pendingValue = latest);
      commitPendingNode(n);
      if (!effect) {
        if (
          (n as Computed<any>)._flags & (REACTIVE_IN_HEAP | REACTIVE_DIRTY | REACTIVE_CHECK) ||
          (n as Computed<any>)._statusFlags & STATUS_PENDING
        )
          n._config |= CONFIG_INPUTS_PUBLISHED;
        if (shown !== NOT_PENDING && (!n._equals || !n._equals(shown, n._value))) insertSubs(n);
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
    } else if (guess) {
      // A guess of a dissolving lane: its truth — a landing held beneath it,
      // else the value it covered — is the parent's to land, and its readers
      // re-derive from it there. What the screen showed stays the screen
      // until then (A18 (c)).
      if (n._pendingValue === NOT_PENDING) n._pendingValue = coveredHook!(n);
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

/**
 * The lane rows of the reader seat (seat.ts `slot` dispatches a lane's node
 * — CONFIG_OVERRIDE — here first): the slot the read is served and the
 * mechanisms it fires, packed (slot | raise); or the raise alone (slot 0) when
 * the lane has nothing to serve and the plain rows go on with these side
 * effects carried — a derivation in flight throws there, a node with
 * nothing in either view reads as any uninitialized node.
 *
 * A lane's node is read by its reader's kind. A folded lane's guess (D-34,
 * store/optimistic.ts) read by a deriving pass outside every seat is the
 * hold's world — the truth staged beneath, else what it covered — and the
 * pass joins that hold (D4'); an authoritative reader (`until`) sees the
 * truth and is no lane's (A1, D-31); an errored member's lane value
 * predates its error: the error is the answer (#4106, the plain rows); no
 * pass sees the lane's latest value (U3; A17 "direct read shows
 * optimistic"); a children-forbidden reader, or an untracked read outside
 * lane work, sees the screen (F1, D4''; A32); a render effect in the frame's
 * seat reading a lane the seam found blocked, or a member whose own flight
 * is up, sees the screen, re-derived at the reveal (L7, #3460's stale
 * reader) — or waits on a flight that has never shown (nothing to show):
 * its own frame holds (A15, #3334). Any other tracked reader is the lane's
 * work from this read (D4, L6: it enters — `laneApply`); a verdict reader
 * entering a lane the seam has not judged reads ahead of it like a staging
 * read, re-derived on the screen if the seam holds the lane (`entered`,
 * #4284). D-28 (#4275, #4284): a leaf seated as a hold's verdict reader
 * leaves the seat on a flight never shown, or for a lane that is not that
 * hold's, and reads from the frame's seat.
 */
export function laneSlot(
  c: Computed<any> | null,
  el: Signal<any> | Computed<any>,
  tracked: boolean,
  spectate: boolean
): number {
  const cfg = el._config;
  const guess = (cfg & CONFIG_GUESS) !== 0;
  const l = txOf(el);
  const cType = c !== null ? ((c as any)._type as number | undefined) : undefined;
  // D-34: the hold's world for a deriving pass outside every seat — not the
  // store's own derive, which is the author (`foldedRead`).
  if (
    c !== null &&
    l.folded &&
    guess &&
    passLane === null &&
    cType !== EFFECT_RENDER &&
    !(c._config & CONFIG_CHILDREN_FORBIDDEN) &&
    (el as any)._host?.fam?.node !== c
  ) {
    ROW && setRow("D4'");
    carry(resolveTx(l._parent ?? l));
    return SLOT_FOLD | RAISE_H | RAISE_HAT;
  }
  if (c !== null && c._config & CONFIG_AUTHORITATIVE) return (ROW && setRow("A1"), SLOT_T);
  const st = (el as Computed<any>)._statusFlags ?? 0;
  if (!guess && st & STATUS_ERROR) return 0;
  const staged = el._pendingValue !== NOT_PENDING;
  const uninit = (st & STATUS_UNINITIALIZED) !== 0;
  if (c === null) return laneNP(el, guess, staged, uninit) ? 0 : (ROW && setRow("U3"), SLOT_LV);
  const flying = !guess && (st & STATUS_PENDING) !== 0;
  const vlane = l._parent!._verdict === l;
  const row = ROW && (vlane ? "V6" : "");
  const forbidden = (c._config & CONFIG_CHILDREN_FORBIDDEN) !== 0;
  const nrLink = !tracked && !spectate && el !== c ? MARK_LINK : 0;
  /** The lane has a value to serve (`laneValueOf`), and the member is not
   * in flight (lane work's read of a pending member throws like any). */
  const has = !flying && !laneNP(el, guess, staged, uninit);
  let leave = 0;
  let extra = 0;
  let laneRow: string | 0 = row;
  if (!tracked || forbidden) {
    // Outside lane work, or the frame: the screen. Inside lane work an
    // untracked read derives from the lane like a tracked one (`untrack` is
    // about dependencies, not about which world a pass derives from).
    if (passLane === null || forbidden) {
      if (!dispNP(el, uninit)) return (ROW && setRow(row || (forbidden ? "F1" : "D4''")), SLOT_DV);
      return 0;
    }
    laneRow = ROW && (row || "D4");
  } else if (cType === EFFECT_RENDER) {
    // A flight whose value has never shown: nothing to show — the leaf
    // waits on it, and its own frame holds (A15, #3334), not the lane's
    // parent.
    const never = flying && el._x!._lane === NOT_PENDING;
    // D-28: the leaf leaves the verdict seat before the read is decided —
    // for such a flight, a lane that is not a hold's verdict lane, or
    // another hold's (resolved: a lane whose parent merged into the seat's
    // hold is that hold's, #4427).
    const vhold = readerVhold();
    if (vhold !== null && (never || !vlane || vhold !== resolveTx(l._parent!))) leave = MARK_LEAVE;
    const pl = leave ? null : passLane;
    if (pl === null || !sameLane(pl, l)) {
      // (A lane that has never shown: the screen is the committed value —
      // the throw is `read`'s.)
      if (never && l._shown) {
        ROW && setRow(row || "L7");
        carry(null, l);
        return SLOT_NR | leave | nrLink;
      }
      // L7' (D-2): a leaf the flush's hold holds reads a lane derivation's
      // staging — the hold's own value.
      if (
        !guess &&
        staged &&
        c._config & CONFIG_HELD &&
        flushTransaction !== null &&
        resolveTx(flushTransaction) === txOf(c)
      )
        return (ROW && setRow(row || "L7'"), SLOT_P | leave);
      if (l._held || flying) {
        // D-26 D-28: a stale reader of the lane — the display, re-derived at
        // the reveal (once per pass); nothing on screen yet: NotReady
        // (#4338 — only the reveal re-derives it, and its pending holds its
        // frame until then).
        ROW && setRow(row || "L7");
        carry(null, l);
        return (dispNP(el, uninit) ? SLOT_NR0 : SLOT_DV) | MARK_LST | leave;
      }
      // A verdict reader reads ahead of the seam's verdict (#4284).
      if (c._config & CONFIG_VERDICT && !vlane) extra = MARK_ENTERED;
      laneRow = ROW && (row || "L7");
    } else laneRow = ROW && (row || "L6");
  } else laneRow = ROW && (row || (flying ? "D4'''" : "D4"));
  // Entering the lane (`laneApply`): the pass is the lane's — or, a verdict
  // lane's, the hold's verdict reader (RAISE_VSEAT), unless its branch
  // exists only in the future (seat.ts `seatWorld`: a pass born in the
  // future or a staging — its running creators' world, transitively — or
  // one that read it itself, when a memo — D-25, D-26, #4341: the verdict
  // read does not break it out). The read is a
  // lane read either way (REACTIVE_LANE_READ). A pass that read the
  // frame's staging before its first lane read — a held write it joined, a
  // staging beside a guess written this round, or a verdict lane's value —
  // watches the seam from the lane's seat (`stagedRead`: lane work sees
  // the screen, the park re-derives it; #3969, #4336).
  let enter = MARK_LANE_READ | extra | leave;
  const f = c._flags;
  if (passLane === null || leave) {
    if (!(vlane && seatWorld & (cType ? SEAT_BORN : SEAT_READ))) {
      enter |= vlane ? RAISE_VSEAT : RAISE_LANE;
      if (f & REACTIVE_STAGED_READ) enter |= RAISE_FL | MARK_W;
    }
  } else enter |= vlane ? RAISE_VSEAT : RAISE_LANE;
  carry(vlane ? l._parent : null, l);
  if (has) return (ROW && setRow(laneRow || "L6"), SLOT_LV | enter);
  // Nothing to serve from the lane: a flight is the lane's wait (NR —
  // lane work throws on its own flights, D-37); else the plain rows go on.
  ROW && setRow(laneRow);
  if (flying) return SLOT_NR | enter | nrLink;
  return SLOT_NONE | enter;
}

/** The engines' rows of the reader seat (seat.ts `slot` dispatches here
 * through `seatRowsHook` for a lane's node, a seated pass, a verdict
 * reader): a lane's node takes the lane rows first (`laneSlot`); the raise
 * alone (slot 0) means the lane has nothing to serve and the seated rows
 * go on with it carried — the pass entered. */
function seatRows(
  c: Computed<any> | null,
  el: Signal<any> | Computed<any>,
  tracked: boolean,
  spectate: boolean
): number {
  carry(null);
  let r = 0;
  if (el._config & CONFIG_OVERRIDE) {
    r = laneSlot(c, el, tracked, spectate);
    if (r & SLOT_MASK) return r;
    const row = seatRow;
    r |= seatedRows(c, el, tracked, spectate);
    if (__TEST__ && r & RAISE_MASK) setRow(`${row}→${seatRow}`);
  } else r = seatedRows(c, el, tracked, spectate);
  // A hydration claim (seat.ts `claim`): the plain rows served the snapshot
  // themselves; an engine row's packed result becomes it here, keeping of
  // its raise what the old deciders fired before the snapshot
  // (`preSnapshotBits`).
  if ((r & SLOT_MASK) !== SLOT_SNAPSHOT && claim(c, el))
    r = (r & preSnapshotBits(el._config)) | SLOT_SNAPSHOT;
  return r;
}

/** The raise bits the old deciders applied before the hydration snapshot
 * served a reader in a snapshot scope: the hold arms (`frameRead`,
 * `joinPass`) and the lane read; everything after the snapshot (the
 * staging's, the flight's) did not run. */
function preSnapshotBits(cfg: number): number {
  return cfg & CONFIG_OVERRIDE
    ? LANE_BITS | RAISE_FL | MARK_W
    : cfg & CONFIG_HELD
      ? RAISE_H | MARK_ST
      : 0;
}

/**
 * The mechanisms an engine row fires, applied to the reader `c` (seat.ts:
 * the RAISE_* / MARK_* bits of `r`, with `seatTx` / `seatLane` naming the
 * hold and the lane). The lane bits first (`laneApply`) and the verdict
 * engine's (`verdictApplyHook`): a lane read moves the seat before the
 * pass's world is raised, and a verdict read opens the flush's transaction
 * before the hold is named. Then, in the order the old deciders fired them:
 * the join (H; `joinPassAt` into the hold named when RAISE_HAT), the
 * staging read (Fl), the unanswered probe, the seam watch (W), the stale
 * reader (ST), the late linker, the link of a throwing untracked read. (The plain rows fire
 * theirs directly, seat.ts `plainRows`; core.ts `readSlow` applies a
 * packed raise through `applyMarksHook`, verdict.ts `verdictValue`
 * directly.)
 */
export function applyMarks(c: Computed<any>, el: Signal<any> | Computed<any>, r: number): void {
  if (r & LANE_BITS) laneApply(c, r, seatLane);
  if (verdictApplyHook !== null && r & VERDICT_BITS) verdictApplyHook(c, el, r, seatTx);
  if (r & RAISE_H) {
    if (r & RAISE_HAT) joinPassAt(c, seatTx!);
    else joinPass(c, el);
  }
  if (r & RAISE_FL) {
    c._flags |= REACTIVE_STAGED_READ;
    if (c._flags & REACTIVE_RECOMPUTING_DEPS) raiseSeatWorld(SEAT_OWN_FL);
  }
  if (verdictApplyHook !== null && r & MARK_UNANS) c._flags |= REACTIVE_PROBE_UNANSWERED;
  if (r & MARK_W) stagedReaders.push(c);
  if (r & MARK_ST) staleReader(c, seatTx ?? flushTransaction!);
  if (r & MARK_LATE) markLateLinker(c);
  if (r & MARK_LINK) link(el, c);
}

/** The rows of a SEATED pass (`passLane`: lane work, or a hold's verdict
 * reader) and of a verdict reader (CONFIG_VERDICT; posture V, or A with the
 * window's flag — F-6's copy), over a node that is no lane's with a value to
 * serve. The engine decides the arms that are its own — the screen for lane
 * work and a verdict reader (D-37, D-23: stale, served), the seam's verdict
 * on a staging (V2/V3), a verdict reader's flight (V4), the seam watch on a
 * staging served (W) — and comes to the plain rows (seat.ts `plainRows`)
 * for the rest, in the table's order. */
function seatedRows(
  c: Computed<any> | null,
  el: Signal<any> | Computed<any>,
  tracked: boolean,
  spectate: boolean
): number {
  // (The U rows have no seat; neither has a children-forbidden reader
  // but for one arm, below.)
  if (c === null) return plainRows(c, el, tracked, spectate);
  const inSeat = passLane !== null;
  const lane = inSeat ? laneOf(passLane) : null;
  const ccfg = c._config;
  const forbidden = (ccfg & CONFIG_CHILDREN_FORBIDDEN) !== 0;
  /** Posture V, or A with the window's flag: a verdict reader. (A truth
   * reader of a lane's node took the lane rows — `until` sees the truth,
   * D-31; of any other node it reads as a derivation.) */
  const vReader = !forbidden && (ccfg & CONFIG_VERDICT) !== 0;
  if (!inSeat && !vReader) return plainRows(c, el, tracked, spectate);
  const cfg = el._config;
  const st = ((el as Computed<any>)._statusFlags as number | undefined) ?? 0;
  const isFn = typeof (el as Computed<any>)._fn === "function";
  const staged = el._pendingValue !== NOT_PENDING;
  const held = (cfg & (CONFIG_HELD | CONFIG_OVERRIDE)) === CONFIG_HELD;
  const uninit = (st & STATUS_UNINITIALIZED) !== 0;
  const pending = (st & STATUS_PENDING) !== 0;
  const errored = isFn && (st & STATUS_ERROR) !== 0;
  const stagedError = (cfg & CONFIG_STAGED_ERROR) !== 0;
  const stagedSlot = stagedError ? SLOT_ESTAGED : SLOT_P;
  const screen = isFn && el._x?._shownError ? SLOT_ESHOWN : SLOT_C;
  const cUninit = (c._statusFlags & STATUS_UNINITIALIZED) !== 0;
  const retry = errored && tracked && (el as Computed<any>)._time < clock;
  const nrLink = !tracked && !spectate && el !== c ? MARK_LINK : 0;
  const stash = held && unflushed(el) && el._x!._flushedAt === clock;
  const late = (held ? stash : unflushed(el)) ? MARK_LATE : 0;
  /** A staging served to a seated pass, or to a verdict reader that is an
   * effect (its pass re-derives once as a verdict reader if the flush
   * parks, D-22), watches the seam. (The plain rows' `stagedRead` does the
   * same for the arms they decide.) */
  const watch = inSeat || (vReader && !!(c as any)._type);

  // ── F: children-forbidden (the frame; A32) ─────────────────────────────
  if (forbidden) {
    // D-29: lane work's (or a hold's verdict reader's) frame reader over a
    // flight — the pass has a value, and so has the node — sees the screen
    // (`throwShown`). (An error, a first flight: the plain row.)
    if (pending && !uninit && !errored && !cUninit) return (ROW && setRow("F1"), screen);
    return plainRows(c, el, tracked, spectate);
  }

  // ── Common arms for L / D / V / A-as-D ─────────────────────────────────
  const leaf =
    !vReader &&
    !(ccfg & CONFIG_AUTHORITATIVE) &&
    ((c as any)._type === EFFECT_RENDER || (ccfg & CONFIG_FRAME) !== 0);
  const rowBase = ROW && (ccfg & CONFIG_AUTHORITATIVE ? "A1/" : "");
  const stagedServe = late ? MARK_LATE : uninit ? 0 : RAISE_FL | (watch ? MARK_W : 0);
  /** A hold a `latest()` alone opened holds nothing (D-22, F-10): the
   * staging is the frame's read, and the reader watches the seam. */
  const latestOnly =
    flushTransaction !== null && flushTransaction === latestOpened && !inSeat && !cUninit;
  /** `stagedScreen`: a verdict reader's — or lane work's — plain read of a
   * staging is the screen's once the frame has a hold, unless born into it
   * — a stale reader of the hold. */
  const stagedScreen = flushTransaction !== null && !bornInto(c, flushTransaction);
  /** A verdict reader's staging read (`serve`'s verdict arm, then
   * `stagedRead`): the screen and ST, or — under `latest()`'s hold alone,
   * or with no hold — the staging, Fl, and W (for a `latest()`-only hold
   * the seam watch comes from `stagedScreen` whoever the reader is). */
  const verdictStaged = (slotOf: number): number => {
    if (stagedScreen && !latestOnly) {
      ROW && setRow("V2");
      carry(flushTransaction, seatLane);
      return screen | MARK_ST;
    }
    ROW && setRow("V3");
    return slotOf | RAISE_FL | (latestOnly || watch ? MARK_W : 0);
  };
  /** The held rows the engine owns: the screen, a stale reader of the hold
   * — lane work's (D6, D-37), and a verdict reader's
   * (V1: a frame reader, re-derived at the landing, D-23 A10). Not a pass
   * with no screen to serve (born into the hold, uninitialized — the join,
   * V1'/V1''/D6'), nor a leaf's L4/L2 arms before it (the plain rows). */
  const t = held ? txOf(el) : null;
  const staleServed =
    held &&
    !uninit &&
    !bornInto(c, t!) &&
    (leaf ? inSeat && !(cfg & CONFIG_INPUTS_PUBLISHED) : vReader || !(cUninit && pending));

  // Error (D-41 #2897): the hold arms first, then a staged error served as
  // the staging would be (seat.ts).
  if (errored) {
    if (held && staleServed) {
      carry(t, seatLane);
      let r = MARK_ST; // (stale; the screen's slot is the error's)
      const s = retry ? SLOT_RETRY : SLOT_E;
      // (`!(r & MARK_ST)`: a reader served the screen throws the shown one.)
      ROW && setRow(leaf ? "L8" : rowBase + "D5");
      return r | s;
    }
    if (vReader && stagedError && !retry && !uninit && !late) {
      // V2/V3 for the staged error (D-41): the screen and ST, or the staged
      // error and Fl.
      let r = 0;
      if (held) {
        carry(t, seatLane);
        r = RAISE_H;
      }
      const v = verdictStaged(SLOT_ESTAGED);
      ROW && setRow(rowBase + "D5");
      return r | (v & RAISE_MASK) | ((v & SLOT_MASK) === SLOT_ESTAGED ? SLOT_ESTAGED : SLOT_E);
    }
    return plainRows(c, el, tracked, spectate);
  }

  // Held node.
  if (held) {
    if (staleServed) {
      carry(t, seatLane);
      ROW && setRow(leaf ? "D6" : vReader ? "V1" : rowBase + "D6");
      return screen | MARK_ST;
    }
    const p = plainRows(c, el, tracked, spectate);
    if (ROW && !leaf) setRow(vReader ? (bornInto(c, t!) ? "V1'" : "V1''") : rowBase + "D6'");
    return p;
  }

  // Staged this flush, not held — the seam's verdict (V2/V3, D-23 D-32
  // [R5]): the screen once the tick has a hold, the staging before; folded
  // lane work reads the screen (D-34, D7'). (An unflushed write, a node born
  // staged read by a spectator, a staging beneath a flight: the plain rows.)
  if (staged && !pending && !(late && !uninit) && !(uninit && spectate)) {
    if (vReader && !uninit) return verdictStaged(stagedSlot);
    if (lane !== null && lane.folded && stagedScreen && !uninit) {
      ROW && setRow(rowBase + "D7'");
      carry(flushTransaction, seatLane);
      return SLOT_C | MARK_ST;
    }
    ROW &&
      setRow(
        (c as any)._type === EFFECT_RENDER && (leaf || vReader)
          ? "L1"
          : lane !== null
            ? rowBase + "D7"
            : rowBase + "D1"
      );
    return stagedSlot | stagedServe;
  }

  // A flight, not held.
  if (pending && !(staged && late && !uninit)) {
    // D-37: not the lane's own, the pass has a value — and so does the
    // node (a first load in flight has no screen: NR, F-2).
    if (inSeat && !cUninit && !uninit) return (ROW && setRow(rowBase + "D8"), screen);
    if (vReader && !uninit) {
      if (cfg & CONFIG_INPUTS_PUBLISHED) {
        ROW && setRow("V4'");
        carry(flushTransaction, seatLane);
        return SLOT_NR | nrLink;
      }
      // D-23 D-9: the screen; in a flush the pass is the hold's verdict
      // reader and a stale reader of the flight (`observeFlight`: the
      // flush's hold opens if none has, and the flight nobody holds is
      // queued for the seam).
      ROW && setRow("V4");
      if (globalQueue._running) {
        carry(flushTransaction, seatLane);
        return screen | MARK_ST | MARK_AH | MARK_JF0 | MARK_OBS;
      }
      return screen;
    }
  }
  return plainRows(c, el, tracked, spectate);
}

/** The lane engine's bits of a raise (seat.ts LANE_BITS), applied to the
 * reader `c` (core.ts `applyMarks`): D-28's leave; the stale reader of the
 * lane (`_reruns`, once per pass — the pass may also be a stale reader of a
 * transaction, REACTIVE_FRAME_READ: both reruns apply); the verdict reader
 * that entered before the seam (#4284); the lane read for `recompute`'s
 * tail; the move into `lane` — the running pass is `lane`'s, or, already
 * another lane's, the frame it computes derives from both guesses and
 * cannot show one without the other (#3335, A15 for lanes): the two lanes
 * are linked — one reveal unit, each blocked while any is — while their
 * lifetimes stay their own (#2912: a guess reverts with its own action,
 * not with the one it shares a reader with). A nested lane reading through
 * an ancestor's guess stays its own (the screen plus its own guesses). */
function laneApply(c: Computed<any>, r: number, lane: Transaction | null): void {
  if (r & MARK_LEAVE) setPassLane(null);
  if (r & MARK_LST && !(c._flags & REACTIVE_SCREEN_READ)) {
    c._flags |= REACTIVE_FRAME_READ | REACTIVE_SCREEN_READ;
    lane!._reruns.push(c);
  }
  if (r & MARK_ENTERED) entered.push(c);
  if (r & MARK_LANE_READ) c._flags |= REACTIVE_LANE_READ;
  if (r & (RAISE_LANE | RAISE_VSEAT)) {
    const p = passLane,
      l = lane!;
    if (p === null || sameLane(p, l)) setPassLane(l);
    else if (!under(p, l)) {
      if (!under(l, p)) linkLanes(p, l);
      setPassLane(l);
    }
  }
}

/** The lane slots served (seat.ts): the lane's latest value (Lv), what the
 * screen shows for the node (Dv), the truth (T, `until`), a folded lane's
 * hold-world value (D-34). */
export function laneServe(el: Signal<any> | Computed<any>, s: number): unknown {
  switch (s) {
    case SLOT_LV:
      return laneValueOf(el);
    case SLOT_DV:
      return display(el);
    case SLOT_T:
      return GlobalQueue._truth!(el);
  }
  return txOf(el).folded!(null, el);
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
  if (reruns(l)) revealing.push(resolveTx(l._parent!));
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
  // A revert landing (#4336): the guesses its lane took from another action
  // come back in this frame (the optimistic layer, lanes.ts `revertLanding`).
  if (revertLandingHook !== null) revertLandingHook(u);
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
    if (blocked(l) || (guessFlightsHook !== null && guessFlightsHook(l))) return true;
  }
  return false;
}

/** A write landing on a lane's node (core.ts `setSignal`: a user's write, an
 * async landing). On a guess it is its truth (A18 — an async guess's own
 * landing), judged against the guess (the optimistic layer, lanes.ts
 * `guessWrite`). On a derivation it is the lane's latest: its staging once
 * the lane has shown (promoted at the next reveal), its slot before; the
 * lane's members re-derive as its work. */
function laneWrite<T>(el: Signal<T> | Computed<T>, v: T): T {
  if (el._config & CONFIG_GUESS && guessWriteHook!(el, v)) return v;
  const l = txOf(el);
  if (el._equals && el._equals(laneValueOf(el) as T, v)) return v;
  if (l._shown) el._pendingValue = v;
  else el._x!._lane = v;
  if ((el as any)._fn !== undefined) (el as Computed<T>)._time = clock;
  insertSubs(el);
  laneDirty(el, l);
  schedule();
  return v;
}

/** The lanes alive before this seam's guesses opened theirs (a prefix of
 * `lanes`; nothing dissolves one between here and the seam loop): a lane
 * born at the seam has no work to judge yet (its passes run next round) —
 * it is neither shown nor blocked until it has. Set by the optimistic
 * layer at the seam (lanes.ts `applyGuessesAt`); a verdict lane is judged
 * whenever born (`laneSeams`). */
let judged = 0;
export function markJudged(): void {
  judged = lanes.length;
}
/** `t` is parked by `r`'s pass alone: each node keeping it — `t`'s own, or
 * a lane's under it — is `r` itself (its flight, in the verdict lane) or a
 * render effect pending on `r` only: the frame observing the lane work that
 * read its staging. Anything else (an open action, a guess's flight,
 * another flight) holds it on its own. */
function heldBy(t: Transaction, r: Computed<any>): boolean {
  if (t._open !== 0 || (t._lane && linkBlocked(t))) return false;
  for (let k = -1, u = t; u; u = lanes[++k])
    if (u === t || resolveTx(u._parent!) === t) {
      if (u !== t && guessFlightsHook !== null && guessFlightsHook(u)) return false;
      for (let i = 0; i < u._nodes.length; i++) {
        const n = u._nodes[i] as Computed<any>;
        if (
          n === r ||
          !(n._statusFlags & STATUS_PENDING) ||
          (n._x!._transaction !== null && txOf(n) !== u)
        )
          continue;
        const s = n._x!._pendingSources;
        if ((n as any)._type !== EFFECT_RENDER || s?.size !== 1 || !s.has(r)) return false;
      }
    }
  return true;
}
const laneSeams = (t: Transaction | null): void => {
  // Passes that read a write the parked frame holds as the screen
  // (`stagedReaders`: lane work, a verdict reader before the verdict): they
  // re-derive on the committed world next round (and register as stale
  // readers of the transaction there); a lane's runs wait that round — a
  // lane sees the screen plus its own guesses.
  if (revealing.length) revealing.length = 0;
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
      // a landing that reached a frame held elsewhere joined that one). Nor
      // when only this pass keeps it parked (`heldBy`): the frame lands with
      // the pass's answer, so what the pass read is the screen when anything
      // shows it — re-derived on the committed world, it would ask a question
      // already asked, over inputs the landing replaces. A reader a
      // transaction holds that read none of its stagings (a verdict reader
      // that probed only a flight, held as the frame's pending observer or
      // its staged derivation) has nothing to re-derive: its re-run
      // re-enters that transaction and parks it again, every round — it
      // runs at the landing (#4349). One that read a staging re-derives only
      // if its frame stays parked: landing at this seam, what it read is the
      // screen (one run, D-22). Not one born into that frame (a held pass's
      // child, ruling A): it has no screen, its reads are the transaction's
      // either way — it runs again at the landing, not now.
      if (
        r._flags & REACTIVE_DISPOSED ||
        (l?._lane
          ? l._parent?._verdict === l &&
            (r._config & CONFIG_VERDICT
              ? !(r._flags & REACTIVE_PROBE_UNANSWERED)
              : !blocked(t!) || heldBy(t!, r))
          : l &&
            !(
              r._flags & REACTIVE_PROBE_UNANSWERED ||
              (r._flags & REACTIVE_STAGED_READ && blocked(l) && !bornInto(r, l))
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
        if (isThenable(r._x?._inFlight)) {
          if (!blocked(t!)) continue;
          r._x!._parked = r._x!._inFlight;
        } else if (blocked(t!))
          // A sync reader's lane pass re-derives the async memos over it (a
          // memo over a verdict memo is a verdict reader, D-25 #4050; D-22:
          // `latest()` extracted into a memo reads as inline). The flight
          // each asked over its frame staging, up and held by `t`, is the
          // frame's answer too: the landing adopts it (F-9).
          for (let s = r._subs, n; s; s = s._nextSub)
            if (
              isThenable((n = s._sub)._x?._inFlight) &&
              n._x!._pendingSources?.has(n) &&
              n._config & CONFIG_HELD &&
              txOf(n) === t
            )
              n._x!._parked = n._x!._inFlight;
        if (t?._verdict && leaked.indexOf(t._verdict) === -1) leaked.push(t._verdict);
      }
      enqueueSub(r);
      if (l?._lane && leaked.indexOf(l) === -1) leaked.push(l);
    }
  // A verdict lane born at this seam is judged with it: it exists only once
  // a pass routed into it — the park seam's zombie verdict readers re-run
  // as its work so that this seam reveals them (#3444).
  for (let k = lanes.length - 1; k >= 0; k--)
    if (k < judged || lanes[k]._parent?._verdict === lanes[k])
      laneSeam(lanes[k], leaked.indexOf(lanes[k]) !== -1);
  // A verdict reader that entered a lane this seam held: its run waits with
  // the lane, and the verdict beside it would freeze — it re-derives next
  // round from the frame's seat, a stale reader of the lane (#4284).
  for (let r; (r = entered.pop()); )
    if (r._x!._transaction?._held) {
      r._flags &= ~REACTIVE_LANE_DIRTY;
      enqueueSub(r);
    }
};
/** The landing's re-derive of a reader whose frame flight the seam parked
 * (R5): the flight asked the question the landing would — adopted, it is
 * asked once (F-9). Not over a pass already queued: that one asks anew.
 * Registered as if this pass had returned it — the node pending on it, its
 * landing the answer — through a promise of its own: the frame pass's
 * registration still listens to the flight, and must not land it a second
 * time. */
const adoptParked = (r: Computed<any>): boolean => {
  const parked = r._x?._parked;
  if (!parked || r._flags & (REACTIVE_DIRTY | REACTIVE_CHECK | REACTIVE_IN_HEAP)) return false;
  r._x!._parked = undefined;
  releaseFlightTeardown(r);
  try {
    handleAsync(r, parked.then());
  } catch {}
  r._x!._blocked = true;
  notifyStatus(r, STATUS_PENDING, new NotReadyError(r));
  return true;
};
/** D-2's one re-derive, in place (#4417; core.ts `recompute`): a verdict
 * reader whose provisional pass read a staging of a flush that parked has
 * re-derived the value it staged, seated in the hold's verdict lane `l`.
 * The readers that derived from that staging — held with the frame at the
 * park (`holdNode`, `holdFrame`), their stagings and frames intact — are
 * the lane's from here: the lane reveals the provisional frame at its seam
 * (`laneSeam` promotes the staging, applies the frame) instead of re-running
 * them, so a keyed Show mounts once. The frame each built is the lane's
 * with it (ruling A), as a lane pass's children are (`laneStage`). Not a
 * reader that also derived from another held write or another lane's
 * value: lane work sees the screen of it (D-37), so its value is the
 * lane's to re-derive — it re-runs as today, as does every leaf (its run
 * is the lane's; the one the park stashed with `t` is the frame's) and
 * every reader with nothing staged. The notify is `insertSubs` +
 * `laneDirty`'s, the adopted taken back out of the heap. `value`: the
 * re-derived value — the lane's, as a changed one would be (`recompute`'s
 * lane arm; `laneStage` seated the staging there meanwhile). */
function adoptReaders(el: Computed<any>, l: Transaction, t: Transaction, value: unknown): void {
  if (l._shown) el._pendingValue = value;
  else el._x!._lane = value;
  adoptSubs(el, l, t);
}
/** The readers of `el` held by `t` that derived from its staging alone are
 * the lane's with their frames, recursively (`adoptReaders`). */
function adoptSubs(el: Computed<any>, l: Transaction, t: Transaction): void {
  insertSubs(el);
  laneDirty(el, l);
  for (let s = el._subs; s !== null; s = s._nextSub) {
    const r = s._sub,
      x = r._x;
    if (
      (r as any)._type ||
      x === null ||
      (r._config & (CONFIG_HELD | CONFIG_OVERRIDE)) !== CONFIG_HELD ||
      r._flags & REACTIVE_DISPOSED ||
      r._statusFlags & STATUS_PENDING ||
      txOf(r) !== t ||
      (r._pendingValue === NOT_PENDING &&
        x._pendingFirstChild === null &&
        x._pendingDisposal === null) ||
      !onlyFrom(r, el, l)
    )
      continue;
    deleteFromHeap(r, dirtyQueue);
    r._flags &= ~(REACTIVE_DIRTY | REACTIVE_CHECK | REACTIVE_LANE_DIRTY);
    r._config = (r._config & ~(CONFIG_HELD | CONFIG_HELD_FRAME)) | CONFIG_OVERRIDE;
    list(r, l);
    // Its staging is the lane's value — now, as a lane pass's is (`recompute`
    // writes `_x._lane` under a lane not yet shown), or at the seam of a
    // shown lane, which promotes it with the frame (reveal-together, D-23).
    // A lane node never carries a staging the seam is not about to take:
    // `latest()` and a later lane pass over it would read the staging over
    // the lane's value.
    if (!l._shown && r._pendingValue !== NOT_PENDING) {
      x._lane = r._pendingValue;
      r._pendingValue = NOT_PENDING;
    }
    adoptFrame(r, el, l);
    adoptSubs(r, l, t);
  }
}
/** Every source of `r` is `el`, the lane's, or neither held nor staged. */
function onlyFrom(r: Computed<any>, el: Computed<any>, l: Transaction): boolean {
  for (let d = r._deps; d !== null; d = d._nextDep) {
    const n = d._dep;
    if (n === el || n._x?._transaction === l) continue;
    if (n._config & (CONFIG_HELD | CONFIG_OVERRIDE) || n._pendingValue !== NOT_PENDING)
      return false;
  }
  return true;
}
/** The frame an adopted reader built is the lane's (`holdFrame`, the other
 * way): each computed in it is listed on the lane — a derivation as a lane
 * node carrying its value (as `laneStage` lists a lane pass's first pass),
 * a leaf re-run as the lane's work (its stashed run is the frame's). Not a
 * leaf left pending: its wait is the frame's, as a lane pass's pending leaf
 * is (`laneStage`'s leaf arm, `queuePendingNode`) — the hold waits on it,
 * the lane does not. */
function adoptFrame(owner: Owner, el: Computed<any>, l: Transaction): void {
  for (let c = owner._firstChild; c !== null; c = c._nextSibling) {
    const n = c as Computed<any>;
    if (n._x?._transaction?._lane) continue;
    if (n._fn !== undefined) {
      if ((n as any)._type) {
        if (n._statusFlags & STATUS_PENDING) {
          adoptFrame(c, el, l);
          continue;
        }
        n._config &= ~(CONFIG_HELD | CONFIG_HELD_FRAME);
        n._flags |= REACTIVE_LANE_DIRTY;
        enqueueSub(n);
      } else {
        n._config &= ~(CONFIG_HELD | CONFIG_HELD_FRAME);
        n._config |= CONFIG_OVERRIDE;
        if (!onlyFrom(n, el, l)) {
          // Derived from a held write or another lane's value in the hold's
          // world: the lane's to re-derive (D-37), as lane work.
          n._flags |= REACTIVE_LANE_DIRTY;
          enqueueSub(n);
        } else if (
          n._pendingValue === NOT_PENDING &&
          !(n._statusFlags & (STATUS_PENDING | STATUS_UNINITIALIZED))
        )
          ext(n)._lane = n._value;
      }
      list(n, l);
    }
    adoptFrame(c, el, l);
  }
}
/** Render effects that read a verdict and entered a lane before its seam (#4284). */
const entered: Computed<any>[] = [];
installLaneHooks(
  seatRows,
  applyMarks,
  laneApply,
  laneServe,
  laneStage,
  laneWrite,
  laneSeams,
  endLanes,
  lanesBlocked,
  adoptParked,
  adoptReaders
);
if (__OBSERVE__) GlobalQueue._verdictLane = verdictLane;
