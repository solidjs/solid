// Verdicts (§28 replay, 2026-10-02; maintainer, 2026-10-01: verdicts are
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
  CONFIG_HELD,
  CONFIG_OVERRIDE,
  CONFIG_VERDICT,
  EFFECT_RENDER,
  NOT_PENDING,
  REACTIVE_DISPOSED,
  REACTIVE_FRAME_READ,
  REACTIVE_JOINED,
  REACTIVE_LANE_READ,
  REACTIVE_PROBED,
  REACTIVE_STAGED_READ,
  STATUS_ERROR,
  STATUS_PENDING,
  STATUS_UNINITIALIZED
} from "./constants.js";
import {
  context,
  markLateLinker,
  pullComputed,
  setVerdict,
  strictRead,
  tracking,
  unflushedValue
} from "./core.js";
import { warnStrictReadUntracked } from "./dev.js";
import { NotReadyError } from "./error.js";
import { link } from "./graph.js";
import { display, laneValueOf, verdictLane } from "./lanes.js";
import { enqueueSub } from "./heap.js";
import {
  flushTransaction,
  globalQueue,
  GlobalQueue,
  joinFuture,
  passLane,
  setPassLane,
  stagedReaders,
  staleReader,
  txOf,
  type Transaction
} from "./scheduler.js";
import type { Computed, Root, Signal } from "./types.js";

/** A verdict reader whose answer this flush could not give yet: the node it
 * asked about is staged and not held — whether it will be is the seam's
 * verdict. It read the staging as the screen: if the flush parks it runs
 * again next round, as lane work that did the same does (`stagedReaders`,
 * lanes.ts — entering the verdict lane then voids what it staged); if it
 * commits, the answer stood. */
function watchVerdict(c: Computed<any>): void {
  stagedReaders.push(c);
}

/** The reading pass is the holder's verdict lane's — unless already lane
 * work, or already the transaction's (it derives from the future — a held
 * node's, or the staging of a write this flush may hold — and the verdict
 * does not rescue it: its result shows at the landing, re-derived). A lane
 * read, for `recompute`'s tail (REACTIVE_LANE_READ). */
function route(c: Computed<any>, t: Transaction): void {
  if (passLane === null && !(c._flags & (REACTIVE_JOINED | REACTIVE_STAGED_READ)))
    setPassLane(verdictLane(t));
  c._flags |= REACTIVE_LANE_READ;
}

/** A verdict reader served a flight's committed value (the A31 frame-reader
 * case) still observed the flight — A15's stale reader "derives from the
 * flight all the same": the frame holds (the flush's transaction opens if
 * none has, as the throw would have had it), the reader is that
 * transaction's verdict lane's (shown now, with the flight's verdict), and
 * re-derives at the landing (REACTIVE_FRAME_READ — which is also what makes
 * it a blocker of the hold, `blockedBy`; a probe alone is neither). */
function observeFlight(c: Computed<any>): void {
  if (!globalQueue._running) return;
  joinFuture(null);
  verdictRead(c, flushTransaction!, true);
}

/** Verdict windows. Inside `latest(fn)` a read of a held node serves the
 * proposal (above the async, the held write; below it, the committed value
 * — nothing newer exists) instead of joining or throwing; inside
 * `isPending(fn)` a read records whether what it saw is final. Either way
 * the reader breaks out: work of the holder's verdict lane, shown now and
 * re-derived at the landing. */
let latestActive = false;
let probing = false;
let probeFound = false;
/** `read` dispatches here while a window is open. */
function setWindows(): void {
  setVerdict(latestActive || probing ? verdictValue : null);
}

/** A verdict read of a node a transaction (or lane) holds: the reading pass
 * is the holder's verdict lane's and re-derives at the holder's landing
 * (`_reruns`, as a stale reader). `isPending` flips at the landing with no
 * value notifying anyone (a held write's commit; a held landing's): its
 * reader re-derives there. `latest` shows the proposal that lands — a
 * rewrite or a landing reaches its reader through the link it holds — so a
 * re-run would only repeat the frame. */
function verdictRead(c: Computed<any>, t: Transaction, rerun = probing): void {
  route(c, t);
  if (rerun) staleReader(c, t);
}

/** A verdict read of a node staged or in flight but not held yet: whether it
 * will be is the seam's.
 *
 * `isPending` asks exactly that — final unless the flush parks — so its
 * reader cannot be answered before the seam: a flush that has joined a
 * transaction parks, and the node with it — the reader is that
 * transaction's verdict lane's now; before anything joined, the reader
 * watches the seam and runs again if the flush parks (a plain sync write
 * never glitches it true).
 *
 * `latest` has its answer either way — the proposal — and only the reader's
 * membership was open, so it is settled now: the frame gets its transaction
 * (`joinFuture(null)`; nothing holds it at the seam and it lands there, the
 * lane dissolving into it — a plain commit) and the reader is its verdict
 * lane's. One pass: a provisional pass re-derived at the seam ran everything
 * downstream of it twice (#3540 web). A pass that also read the frame's own
 * stagings plainly (REACTIVE_STAGED_READ) stays the frame's (`route` does
 * not move it); a verdict reader's plain read AFTER the window sees the
 * screen (`read`: `stagedScreen`). */
function provisionalVerdict(c: Computed<any>, notFinal: boolean): void {
  if (!probing) {
    joinFuture(null);
    verdictRead(c, flushTransaction!);
    return;
  }
  if (flushTransaction !== null) {
    if (notFinal) probeFound = true;
    verdictRead(c, flushTransaction);
  }
  if (flushTransaction === null || c._flags & REACTIVE_STAGED_READ) watchVerdict(c);
}

/** A19 exc. 2 / A24: a flight that re-asks the question already answered
 * (a `refresh()`, a poll) is quiet; a node pending through others is quiet
 * when every flight it waits on is. */
function quietPending(el: Computed<any>): boolean {
  const x = el._x;
  if (x === null) return false;
  if (x._pendingSources !== undefined) {
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
    (!owner._equals || !owner._equals(owner._value as any, owner._pendingValue as any))
  );
}

/** `isPending`'s answer for an unheld node whose flight is up (cause ii). */
function pendingVerdict(c: Computed<any> | null, el: Computed<any>): void {
  if (el._statusFlags & STATUS_UNINITIALIZED) return;
  if (probing && !quietPending(el)) probeFound = true;
  if (c !== null && tracking) {
    if (el._config & CONFIG_HELD) verdictRead(c, txOf(el));
    else if (globalQueue._running) provisionalVerdict(c, false); // decided above
  }
}

/** The pass entering a verdict window is a verdict reader (CONFIG_VERDICT):
 * a dependency going pending re-derives it, the verdict having changed. */
function markVerdictReader(window: number): void {
  let c = context;
  if ((c as Root)?._root) c = (c as Root)._parentComputed;
  if (c !== null) {
    c._config |= CONFIG_VERDICT;
    (c as Computed<any>)._flags |= REACTIVE_PROBED;
    // Observe tier: which windows this pass entered (1 `isPending`, 2
    // `latest`) — the hold census names the affordance (attribution.ts).
    if (__OBSERVE__) (c as any)._devWindows = ((c as any)._devWindows ?? 0) | window;
  }
}

/** The windows. */
export function latest<T>(fn: () => T): T {
  markVerdictReader(2);
  const prev = latestActive;
  latestActive = true;
  setWindows();
  try {
    return fn();
  } finally {
    latestActive = prev;
    setWindows();
  }
}

export function isPending(fn: () => any): boolean {
  markVerdictReader(1);
  const prevProbing = probing;
  const prevFound = probeFound;
  probing = true;
  probeFound = false;
  setWindows();
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
    setWindows();
  }
}

/** `latest()` of a held node: the flushed staging — the proposal — and, for
 * a tracked reader of a rewrite not yet flushed, the late-linker re-run in
 * the flush that carries it. */
function heldLatest(el: Signal<any> | Computed<any>, c: Computed<any> | null): unknown {
  const u = unflushedValue(el);
  if (u === NOT_PENDING) return el._pendingValue;
  if (c !== null) markLateLinker(c);
  return u;
}
/** The verdict windows' read — `latest(fn)` and `isPending(fn)` — in one
 * cold path off `read`'s. It links and pulls like a plain read, then answers
 * for what the reader sees (a verdict reader is a frame reader):
 * - a lane's node: the reader is the holder's verdict lane's (not the
 *   lane's — a lane blocked on its own flight would hold the reader's run,
 *   the opposite of a verdict's display-ahead). A guess is the value (A17),
 *   not final while its own question flies or a truth held beneath it
 *   differs (A24, A18 provenance). A derivation: `latest` sees the lane's
 *   latest (a landing a blocked lane holds has answered its question — the
 *   checkout's shipping text updates independently of the tax in flight),
 *   `isPending` the screen; not final while its own flight is up;
 * - a held node: the reader breaks out as the holder's verdict lane's and
 *   re-derives at the landing; `latest` serves the proposal (`heldLatest`),
 *   `isPending` answers `heldNotFinal`;
 * - a node staged this flush and not yet held: the seam's verdict
 *   (`provisionalVerdict`) — or, with a newer question already in flight
 *   (#3376, the stale first hop of a chain), its flight's;
 * - a flight (cause ii): `isPending` records it (`pendingVerdict`), `latest`
 *   serves the committed value — below the async nothing newer exists; an
 *   uninitialized one throws NotReady: loading, not pending (A19 exc. 1);
 * - an errored derivation throws for every reader (#2897). */
function verdictValue(el: Signal<any> | Computed<any>, c: Computed<any> | null): unknown {
  const owner = el as Computed<any>;
  const tracked = c !== null && tracking && !(c._config & CONFIG_CHILDREN_FORBIDDEN);
  if (c !== null && tracking) {
    link(el, c);
    if (owner._fn !== undefined) pullComputed(owner, c);
  }
  // A live `affects()` mark on the node or a dependency (affects.ts): not
  // final by declaration — the value itself is read as below. The verdict is
  // display-ahead like any: in a transaction's flush (the declaring action's
  // body) the reader is its verdict lane's, not a staging the frame parks.
  if (probing && GlobalQueue._marked !== undefined && GlobalQueue._marked(owner)) {
    probeFound = true;
    if (tracked && flushTransaction !== null) verdictRead(c!, flushTransaction);
  }
  if (el._config & CONFIG_OVERRIDE) {
    const l = txOf(el);
    if (tracked) verdictRead(c!, l._parent ?? l);
    const flying = (owner._statusFlags & STATUS_PENDING) !== 0 && !quietPending(owner);
    if (el._config & CONFIG_GUESS) {
      if (
        probing &&
        (flying ||
          (el._pendingValue !== NOT_PENDING &&
            (!el._equals || !el._equals(el._x!._lane as any, el._pendingValue as any))))
      )
        probeFound = true;
      return el._x!._lane;
    }
    if (probing && flying) probeFound = true;
    return latestActive && !flying ? laneValueOf(el) : display(el);
  }
  // Dev strict-read scopes (a component body, an effect callback) warn on a
  // verdict read as on any untracked read; the pending throw they add for a
  // plain read does not apply — a verdict read is a sanctioned read of a
  // pending node (an uninitialized one still throws NotReady below).
  if (__DEV__ && strictRead)
    warnStrictReadUntracked(strictRead, {
      ownerId: c?.id,
      ownerName: (c as any)?._name,
      nodeName: (owner as any)?._name
    });
  const uninitialized = (owner._statusFlags & STATUS_UNINITIALIZED) !== 0;
  if (el._config & CONFIG_HELD) {
    if (!uninitialized) {
      const t = txOf(el);
      // A render effect re-run (or mounted) outside the verdict lane's flush
      // while the lane is blocked — its display held on its own derivation
      // in flight — is a stale reader of the lane (#3460, as `laneRead`): the
      // committed value now, re-derived at the reveal. Not inside a probe:
      // `isPending` is answered below either way.
      if (
        tracked &&
        !probing &&
        (c as any)._type === EFFECT_RENDER &&
        passLane === null &&
        t._verdict !== null &&
        t._verdict._held &&
        flushTransaction !== t
      ) {
        staleReader(c!, t._verdict);
        return el._value;
      }
      if (tracked) verdictRead(c!, t);
      if (probing && heldNotFinal(owner)) probeFound = true;
      if (latestActive && el._pendingValue !== NOT_PENDING) {
        // An action body reading another transaction's proposal derives
        // from it: the two settle as one (A15; posture C, 2026-09-15). An
        // untracked read elsewhere has no transaction to entangle.
        if (!tracked && flushTransaction !== null && !globalQueue._running) joinFuture(txOf(el));
        return heldLatest(el, tracked ? c : null);
      }
      return el._value;
    }
    // Born into the future: its staging is its only value.
    if (el._pendingValue !== NOT_PENDING && !(owner._statusFlags & STATUS_PENDING))
      return el._pendingValue;
  } else if (el._pendingValue !== NOT_PENDING) {
    if (owner._statusFlags & STATUS_PENDING && !uninitialized)
      pendingVerdict(tracked ? c : null, owner);
    else if (tracked && globalQueue._running)
      provisionalVerdict(c!, !latestActive && !uninitialized);
    // Outside a flush, the staging is an unflushed write (A28): the probe
    // answers for the flushed world, and watches the seam of the flush that
    // carries the write — a memo of `isPending(x)` created after the write
    // flips if that flush parks (#3078). (The write's own fan-out ran before
    // the reader existed; nothing else would re-derive it.)
    else if (tracked && probing) watchVerdict(c!);
    if (latestActive) {
      // A28: an unflushed write is not what `latest` serves; a tracked
      // reader derived from the flushed world runs again in the carrying
      // flush.
      if (globalQueue._running) return el._pendingValue;
      if (c !== null) markLateLinker(c);
    }
    return el._value;
  }
  if (owner._statusFlags & STATUS_PENDING) {
    if (!uninitialized) {
      pendingVerdict(tracked ? c : null, owner);
      return el._value;
    }
    throw owner._x?._error;
  }
  if (owner._fn !== undefined && owner._statusFlags & STATUS_ERROR) throw owner._x!._error;
  return el._value;
}

// Installed at module evaluation — present exactly when something imports
// `latest` or `isPending`. (`read` dispatches to `verdictValue` through
// `verdict`, set while a window is open.)
GlobalQueue._observeFlight = observeFlight;
