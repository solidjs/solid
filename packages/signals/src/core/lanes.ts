// Lanes (step 4; maintainer rulings 2026-10-01). A lane is "a new base of a
// transition": the sub-frame an optimistic write opens in the transition of
// the frame it is made in. It sees the screen plus its own guesses (§19),
// breaks out of the parent's hold — its effects run now — and holds itself
// if its own derivations hit async (and, blocked, holds its parent). It ends
// when the parent lands: a guess reverts to the base it covered, or lands as
// the truth that superseded it. A frame that does not park has nothing to be
// optimistic over: the write is void.
//
// Membership is the pass's, not the flush's: a tracked read of displayed
// optimism (CONFIG_OVERRIDE) makes the reading pass lane work (`passLane`,
// scheduler.ts) — its staging goes to the lane, its effects to the lane's
// queues — while the rest of the frame is the flush's.
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
  CONFIG_HELD_TRUTH,
  CONFIG_LANE_HELD,
  CONFIG_OVERRIDE,
  EFFECT_RENDER,
  NOT_PENDING,
  REACTIVE_FRAME_READ,
  STATUS_PENDING,
  STATUS_UNINITIALIZED
} from "./constants.js";
import { ext, tracking } from "./core.js";
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
function newLane(parent: Transaction): Transaction {
  const l = newTransaction(true, parent);
  lanes.push(l);
  return l;
}

/** Guesses written since the last seam (`[node, value, question, …]`).
 * Applied at the seam, once the frame's verdict is known — the parent is
 * the frame's transaction, and there is none to be optimistic over when the
 * frame commits (the write is as if it never happened: nothing was
 * applied). The lane's passes run in the next round of the same flush, so
 * the guess is visible at flush like any write (A28). */
const pendingGuesses: any[] = [];
export function optimisticWrite<T>(n: Signal<T> | Computed<T>, v: T | ((prev: T) => T)): T {
  // What the user sees: an unflushed guess to the same node, else the
  // displayed value (a blocked lane's guess is its staging — what a direct
  // read serves). The updater composes on it; guessing it again is no guess
  // (the node's comparator, as for any write) — unless the node already
  // carries one: the user re-asked, and the re-ask renews the guess's
  // question and entangles its frame (#3347) without notifying anyone.
  let prev: T = n._config & CONFIG_LANE_HELD ? (n._pendingValue as T) : n._value;
  for (let i = pendingGuesses.length - 3; i >= 0; i -= 3)
    if (pendingGuesses[i] === n) {
      prev = pendingGuesses[i + 1];
      break;
    }
  if (typeof v === "function") v = (v as (prev: T) => T)(prev);
  if (n._equals && n._equals(prev, v) && !(n._config & CONFIG_GUESS)) return v;
  pendingGuesses.push(n, v, question || nextQuestion());
  schedule();
  return v;
}
/** The seam: each guess becomes the displayed value of its node, in a lane —
 * the node's own if it carries one (a later write into the same lane), else
 * a new one under `parent` (the frame's transaction), under the hold already
 * on the node (a guess over that transition's world, whatever the frame
 * did), or under a transaction opened for the node's own in-flight refetch
 * (the guess is that flight's observer — A17, "visible until its own fetch
 * settles"). No parent: the guess is dropped. The base the guess covers —
 * the committed value, or the truth already staged — stays in
 * `_pendingValue`; its readers are dirtied for the next round. */
function applyGuesses(parent: Transaction | null): void {
  let lane: Transaction | null = null;
  for (let i = 0; i < pendingGuesses.length; i += 3) {
    const n = pendingGuesses[i] as Signal<any>;
    const v = pendingGuesses[i + 1];
    let changed = true;
    if (n._config & (CONFIG_OVERRIDE | CONFIG_LANE_HELD)) {
      // A second guess for a slot another frame's lane already guesses: two
      // suggestions for one slot cannot finish apart (A34 (1)) — the frames
      // entangle, and the guess stays the lane's (in the display, or in the
      // staging while the lane is blocked). The same value re-asked renews
      // the question and entangles; nothing to notify.
      changed = !n._equals || !n._equals(guessOf(n), v);
      const l = txOf(n);
      if (n._config & CONFIG_LANE_HELD) n._pendingValue = v;
      else n._value = v;
      const holder = l._parent;
      if (parent !== null && holder !== null) merge(parent, holder);
    } else {
      let l: Transaction;
      if (n._config & CONFIG_HELD) l = newLane(txOf(n));
      else {
        if (parent === null && (n as Computed<any>)._statusFlags & STATUS_PENDING)
          parent = newTransaction(false);
        if (parent === null) continue;
        l = lane ??= newLane(parent);
      }
      // The base the guess covers: the committed value, or a truth already
      // staged for the commit (CONFIG_HELD_TRUTH: `isPending` says it
      // differs, A24).
      if (n._pendingValue === NOT_PENDING) n._pendingValue = n._value;
      else n._config |= CONFIG_HELD_TRUTH;
      n._value = v;
      n._config |= CONFIG_OVERRIDE | CONFIG_GUESS | CONFIG_HELD;
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
/** The running pass reads lane `l`'s work: it is `l`'s — or, already another
 * lane's, the frame it computes derives from both guesses and cannot show
 * one without the other (#3335, A15 for lanes): the two lanes are linked —
 * one reveal unit, each blocked while any is — while their lifetimes stay
 * their own (#2912: a guess reverts with its own action, not with the one
 * it shares a reader with). A nested lane reading through an ancestor's
 * guess stays its own (the screen plus its own guesses). */
function enterLane(l: Transaction): void {
  const p = passLane;
  if (p === null || sameLane(p, l)) return setPassLane(l);
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
/** A linked lane blocked on its own account blocks the group. */
function linkBlocked(l: Transaction): boolean {
  const g = l._links;
  if (g !== null)
    for (let i = 0; i < g.length; i++) {
      const k = g[i];
      if (k !== l && (ownFlights(k) || guessFlights(k) || nestedBlocked(k))) return true;
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
 * it. Simpler than a user's lane: no write, no correction (the landing
 * flips `isPending` and confirms `latest`), nothing of its own to stage. */
export function verdictLane(t: Transaction): Transaction {
  return (t._verdict ??= newLane(t));
}

/** A lane pass's staging: the lane's to reveal, and displayed optimism to
 * its readers from now (a reader in the same round becomes lane work and
 * sees the staged value). */
export function laneStage(el: Computed<any>, l: Transaction): void {
  if (!(el as any)._type) el._config |= CONFIG_OVERRIDE;
  list(el, l);
}

/** The truth arrived for a node carrying optimism (A18): it stages under the
 * lane's parent — committed at that landing — and the optimism is gone from
 * the graph; the display keeps the guess until then (the parent's hold).
 * Only a correction notifies: an equal truth confirms silently. A guess that
 * never showed (its lane blocked) corrected is void with its lane's frame:
 * what the lane held is the parent's now, re-derived from the truth by the
 * notification, its runs the parent's. A confirmation leaves the lane to
 * its own flight. */
export function supersede(
  n: Signal<any> | Computed<any>,
  value: unknown,
  changed: boolean,
  join = true
): void {
  const l = txOf(n);
  const parent = l._parent ?? l;
  if (n._config & CONFIG_LANE_HELD) {
    if (changed) dissolveLane(l, parent, n);
    // A confirmed guess in a blocked lane stays displayed-ahead for direct
    // reads, as the guess was (the base it covered is moot: nothing can
    // revert to it now).
    else n._value = value;
  }
  n._config &= ~(
    CONFIG_OVERRIDE |
    CONFIG_GUESS |
    CONFIG_HELD |
    CONFIG_LANE_HELD |
    CONFIG_HELD_TRUTH
  );
  n._pendingValue = value;
  holdNode(n, parent);
  // (At the seam — a body-end supersession — the flush's join is spent: the
  // re-derivations join the parent through the held node they read.)
  if (join) joinFuture(parent);
  if (changed) {
    if (n._subs !== null) insertSubs(n);
  } else
    // A confirmation is silent for the guess's subscribers (A17) — not for
    // a reader of the truth (CONFIG_AUTHORITATIVE): its view just changed.
    for (let s = n._subs; s !== null; s = s._nextSub)
      if (s._sub._config & CONFIG_AUTHORITATIVE) enqueueSub(s._sub);
}

/** A lane's end, three ways. `into === null`: the parent landed and the
 * lane's frame was shown — each guess lands the truth staged over it or
 * reverts to the base it covered (one commit; the display changing
 * notifies), its derivations stop being optimism. Otherwise the lane never
 * showed: its guesses revert (nothing to notify but their derivations,
 * which re-derive from the base), and what it holds is `into`'s — the
 * parent's, after a correction (the staging re-homed, the runs moved); the
 * lane's own, when it outlives its parent and continues as a transaction. */
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
    if (n === except || n._x!._transaction !== l) continue;
    if (n._config & CONFIG_GUESS) {
      const shown = n._value;
      const heldTruth = n._config & CONFIG_HELD_TRUTH;
      n._config &= ~(CONFIG_OVERRIDE | CONFIG_GUESS | CONFIG_LANE_HELD | CONFIG_HELD_TRUTH);
      if (into === null) commitPendingNode(n);
      else if (heldTruth) {
        // The base is a truth held for the commit: the parent's to land.
        list(n, into);
        insertSubs(n);
        continue;
      } else {
        n._pendingValue = NOT_PENDING;
        n._config &= ~CONFIG_HELD;
      }
      n._x!._transaction = null;
      if (into !== null || n._value !== shown) insertSubs(n);
    } else {
      n._config &= ~(CONFIG_OVERRIDE | CONFIG_LANE_HELD);
      if (into !== null && n._config & CONFIG_HELD) list(n, into);
      else n._x!._transaction = null;
    }
  }
  if (into !== null && into !== l)
    for (let i = 0; i < 2; i++) for (const fn of l._queues[i]) into._queues[i].push(fn);
}

/** Lanes. Displayed optimism (CONFIG_OVERRIDE) is the value for every
 * reader (A17: "direct read shows optimistic"); a tracked read of it makes
 * the reading pass lane work, and lane work is served the lane's staging of
 * this round where there is one. A blocked lane's staging (CONFIG_LANE_HELD)
 * is the lane's own pending value: direct reads and lane work see it, a
 * tracked derivation becomes lane work, a render effect outside the lane's
 * flush is a stale reader — the committed value, re-derived at the reveal
 * (#3460). Children-forbidden readers see the frame (A32). Returns
 * NOT_PENDING to fall through: the lane work's read of a pending node
 * throws like any member's. */
export function laneRead(
  c: Computed<any> | null,
  el: Signal<any> | Computed<any>,
  plain = false
): unknown {
  // An authoritative reader (`until`) sees past the guess to the base it
  // covers — `_pendingValue` for a displayed guess, `_value` once a blocked
  // lane swapped them — and is no lane's.
  if (c !== null && c._config & CONFIG_AUTHORITATIVE)
    return (el._config & (CONFIG_GUESS | CONFIG_LANE_HELD)) === CONFIG_GUESS
      ? el._pendingValue
      : el._value;
  const l = txOf(el);
  const tracked = c !== null && tracking && !(c._config & CONFIG_CHILDREN_FORBIDDEN);
  if (!(el._config & CONFIG_LANE_HELD)) {
    if (!tracked) return el._value;
    enterLane(l);
    // A guess is the value (A17) — in flight (its own truth pending) all the
    // same; its pending slot is the base it covers, not lane staging. A
    // lane's derivation: this round's staging to lane work, pending like
    // any node while in flight.
    if (el._config & CONFIG_GUESS) return el._value;
    if ((el as Computed<any>)._statusFlags & STATUS_PENDING) return NOT_PENDING;
    return el._pendingValue !== NOT_PENDING ? el._pendingValue : el._value;
  }
  if (!tracked)
    return c === null && el._pendingValue !== NOT_PENDING ? el._pendingValue : el._value;
  // A render effect re-run outside the lane's flush is a stale reader
  // (#3460): the write that re-ran it publishes now, with the committed
  // view; the lane's re-derivation of it comes at the reveal. (The lane's
  // own re-guess does not re-run its member effects — `restage`.)
  if (
    (c as any)._type === EFFECT_RENDER &&
    (passLane === null || !sameLane(passLane, l)) &&
    flushTransaction !== l
  ) {
    if (!(c!._flags & REACTIVE_FRAME_READ)) {
      c!._flags |= REACTIVE_FRAME_READ;
      l._reruns.push(c!);
    }
    return el._value;
  }
  // Lane work: a plain read is served the lane's own staging here (not as a
  // staged read of the frame's — the seam does not decide it); in flight it
  // falls through and throws like any member's read of a pending node. A
  // verdict read falls through to the verdict's held arm.
  enterLane(l);
  if (!plain || (el as Computed<any>)._statusFlags & STATUS_PENDING) return NOT_PENDING;
  return el._pendingValue !== NOT_PENDING ? el._pendingValue : el._value;
}

/** The guess a node displays (its staging while its lane is blocked); the
 * other slot is the base it covers. */
function guessOf(el: Signal<any> | Computed<any>): unknown {
  return el._config & CONFIG_LANE_HELD ? el._pendingValue : el._value;
}

/** A guess in `l` whose own truth is in flight (its refetch — authoritative:
 * the landing supersedes, not the body's end). */
function guessFlights(l: Transaction): boolean {
  for (let i = 0; i < l._nodes.length; i++) {
    const n = l._nodes[i] as Computed<any>;
    if (n._config & CONFIG_GUESS && n._x!._transaction === l && n._statusFlags & STATUS_PENDING)
      return true;
  }
  return false;
}

/** The seam's verdict on a lane. Blocked — its own flight is up — the frame
 * waits: a displayed guess leaves the display (the base returns to
 * `_value`, the guess becomes the staging) and the lane's staged work is
 * held with lane semantics; nothing already revealed moves. Unblocked, the
 * frame shows: a held guess returns to the display, this round's staged
 * work commits as displayed optimism (`commitPendingNode` retires the
 * parked children and queues born-held runs — into the lane's queues, which
 * then run ahead of the frame's own), a stale reader of the held lane
 * re-derives (#3460). Revealed nodes stay listed for the lane's end. */
function laneSeam(l: Transaction): void {
  // A18 body-end corollary (#3427): the action body having returned, a
  // guess whose own truth is not in flight has no answer coming — the base
  // it covers is its truth, and the correction starts now rather than at
  // the lane's flight: the lane's never-shown frame is void, its
  // derivations re-ask from the truth under the parent, one frame at the
  // landing. (A guess whose own refetch is up is superseded by its landing.)
  const p = resolveTx(l._parent!);
  if (p._acted && p._open === 0 && !p._lane && !ownFlights(p) && !guessFlights(l)) {
    for (let i = 0; i < l._nodes.length; i++) {
      const n = l._nodes[i] as Computed<any>;
      if (n._config & CONFIG_GUESS && n._x!._transaction === l) {
        const base = n._config & CONFIG_LANE_HELD ? n._value : n._pendingValue;
        supersede(n, base, !n._equals || !n._equals(guessOf(n), base), false);
      }
    }
    // (Open: when the parent is otherwise free it lands at this very seam,
    // and the correction's re-derivations next round are mainline flights
    // rather than the parent's — #3409 pins them clearing together.)
    if (lanes.indexOf(l) === -1) return;
  }
  const park = blocked(l);
  if (!park) reruns(l);
  const prev = passLane;
  setPassLane(l);
  for (let i = 0; i < l._nodes.length; i++) {
    const n = l._nodes[i];
    if (n._x!._transaction !== l) continue;
    if (n._config & CONFIG_GUESS) {
      if (park ? !(n._config & CONFIG_OVERRIDE) : !(n._config & CONFIG_LANE_HELD)) continue;
      const v = n._value;
      n._value = n._pendingValue;
      n._pendingValue = v;
      n._config ^= CONFIG_OVERRIDE | CONFIG_LANE_HELD;
    } else if (park) {
      if (n._pendingValue !== NOT_PENDING || (n as Computed<any>)._statusFlags & STATUS_PENDING)
        n._config = (n._config & ~CONFIG_OVERRIDE) | CONFIG_HELD | CONFIG_LANE_HELD;
    } else {
      if (
        n._pendingValue !== NOT_PENDING ||
        n._x!._pendingFirstChild !== null ||
        n._x!._pendingDisposal !== null ||
        (n as Computed<any>)._statusFlags & STATUS_UNINITIALIZED
      )
        commitPendingNode(n);
      // A node held with nothing to commit (pending by propagation, since
      // settled) is simply the lane's again.
      n._config &= ~(CONFIG_HELD | CONFIG_LANE_HELD);
      if (!(n as any)._type) n._config |= CONFIG_OVERRIDE;
      n._x!._transaction = l;
    }
  }
  setPassLane(prev);
  if (!park) releaseQueues(l);
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
    if (blocked(l)) return true;
    for (let j = 0; j < l._nodes.length; j++) {
      const n = l._nodes[j] as Computed<any>;
      if (n._config & CONFIG_GUESS && n._statusFlags & STATUS_PENDING && txOf(n) === l) return true;
    }
  }
  return false;
}

/** A plain write landing on a guess is its truth (A18 — an async guess's own
 * landing), judged against the guess, not the base its pending slot covers. */
function guessWrite<T>(el: Signal<T> | Computed<T>, v: T): T {
  supersede(el, v, !el._equals || !el._equals(guessOf(el) as T, v));
  schedule();
  return v;
}

/** A node whose pass is not lane work but which carries optimism: its own
 * source recomputed it — the truth (A18: "the source is whatever recomputes
 * the node"). A guess stages under the lane's parent whether or not it
 * changed (a confirm is a landing too — the lane's end commits it), clears
 * the optimism, and notifies only a correction: an equal truth re-runs
 * nothing (returns true: handled). A derivation (or effect) that stopped
 * reading the lane's world has simply left it (returns false: the plain
 * tail stages its value). An errored pass stages nothing either way. */
function laneOutcome(el: Computed<any>, value: unknown, errored: boolean): boolean {
  if (!(el._config & CONFIG_GUESS)) {
    el._config &= ~(CONFIG_OVERRIDE | CONFIG_HELD | CONFIG_LANE_HELD);
    el._x!._transaction = null;
    return false;
  }
  if (errored) return true;
  // Provenance (A18, #3331): "the source" is the guess's own question or a
  // newer one. An older action's answer landing over a newer guess (the two
  // entangled when the newer guess was written) is stale — a slow source
  // leaking back in over the user's latest intent. It is staged as the base
  // the guess covers, for the commit like any landing, and nothing moves:
  // no downstream re-ask, no pending flip on the guess's readers (`isPending`
  // of the guess itself says the held truth differs, A24). The guess's own
  // question answering supersedes as usual.
  if (!(el._config & CONFIG_LANE_HELD) && staleAnswer(el)) {
    el._pendingValue = value;
    el._config |= CONFIG_HELD_TRUTH;
    return true;
  }
  supersede(el, value, !el._equals || !el._equals(guessOf(el), value));
  return true;
}

/** The question this pass answered: the newest among the stamped sources
 * that changed this round (a flight's landing carries the question that
 * started it). Stale when older than the guess's; an unstamped source (a
 * plain write) and mainline are current. */
function staleAnswer(el: Computed<any>): boolean {
  let q = 0;
  for (let l = el._deps; l !== null; l = l._nextDep) {
    const d = l._dep as Computed<any>;
    if (d._x !== null && d._x._q > q && d._time === clock) q = d._x._q;
  }
  return q !== 0 && q < el._x!._q;
}

GlobalQueue._laneRead = laneRead;
GlobalQueue._laneStage = laneStage;
GlobalQueue._laneOutcome = laneOutcome;
GlobalQueue._guessWrite = guessWrite;
GlobalQueue._applyGuesses = parent => {
  if (pendingGuesses.length !== 0) applyGuesses(parent);
};
GlobalQueue._laneSeams = () => {
  // Over a snapshot: a body-end supersession dissolves lanes mid-scan.
  const live = lanes.slice();
  for (let k = live.length - 1; k >= 0; k--) if (lanes.indexOf(live[k]) !== -1) laneSeam(live[k]);
};
GlobalQueue._endLanes = endLanes;
GlobalQueue._lanesBlocked = lanesBlocked;
GlobalQueue._verdictLane = verdictLane;
