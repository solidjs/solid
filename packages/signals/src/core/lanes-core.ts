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
// lane read and a lane pass's tail (`laneRead`, `laneStage`), the verdict
// lane (`verdictLane`) — installed on the scheduler's hooks when something
// imports it (verdict.ts for its verdict lanes, or the optimistic layer).
// The guesses — a written guess, its lane opening at the seam, its truth
// arriving, the corrections — are the optimistic layer (lanes.ts), reached
// from here through `installOptimisticHooks` and carried only by a build
// that imports `createOptimistic`. The core keeps only bit tests and
// `passLane`: a program with no optimism and no verdict carries none of
// this.

import {
  CONFIG_AUTHORITATIVE,
  CONFIG_CHILDREN_FORBIDDEN,
  CONFIG_GUESS,
  CONFIG_HELD,
  CONFIG_HELD_FRAME,
  CONFIG_INPUTS_PUBLISHED,
  CONFIG_OVERRIDE,
  CONFIG_STAGED,
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
import { bornInto, creatorReads, ext, stagedRead, tracking } from "./core.js";
import { NotReadyError, type StatusError } from "./error.js";
import {
  handleAsync,
  isThenable,
  notifyStatus,
  releaseFlightTeardown,
  removePendingSource
} from "./async.js";
import { laneValueOf } from "./truth.js";
import { enqueueSub } from "./heap.js";
import {
  blocked,
  clock,
  commitPendingNode,
  flushTransaction,
  GlobalQueue,
  holdNode,
  insertSubs,
  laneDirty,
  list,
  stagedReaders,
  newTransaction,
  ownFlights,
  passLane,
  queuePendingNode,
  releaseQueues,
  reruns,
  resolveTx,
  sameLane,
  schedule,
  setPassLane,
  txOf,
  type Transaction,
  installLaneHooks
} from "./scheduler.js";
import type { Computed, Signal } from "./types.js";

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

/** The running pass read lane `l`'s work as a derivation: it is `l`'s — or,
 * already another lane's, the frame it computes derives from both guesses
 * and cannot show one without the other (#3335, A15 for lanes): the two
 * lanes are linked — one reveal unit, each blocked while any is — while
 * their lifetimes stay their own (#2912: a guess reverts with its own
 * action, not with the one it shares a reader with). A nested lane reading
 * through an ancestor's guess stays its own (the screen plus its own
 * guesses). */
export function enterLane(l: Transaction, c: Computed<any>): void {
  const f = (c._flags |= REACTIVE_LANE_READ),
    p = passLane;
  if (p === null) {
    const verdict = l._parent!._verdict === l;
    // A verdict lane's value (a memo of `latest` / `isPending`, F-6) read by
    // a derivation that already read the frame's staging or joined its
    // hold, or by any pass a pass that did is creating: the verdict read
    // does not break it out — it stays the frame's, as the same read inline
    // does (verdict.ts `markVerdictReader`, `route`; D-25, D-26). An
    // effect's own reads do not count (its `_type`, 1–3, carries neither bit).
    if (!(verdict && creatorReads(c, (c as any)._type || f))) {
      setPassLane(l);
      // The pass read a held write before its first lane read (it joined the
      // frame's future as mainline would): lane work sees the screen — the
      // seam re-derives it on the committed world next round (`stagedReaders`,
      // the park's repair), as it does a lane pass that read a staging. Not a
      // pass whose held reads were all of nodes born held (no staged read,
      // `stagedRead`): it has no committed world to re-derive on (#3969).
      // (A pass not joined: a held write beside a guess, #4336; a leaf of a
      // verdict lane — its plain reads are the screen's, D-26 `[s(), L()]`.)
      // (Every lane that is not a verdict lane is a guess's — the optimistic
      // layer opened it — so the read's old `guessed || verdict || joined`
      // disjunction was always true; only the staged read decides.)
      if (f & REACTIVE_STAGED_READ) stagedRead(c);
    }
  } else if (sameLane(p, l)) setPassLane(l);
  else if (!under(p, l)) {
    if (!under(l, p)) linkLanes(p, l);
    setPassLane(l);
  }
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
    if (v !== NOT_PENDING) return v;
  }
  if (c !== null && c._config & CONFIG_AUTHORITATIVE) return GlobalQueue._truth!(el);
  const status = (el as Computed<any>)._statusFlags;
  // An errored member's lane value predates its error; the error is the answer (#4106).
  if (!guess && status & STATUS_ERROR) return NOT_PENDING;
  if (c === null) return laneValueOf(el);
  const pending = !guess && status & STATUS_PENDING;
  if (!tracking || c._config & CONFIG_CHILDREN_FORBIDDEN) {
    // An untracked read inside lane work derives from the lane like a
    // tracked one, minus the subscription — `untrack` is about
    // dependencies, not about which world a pass derives from (a mapper's
    // row reads under its root, store/map): the pass enters the lane (two
    // lanes read by one pass link, as for tracked reads). Outside lane
    // work, the screen.
    if (passLane === null || c._config & CONFIG_CHILDREN_FORBIDDEN) return display(el);
  } else if ((c as any)._type === EFFECT_RENDER) {
    // A flight whose value has never shown: nothing to show — the leaf
    // waits on it, and its own frame holds (A15, #3334), not the lane's
    // parent. The landing lands the frame: its own pass (the flush joined
    // its transaction) reads the answer it waited on — the lane's staging,
    // revealed at this seam.
    const never = pending && el._x!._lane === NOT_PENDING;
    // D-28: a leaf a verdict read moved into the lane still throws on such
    // a flight — the pass leaves the lane, and its frame holds as if the
    // read had come first (S-39, #4275). Nor does a verdict lane's seat carry
    // the leaf into another lane (no link): it reads that lane as from the
    // frame's seat (#4284).
    if ((never || passLane !== l) && passLane?._parent!._verdict === passLane) setPassLane(null);
    if (passLane === null || !sameLane(passLane, l)) {
      // (A lane that has never shown: the screen is the committed value.)
      if (never && l._shown) return NOT_PENDING;
      if (
        !guess &&
        el._pendingValue !== NOT_PENDING &&
        c._config & CONFIG_HELD &&
        flushTransaction !== null &&
        resolveTx(flushTransaction) === txOf(c)
      )
        return el._pendingValue;
      if (l._held || pending) {
        // Re-derived at the reveal; once per pass (the pass may also be a stale
        // reader of a transaction, REACTIVE_FRAME_READ — both reruns apply).
        // Before the throw below: a leaf that waits on a lane that has never
        // shown has no flight to settle it — only the reveal re-derives it,
        // and its pending holds its frame until then (#4338).
        if (!(c._flags & REACTIVE_SCREEN_READ)) {
          c._flags |= REACTIVE_FRAME_READ | REACTIVE_SCREEN_READ;
          l._reruns.push(c);
        }
        // Nothing on screen yet (uninitialized: `display` is NOT_PENDING).
        const v = display(el);
        if (v === NOT_PENDING) throw new NotReadyError(null);
        return v;
      }
      // A verdict reader reads ahead of the seam's verdict: re-derived on the
      // screen if the lane holds (#4284).
      if (c._config & CONFIG_VERDICT && l._parent!._verdict !== l) entered.push(c);
    }
  }
  enterLane(l, c);
  return pending ? NOT_PENDING : laneValueOf(el);
}

/** The seam's verdict on a lane. Blocked — its own flight is up — nothing
 * moves: the screen keeps what it shows, the lane's runs wait. Unblocked,
 * the lane shows: its values are the screen from now (`_shown`), the
 * staging its passes made since the last reveal is promoted, their frames
 * (children) apply, the stale readers re-derive (#3460), its runs go. */
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
/** A15: lane work or a verdict reader was served `el`'s committed value
 * (core.ts `frameRead`), so its pass does not wait on `el`'s flight: what
 * `el`'s pending propagated onto it before the pass (its origins, `el`
 * included) is not this pass's — the landing re-derives it (`reruns`).
 * Kept, a pass that went pending on another source never woke when that
 * source settled (#4397). Only a reader something made pending has anything
 * to drop. */
const laneServed = (c: Computed<any>, el: Signal<any> | Computed<any>): void => {
  const from = (el as Computed<any>)._x?._pendingSources;
  if (from && c._x?._pendingSources) for (const s of from) removePendingSource(c, s);
};
/** Render effects that read a verdict and entered a lane before its seam (#4284). */
const entered: Computed<any>[] = [];
installLaneHooks(
  laneRead,
  laneStage,
  laneWrite,
  laneSeams,
  endLanes,
  lanesBlocked,
  adoptParked,
  laneServed
);
GlobalQueue._verdictLane = verdictLane;
