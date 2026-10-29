// Verdicts (plan sec. 28 replay, 2026-10-02; maintainer, 2026-10-01: verdicts are
// optimistic state the system supplies). `isPending(fn)` asks whether what
// `fn` reads is final; `latest(fn)` reads the proposal — the staged write or
// landing, the lane's value — instead of the screen. A verdict is a guess
// ("pending, until this lands"; "the proposal is the value") and its readers
// break out of the hold the way a lane's do: work of the holder's verdict
// lane (lanes.ts), shown now, re-derived at the landing, ending with it. A
// verdict reader is a frame reader: its plain reads of held nodes see the
// screen (core.ts `frameRead`), so `[isPending(x), x()]` never pairs the
// fresh value with pending (A10).

import {
  CONFIG_CHILDREN_FORBIDDEN,
  CONFIG_GUESS,
  CONFIG_ASYNC,
  CONFIG_HELD,
  CONFIG_INPUTS_PUBLISHED,
  CONFIG_OVERRIDE,
  CONFIG_PROMOTED,
  CONFIG_STAGED_ERROR,
  CONFIG_VERDICT,
  EFFECT_RENDER,
  NOT_PENDING,
  REACTIVE_DISPOSED,
  REACTIVE_FRAME_READ,
  REACTIVE_JOINED,
  REACTIVE_LANE_READ,
  REACTIVE_PROBED,
  REACTIVE_REASK,
  REACTIVE_PROBE_UNANSWERED,
  REACTIVE_STAGED_READ,
  REACTIVE_WINDOW,
  STATUS_ERROR,
  STATUS_PENDING,
  STATUS_UNINITIALIZED
} from "./constants.js";
import {
  applyMarks,
  context,
  creatorPass,
  prepareComputed,
  pullComputed,
  setVerdict,
  spectating,
  strictRead,
  strictReadActive,
  tracking,
  verdict
} from "./core.js";
import { warnStrictReadUntracked } from "./dev.js";
import { NotReadyError } from "./error.js";
import { link } from "./graph.js";
import { laneServe, verdictLane } from "./lanes.js";
import { enqueueSub } from "./heap.js";
import {
  clock,
  flushTransaction,
  globalQueue,
  GlobalQueue,
  joinFuture,
  passLane,
  queuePendingNode,
  setPassLane,
  txOf,
  type Transaction,
  installVerdictHooks
} from "./scheduler.js";
import {
  MARK_AH,
  MARK_JF0,
  MARK_JFT,
  MARK_LATE,
  MARK_LINK,
  MARK_OBS,
  MARK_PR,
  MARK_ST,
  MARK_UNANS,
  MARK_W,
  RAISE_H,
  RAISE_MASK,
  SLOT_C,
  SLOT_DV,
  SLOT_E,
  SLOT_ESTAGED,
  SLOT_FOLD,
  SLOT_LV,
  SLOT_NR,
  SLOT_P,
  SLOT_MASK,
  SLOT_STASH,
  WINDOW_LATEST,
  WINDOW_PROBE,
  bornInto,
  dispNP,
  laneNP,
  ROW,
  carry,
  setRow,
  readerVhold,
  SEAT_BORN,
  SEAT_BORN_H,
  SEAT_OWN,
  raiseSeatWorld,
  seatWorld,
  shadowActual,
  shadowDecided,
  shadowWindow
} from "./seat.js";
import type { Computed, Signal } from "./types.js";

/** Verdict windows. Inside `latest(fn)` a read of a held node serves the
 * proposal (above the async, the held write; below it, the committed value
 * — nothing newer exists) instead of joining or throwing; inside
 * `isPending(fn)` a read records whether what it saw is final. Either way
 * the reader breaks out: work of the holder's verdict lane, shown now and
 * re-derived at the landing. */
let latestActive = false;
let probing = false;
let probeFound = false;

/** A19 exc. 2 / A24: a flight that re-asks the question already answered
 * (a `refresh()`, a poll) is quiet; a node pending through others is quiet
 * when every flight it waits on is. */
function quietPending(el: Computed<any>): boolean {
  const x = el._x;
  if (!x) return false;
  if (x._pendingSources) {
    for (const source of x._pendingSources) if (!source._x?._reask) return false;
    return true;
  }
  return x._reask;
}

/** `isPending`'s answer for a held node (A19), relative to what the reader
 * sees — a verdict reader is a frame reader and sees the committed value: a
 * flight still up (cause ii) is not final unless quiet; a held write or
 * landing (staged — cause i/iii) is not final unless it answers the question
 * already shown (a quiet re-ask, through its reveal), is the node's first
 * landing (commit #0: loading, not pending), or the probe sits inside a
 * `latest` window, whose view of the node IS the proposal (A10: a reader
 * that observed the fresh value is not told it is pending; inside `latest`,
 * `isPending` asks whether the latest view is final). A member of a held
 * frame with neither is final. A24: pending iff a value change is in
 * flight — a staging equal to what is displayed changes nothing when it
 * lands: final now (maintainer, 2026-10-02). */
function heldNotFinal(owner: Computed<any>): boolean {
  if ((owner._statusFlags & STATUS_PENDING) !== 0 && !quietPending(owner)) return true;
  return (
    owner._pendingValue !== NOT_PENDING &&
    !latestActive &&
    !owner._x!._reask &&
    !(owner._statusFlags & STATUS_UNINITIALIZED) &&
    (!!owner._x!._shownError ||
      !owner._equals ||
      !owner._equals(owner._value as any, owner._pendingValue as any))
  );
}

/** The pass entering a verdict window is a verdict reader (CONFIG_VERDICT):
 * a dependency going pending re-derives it, the verdict having changed. Not
 * an untracked window: that is a snapshot, like any untracked read (#3946 —
 * a router's link claim probing inside the computation that creates the
 * anchor). A throw still reaches the pass through `untrack`. */
function markVerdictReader(window: number): void {
  const c = creatorPass(context);
  if (c && tracking) {
    // A pass run inside passes still running — its creator's, theirs — one
    // of which read the future or a staging (a branch a held or staged
    // condition opened, and whatever that branch creates) has no screen: the
    // branch exists only in that world. It reads that world as any
    // derivation of it does (`bornInto` once held) and stays its pass
    // (`route`); a verdict reader from its next pass. #4341: a memo born in
    // a newly opened <Match> read the screen, where its branch was closed.
    // Not such a pass: a verdict reader now. (The branch's world is the
    // seat's born half — seat.ts `seatWorld`, SEAT_BORN: the world the
    // running pass was born in, its creators' transitively.)
    c._config &= ~CONFIG_ASYNC;
    c._flags |= REACTIVE_PROBED | REACTIVE_WINDOW;
    const born = seatWorld & SEAT_BORN;
    if (born === 0) c._config |= CONFIG_VERDICT;
    else {
      // Its branch's world is its own from here (today: the creators' bits
      // copied onto the pass).
      raiseSeatWorld(born >> 2);
      c._flags |= born & SEAT_BORN_H ? REACTIVE_JOINED : REACTIVE_STAGED_READ;
    }
    if (__TEST__) shadowWindow(c);
    // Observe tier: which windows this pass entered (1 `isPending`, 2
    // `latest`) — the hold census names the affordance (attribution.ts).
    if (__OBSERVE__) (c as any)._devWindows = ((c as any)._devWindows ?? 0) | window;
  }
}

/** The windows. `read` dispatches to `verdictValue` while one is open; each
 * restores the dispatch it found — none inside a memo's pass a window
 * pulled (`verdictValue`). */
export function latest<T>(fn: () => T): T {
  markVerdictReader(2);
  const prev = latestActive,
    prevVerdict = verdict;
  latestActive = true;
  setVerdict(verdictValue);
  try {
    return fn();
  } finally {
    latestActive = prev;
    setVerdict(prevVerdict);
  }
}

/**
 * Reports whether what `fn` reads is still waiting on an update. Read the
 * values in question inside `fn`: the probe answers `true` while any of
 * them depends on a change that is in flight — a write or an async source
 * that has started producing a new value whose result has not landed yet —
 * and `false` once the latest value is the one on screen. The answer is
 * tracked like any read, so a memo or effect that calls `isPending` re-runs
 * when it flips.
 *
 * A read that has no value yet is loading, not pending: inside `fn` it
 * follows the surrounding `Loading` path like any other read, and the probe
 * reports only updates to a value that already exists. A bare `refresh()`
 * does not flip `isPending`; pair it with `affects()` to make the re-ask
 * visible.
 *
 * @param fn expression to probe; read the values in question inside it
 *
 * @returns `true` while a read inside `fn` depends on a change that has not committed yet
 *
 * @example
 * ```ts
 * const [query, setQuery] = createSignal("");
 * const results = createMemo(() => searchProducts(query()));
 * const stale = createMemo(() => isPending(results));
 *
 * setQuery("shoes");
 * // stale() is true until the new results land, while results() keeps
 * // serving the previous list — dim it instead of showing a spinner.
 * ```
 *
 * @description https://v2.solidjs.com/reference/solid-js/reactivity/is-pending
 */
export function isPending(fn: () => any): boolean {
  markVerdictReader(1);
  const prevProbing = probing;
  const prevFound = probeFound;
  const prevVerdict = verdict;
  probing = true;
  probeFound = false;
  setVerdict(verdictValue);
  try {
    fn();
    return probeFound;
  } catch (e) {
    // A pending node is served inside the probe; what still throws is an
    // uninitialized one — loading, not pending (A19 exc. 1) — whose NotReady
    // propagates to boundaries from inside an owner (B5a; a component body
    // suspends on it like any read, #2928) and is swallowed outside one. A
    // verdict never throws anything else: a thunk that errors is simply not
    // pending.
    if (e instanceof NotReadyError && !probeFound && context !== null) throw e;
    return probeFound;
  } finally {
    probing = prevProbing;
    probeFound = prevFound;
    setVerdict(prevVerdict);
  }
}

/** The verdict engine's bits of a raise (seat.ts VERDICT_BITS), applied to
 * the reader `c` (core.ts `applyMarks`), in the order the old deciders fired
 * them: the flush's transaction opens if none has (`joinFuture(null)` — the
 * hold the marks name is the one it opens); the flight nobody holds is
 * queued for the seam (A15, #3458 — as if it had gone pending here); the
 * pass is the hold's verdict reader (`route`: display-ahead, D-23); a
 * probe's read is re-derived at the hold's landing (`_reruns`, once —
 * `isPending` flips there with no value notifying anyone); an action body's
 * untracked `latest()` of another hold's proposal entangles the two (A15,
 * posture C). */
function verdictApply(
  c: Computed<any>,
  el: Signal<any> | Computed<any>,
  r: number,
  tx: Transaction | null
): void {
  if (r & MARK_JF0) joinFuture(null);
  if (r & MARK_OBS) queuePendingNode(el as Computed<any>);
  const t = tx ?? flushTransaction!;
  // AH: the reading pass is the holder's verdict reader (seated in its
  // verdict lane, `t._verdict`) — unless already seated, or already the
  // frame's (its own reads derive from the future or a staging: the
  // verdict does not rescue it; its result shows at the landing,
  // re-derived). A lane read either way, for `recompute`'s tail.
  if (r & MARK_AH) {
    if (passLane === null && !(seatWorld & SEAT_OWN)) setPassLane(verdictLane(t));
    c._flags |= REACTIVE_LANE_READ;
  }
  if (r & MARK_PR) {
    const rr = t._reruns;
    if (rr[rr.length - 1] !== c) rr.push(c);
  }
  if (r & MARK_JFT) joinFuture(txOf(el));
}

/** `windowSlot`'s side channel: the row found the value not final (the
 * probe's answer, `probeFound`). */
let notFinal = false;

/**
 * The rows inside a window — Vl (`latest`) and Vp (`isPending`): the slot
 * the read is served and the mechanisms it fires (seat.ts vocabulary), as a
 * packed result (slot | raise). A verdict reader is a frame reader: it sees the
 * screen, the proposal under `latest`, and breaks out as the holder's
 * verdict reader (AH), re-derived at the landing. Pure but for `notFinal`.
 *
 * - a lane's node (Vl5 / Vp1): a guess is the value (A17); a derivation the
 *   lane's latest under `latest` unless in flight, else its display;
 *   `isPending` reads the display. A first load in flight with nothing
 *   produced yet is loading (D-22 — unless an error answered it first, D-41
 *   #4375). Nothing in either view (born in the lane, #4362 #4363): read
 *   as any uninitialized node below, the reader not moved;
 * - a held node (Vl1 / Vp1): the proposal under `latest` (a staged error
 *   thrown, D-41; a rewrite not yet flushed serves the flushed stash and
 *   runs again in the carrying flush, A28), the screen under `isPending`;
 *   a render effect outside the hold's own flush while its verdict lane is
 *   blocked is a stale reader of it (Vl1', #3460); born into the future
 *   (Vl4 / Vp2): its staging is its only value — a probe's owned read is a
 *   plain read, the owner joins the hold;
 * - staged and not held (Vl2 / Vl3 / Vl4' / Vp1): the seam's verdict
 *   (`prov`), or a flight's beneath the staging (#3376, `pend`); in a flush
 *   `latest` serves the staging, outside one the committed value and a
 *   late re-run (A28); `isPending` the screen;
 * - a flight (Vl4 / Vp1): below the async nothing newer exists — the
 *   committed value, the seam's verdict (`pend`); with no value yet,
 *   NotReady (loading, not pending — A19 exc. 1);
 * - an errored derivation throws for every reader (#2897).
 */
function windowSlot(
  c: Computed<any> | null,
  el: Signal<any> | Computed<any>,
  tracked: boolean,
  spectate: boolean
): number {
  const owner = el as Computed<any>;
  const cfg = el._config;
  const st = owner._statusFlags ?? 0;
  const latest = latestActive;
  const owned = c !== null && !(c._config & CONFIG_CHILDREN_FORBIDDEN);
  const tr = owned && tracked;
  const staged = el._pendingValue !== NOT_PENDING;
  const held = (cfg & CONFIG_HELD) !== 0;
  const uninit = (st & STATUS_UNINITIALIZED) !== 0;
  const pending = (st & STATUS_PENDING) !== 0;
  const errored = (el as any)._fn && (st & STATUS_ERROR) !== 0;
  const guess = (cfg & CONFIG_GUESS) !== 0;
  const running = globalQueue._running;
  const stagedSlot = cfg & CONFIG_STAGED_ERROR ? SLOT_ESTAGED : SLOT_P;
  const nrLink = c !== null && !tracked && !spectate && el !== c ? MARK_LINK : 0;
  /** A verdict read (`verdictRead`): the pass is the hold's verdict reader
   * (AH); a probe's is re-derived at the landing too (PR). */
  const ah = MARK_AH | (probing ? MARK_PR : 0);
  /** A live `affects()` mark on the node or a dependency (affects.ts): not
   * final by declaration; in a flush with a hold the probe's reader is its
   * verdict reader whatever the value's row says. */
  let marked = 0;
  if (probing && GlobalQueue._marked?.(owner)) {
    notFinal = true;
    if (tr && flushTransaction !== null) marked = ah;
  }
  const row = (slot: number, raise = 0, tx: Transaction | null = null): number => {
    carry(tx ?? (marked ? flushTransaction : null));
    return slot | raise | marked;
  };

  if (cfg & CONFIG_OVERRIDE && !(errored && !guess)) {
    const l = txOf(el);
    const flying = pending && !quietPending(owner);
    const parent = l._parent ?? l;
    ROW && setRow(latest ? "Vl5" : "Vp1");
    if (guess) {
      if (
        probing &&
        (flying ||
          (staged && (!el._equals || !el._equals(el._x!._lane as any, el._pendingValue as any))))
      )
        notFinal = true;
      return row(latest && l.folded ? SLOT_FOLD : SLOT_LV, tr ? ah : 0, parent);
    }
    if (!(latest && !flying ? laneNP(el, guess, staged, uninit) : dispNP(el, uninit))) {
      if (flying && uninit && el._x!._lane === el._value && (latest || !owner._x!._shownError))
        return row(SLOT_NR, tr ? ah : 0, parent);
      if (probing && flying) notFinal = true;
      return row(latest && !flying ? SLOT_LV : SLOT_DV, tr ? ah : 0, parent);
    }
  }
  if (held) {
    const t = txOf(el);
    if (!uninit) {
      if (
        !probing &&
        tr &&
        (c as any)._type === EFFECT_RENDER &&
        passLane === null &&
        t._verdict?._held &&
        flushTransaction !== t
      )
        return (ROW && setRow("Vl1'"), row(SLOT_C, MARK_ST, t._verdict));
      if (probing && heldNotFinal(owner)) notFinal = true;
      if (latest && staged) {
        // A28: a held node rewritten outside a flush keeps the staging the
        // last flush left until the flush that carries the rewrite.
        const stash = !running && !(cfg & CONFIG_PROMOTED) && el._x!._flushedAt === clock;
        ROW && setRow("Vl1");
        return row(
          stash ? SLOT_STASH : stagedSlot,
          tr ? ah | (stash ? MARK_LATE : 0) : flushTransaction !== null && !running ? MARK_JFT : 0,
          t
        );
      }
      return (ROW && setRow(latest ? "Vl1" : "Vp1"), row(SLOT_C, tr ? ah : 0, t));
    }
    ROW && setRow(latest ? "Vl4" : "Vp2");
    if (staged && !pending) return row(stagedSlot, owned && probing ? RAISE_H : 0, t);
    return row(SLOT_NR, nrLink, t); // f0
  }
  /** The seam's verdict for a staging or flight not held
   * (`provisionalVerdict`): once the flush has a hold the reader is its
   * verdict reader at once — and a probe that also read the frame's
   * staging plainly watches the seam as well; before any hold it watches
   * the seam, the verdict its own unless a probe found the value final. */
  const prov = (nf: boolean, flush: boolean): number => {
    if (flush) {
      if (probing && nf) notFinal = true;
      return ah | (probing && c!._flags & REACTIVE_STAGED_READ ? MARK_W : 0);
    }
    return MARK_W | (!probing || nf ? MARK_UNANS : 0);
  };
  /** The seam's verdict for a flight (`pendingVerdict`): not final unless
   * quiet; in a flush `latest` opens the flush's transaction for it (the
   * reader is its verdict reader at once), a probe watches the seam before
   * anything joined. Outside a flush nothing is the seam's. */
  const pend = (): number => {
    if (probing && !quietPending(owner)) notFinal = true;
    return tr && running
      ? (!probing ? MARK_JF0 : 0) | prov(false, flushTransaction !== null || !probing)
      : 0;
  };
  if (staged) {
    const seam =
      pending && !uninit
        ? pend()
        : tr && running
          ? prov(!latest && !uninit, flushTransaction !== null)
          : tr && probing
            ? MARK_W
            : 0;
    if (latest) {
      if (running) {
        ROW && setRow(pending && !uninit ? "Vl4'" : "Vl2");
        return row(stagedSlot, seam, flushTransaction);
      }
      ROW && setRow(pending && !uninit ? "Vl4'" : "Vl3");
      return row(SLOT_C, seam | (c !== null ? MARK_LATE : 0));
    }
    return (ROW && setRow("Vp1"), row(SLOT_C, seam, flushTransaction));
  }
  if (pending) {
    if (uninit) return (ROW && setRow(latest ? "Vl4" : "Vp2"), row(SLOT_NR, nrLink)); // f0: loading, not pending
    return (ROW && setRow(latest ? "Vl4" : "Vp1"), row(SLOT_C, pend(), flushTransaction));
  }
  ROW && setRow(latest ? "Vl4" : "Vp1");
  if (errored) return row(SLOT_E);
  return row(SLOT_C);
}

/** The verdict windows' read — `latest(fn)` and `isPending(fn)` — in one
 * cold path off `read`'s. It links and pulls like a plain read, then the
 * window rows decide (`windowSlot`), the marks are applied (core.ts
 * `applyMarks`) and the slot is served. */
function verdictValue(el: Signal<any> | Computed<any>, c: Computed<any> | null): unknown {
  const owner = el as Computed<any>;
  // A31: the pulled memo's pass is its own, not the probe's — it reads
  // outside the window, and the probe's read below answers for what the pass
  // produced. So is a lazy or dormant memo's wake (an unowned memo with no
  // reader left, #4366): woken inside the window, it read its sources as the
  // probe does, the committed value under a landing. (A signal has no
  // `_flags`: the wake is a no-op for it.)
  setVerdict(null);
  prepareComputed(owner, false);
  if (c && tracking) {
    link(el, c);
    if ((el as any)._fn) pullComputed(owner, c);
  }
  setVerdict(verdictValue);
  notFinal = false;
  const r = windowSlot(c, el, tracking, spectating);
  const s = r & SLOT_MASK;
  if (probing && notFinal) probeFound = true;
  if (__TEST__)
    shadowDecided(
      c,
      el,
      tracking,
      (probing ? WINDOW_PROBE : 0) | (latestActive ? WINDOW_LATEST : 0),
      spectating,
      r
    );
  // Dev strict-read scopes (a component body, an effect callback) warn on a
  // verdict read as on any untracked read; the pending throw they add for a
  // plain read does not apply — a verdict read is a sanctioned read of a
  // pending node (an uninitialized one still throws NotReady below). Not a
  // lane's value served.
  if (
    __DEV__ &&
    strictRead &&
    s !== SLOT_LV &&
    s !== SLOT_DV &&
    s !== SLOT_FOLD &&
    strictReadActive()
  )
    warnStrictReadUntracked(strictRead, {
      ownerId: c?.id,
      ownerName: (c as any)?._name,
      nodeName: (owner as any)?._name
    });
  if (c !== null) {
    if (r & RAISE_MASK) applyMarks(c, el, r);
  } else if (r & MARK_JFT) joinFuture(txOf(el)); // (an action body's read: no pass)
  if (__TEST__) shadowActual(s);
  switch (s) {
    case SLOT_C:
      return el._value;
    case SLOT_P:
      return el._pendingValue;
    case SLOT_ESTAGED:
      throw el._pendingValue;
    case SLOT_STASH:
      return el._x!._flushed;
    case SLOT_NR:
    case SLOT_E:
      throw owner._x?._error;
  }
  return laneServe(el, s);
}

/** D-25: a node whose fetch a hold is waiting on is that hold's work, not a
 * verdict reader — a pass that re-runs it reads plainly — and a memo's
 * posture is what it reads: one that reads a verdict reader's value is a
 * verdict reader itself (#4050). An async memo with no verdict window of its
 * own (REACTIVE_WINDOW: it read a verdict memo, it called neither `latest`
 * nor `isPending`) is a verdict reader between its flights, and the hold's
 * work while one is up or its hold re-runs it.
 *
 * At a pass's head (core.ts `recompute`): a pending node's pass — its
 * flight is the transition's own work (#3884) — and a held one's re-run of
 * such a memo read plainly: the write that re-ran it is its hold's, and
 * served the screen it re-asked a question it had answered (A10, #4397).
 * Only a memo that never asked: D-25's "a verdict posture outlives the pass
 * that asked" is a pass that called `latest`/`isPending`, which clears
 * CONFIG_ASYNC and stays a verdict reader whoever dirties it.
 *
 * On `source` going pending (`propagateStatus`): such a memo waits on it
 * like any derivation (F-9) instead of re-deriving — what it read changed
 * no value, so its re-run re-asked the question it was answering. Unless
 * its own flight is up outside a lane on a new question of the source's:
 * its re-run supersedes a flight asked of a value the source has moved past
 * (re-asked by a `refresh()`, the source's question is the same one). */
function holdWork(n: Computed<any>, source: Computed<any>): unknown {
  // CONFIG_ASYNC records an async memo with no window of its own: its last
  // answering pass registered a flight (`handleAsync`) and called neither
  // `latest` nor `isPending`. A window (`markVerdictReader`), a sync answer or
  // an error clears it; a pass left pending keeps the last answer's.
  const own = n._config & CONFIG_ASYNC;
  return (
    own &&
    (!(n._statusFlags & STATUS_PENDING) ||
      n._x!._transaction?._lane ||
      source._flags & REACTIVE_REASK)
  );
}

// Installed at module evaluation — present exactly when something imports
// `latest` or `isPending`. (`read` dispatches to `verdictValue` through
// `verdict`, set while a window is open.)
installVerdictHooks(verdictApply, holdWork);
/** A store read inside an untracked `isPending` probe found a live mark on
 * a record with no node to carry it (store/affects.ts): not final. */
GlobalQueue._witnessMark = () => {
  if (probing) probeFound = true;
};
