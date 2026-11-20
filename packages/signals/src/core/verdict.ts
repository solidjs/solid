// Verdicts: `latest(fn)` and `isPending(fn)`, the display-ahead reads (F-6,
// D-22, D-23, D-25). A verdict reader runs in its holder's verdict lane:
// shown now, re-derived at the landing.

import {
  CONFIG_CHILDREN_FORBIDDEN,
  CONFIG_GUESS,
  CONFIG_ASYNC,
  CONFIG_OWN_PROBE,
  CONFIG_FRAME,
  CONFIG_HELD,
  CONFIG_HELD_FRAME,
  CONFIG_IN_SNAPSHOT_SCOPE,
  CONFIG_INPUTS_PUBLISHED,
  CONFIG_OVERRIDE,
  CONFIG_REDERIVE,
  CONFIG_STAGED,
  CONFIG_STAGED_ERROR,
  CONFIG_VERDICT,
  EFFECT_RENDER,
  EFFECT_TRACKED,
  NOT_PENDING,
  NO_SNAPSHOT,
  REACTIVE_CHECK,
  REACTIVE_DIRTY,
  REACTIVE_DISPOSED,
  REACTIVE_FRAME_READ,
  REACTIVE_IN_HEAP,
  REACTIVE_JOINED,
  REACTIVE_LANE_DIRTY,
  REACTIVE_MANUAL_WRITE,
  REACTIVE_MISSED_WAKE,
  REACTIVE_LANE_READ,
  REACTIVE_PROBED,
  REACTIVE_REASK,
  REACTIVE_SNAPSHOT_STALE,
  REACTIVE_PROBE_UNANSWERED,
  REACTIVE_STAGED_READ,
  REACTIVE_WINDOW,
  WINDOW_KINDS,
  STATUS_ERROR,
  STATUS_PENDING,
  STATUS_UNINITIALIZED
} from "./constants.js";
import {
  bornInto,
  context,
  creatorPass,
  creatorReads,
  ext,
  isSame,
  tickBase,
  joinPass,
  markLateLinker,
  prepareComputed,
  pullComputed,
  setVerdict,
  snapshotCaptureActive,
  spectating,
  strictRead,
  strictReadActive,
  tracking,
  unflushedValue,
  verdict
} from "./core.js";
import { adopter, setAdopter } from "./core.js";
import {
  handleAsync,
  isThenable,
  notifyStatus,
  releaseFlightTeardown,
  settlePendingSource
} from "./async.js";
import { forgetThrownRead, warnStrictReadUntracked } from "./dev.js";
import { NotReadyError } from "./error.js";
import { link } from "./graph.js";
import {
  ahead,
  heldMountUnder,
  keptGuess,
  isVerdict,
  screenOf,
  verdictLane,
  waiting
} from "./lanes.js";
import { landed, latestOf } from "./truth.js";
import { deleteFromHeap, enqueueSub } from "./heap.js";
import {
  blocked,
  dirtyQueue,
  clock,
  dropFlushTx,
  flushTransaction,
  globalQueue,
  GlobalQueue,
  insertSubs,
  joinFuture,
  list,
  passLane,
  pendingNodes,
  heldRewrites,
  queuePendingNode,
  guessing,
  resolveTx,
  sameLane,
  schedule,
  setPassLane,
  stagedReaders,
  staleReader,
  txOf,
  type Transaction,
  installVerdictHooks
} from "./scheduler.js";
import {
  SLOT_C,
  SLOT_DV,
  SLOT_LV,
  SLOT_P,
  SLOT_SNAPSHOT,
  shadowActual,
  shadowExpect,
  shadowWindow
} from "./seat.js";
import type { Computed, Signal } from "./types.js";

/** The seam decides this reader's answer: it re-runs if the flush parks. */
function watchVerdict(c: Computed<any>, unanswered = false): void {
  if (unanswered) c._flags |= REACTIVE_PROBE_UNANSWERED;
  stagedReaders.push(c);
}

/** Seat the pass in the holder's verdict lane, unless it is already lane
 * work or the hold's own work (D-25: a pass the hold built reads plainly). */
function route(c: Computed<any>, t: Transaction): void {
  if (
    !passLane &&
    !(c._flags & (REACTIVE_JOINED | REACTIVE_STAGED_READ)) &&
    !(c._config & CONFIG_HELD_FRAME && bornInto(c, resolveTx(t)))
  )
    setPassLane(verdictLane(t));
  c._flags |= REACTIVE_LANE_READ;
}

/** A verdict reader's plain read of a flight, served the committed value,
 * still holds the frame on that flight (D-23: `[isPending(x), x()]` holds
 * like `x()`; D-25). A flight nothing held yet is queued here, so the hold
 * has an entry for it (#3458; without it the reader re-derived every flush,
 * fuzzer F12). True when the reader is served the committed value: not
 * when that would tear against inputs already on screen (F-1, #3305), nor
 * for a reader born into the flight's hold (#4010). */
function observeFlight(c: Computed<any>, el: Computed<any>): boolean {
  // Either read order holds the frame, a routed render effect too (D-25, S-52).
  if (el._config & CONFIG_INPUTS_PUBLISHED || (el._config & CONFIG_HELD && bornInto(c, txOf(el))))
    return false;
  // A derived store's derive with no reader is no display (F-3).
  if (globalQueue._running && (c as any)._fam?.live.size !== 0) {
    joinFuture(null);
    if (!(el._config & CONFIG_HELD)) queuePendingNode(el);
    ahead.splice(ahead.indexOf(c) >>> 0, 1);
    verdictRead(c, flushTransaction!, true);
  }
  return true;
}

/** Which window is open, and whether an `isPending` probe found anything. */
let latestActive = false;
let probing = false;
let probeFound = false;

/** A verdict read of a held node. A probe re-runs at the landing because
 * nothing notifies its flip; `latest` needs no re-run, the landing reaches
 * it through its link. */
function verdictRead(c: Computed<any>, t: Transaction, plain?: boolean): void {
  route(c, t);
  if (plain) staleReader(c, t);
  else if (probing && t._reruns[t._reruns.length - 1] !== c) t._reruns.push(c);
}

/** A verdict read of a node staged this flush but not held: whether it will
 * be held is the seam's decision. Before anything has joined a hold, the
 * reader re-runs if the flush parks, so a plain sync write never reads as
 * pending (F-9). `latest` opens no transaction for its answer (#4365). */
function provisionalVerdict(c: Computed<any>, notFinal: boolean): void {
  if (flushTransaction) {
    if (probing && notFinal) probeFound = true;
    verdictRead(c, flushTransaction);
    if (probing && c._flags & REACTIVE_STAGED_READ) watchVerdict(c);
    return;
  }
  // Unanswered: a later plain read may route this pass, and the seam must
  // not take that as the probe's answer.
  watchVerdict(c, !probing || notFinal);
}

/** A re-ask of the answered question is quiet (F-9); so is a node pending
 * only through quiet flights. */
function quietPending(el: Computed<any>): boolean {
  const x = el._x;
  if (!x) return false;
  if (x._pendingSources) {
    for (const source of x._pendingSources) if (!source._x?._reask) return false;
    return true;
  }
  return x._reask;
}

/** `isPending` of a held node with a committed value (F-9, D-23): a flight
 * is not final unless quiet; a staging is not final unless it is a quiet
 * re-ask, equal to the shown (non-error) value, or read inside `latest`,
 * whose view is the proposal. Truthy when not final. */
function heldNotFinal(owner: Computed<any>): unknown {
  if ((owner._statusFlags & STATUS_PENDING) !== 0 && (!quietPending(owner) || heldBeneath(owner)))
    return true;
  return (
    owner._pendingValue !== NOT_PENDING &&
    !latestActive &&
    !owner._x!._reask &&
    (owner._x!._shownError ||
      !owner._equals ||
      !owner._equals(owner._value as any, owner._pendingValue as any))
  );
}

/** While a re-ask flies, the error is still `latest`'s newest answer (D-22, D-41). */
function aheadError(el: Computed<any>): void {
  const e = el._statusFlags & STATUS_PENDING && (el._x?._aheadError || el._x?._shownError);
  if (e) throw e;
}
/** A source holds an answer to a new question, so a quiet flight does not make `el` final (F-9). */
function heldBeneath(el: Computed<any>): boolean {
  for (let d = el._deps; d !== null; d = d._nextDep) {
    const dep = d._dep;
    if (
      dep._config & CONFIG_HELD &&
      dep._pendingValue !== NOT_PENDING &&
      !dep._x?._reask &&
      !isSame(dep, dep._value, dep._pendingValue)
    )
      return true;
  }
  return false;
}
function pendingVerdict(c: Computed<any> | null, el: Computed<any>): void {
  if (probing && (!quietPending(el) || heldBeneath(el))) probeFound = true;
  if (c && tracking) {
    if (el._config & CONFIG_HELD) verdictRead(c, txOf(el));
    else if (globalQueue._running) {
      // `latest` of a flight is the committed value in every world (D-22),
      // so the reader joins the verdict lane now; a seam re-derive would ask
      // its question twice (F-9, #4397). A probe in a transaction only
      // `latest` opened takes no landing re-run, which would reopen it every
      // flush (#4661).
      if (!probing) {
        c._flags & REACTIVE_LANE_READ || ahead.push(c);
        flushTransaction ||
          (joinFuture(null), ((flushTransaction as Transaction | null)!.latest = 1));
      } else if (flushTransaction?.latest) return route(c, flushTransaction);
      provisionalVerdict(c, false); // decided above
    }
  }
}

/** Mark the pass entering a window as a verdict reader. An untracked window
 * is a snapshot like any untracked read (D-23, #3946). */
function markVerdictReader(window: number): unknown {
  const c = creatorPass(context);
  if (c && tracking) {
    // A pass `reask` returned to the frame answers for the hold's world (D-25).
    if (left.has(c)) return (watchVerdict(c, true), 1);
    // A pass created by one that read a held or staged value has no screen
    // and stays that world's (D-25, #4341). A first probing pass that
    // already joined a hold by a plain read restarts as a verdict reader,
    // so its reads agree in either order (D-25, #4777).
    const restart =
      c === adopter &&
      flushTransaction &&
      c._flags & REACTIVE_JOINED &&
      !(c._config & CONFIG_VERDICT) &&
      !(c._statusFlags & STATUS_UNINITIALIZED);
    c._flags |=
      REACTIVE_PROBED |
      REACTIVE_WINDOW |
      (window << WINDOW_KINDS) |
      (creatorReads(c, 0) || ((c._config |= CONFIG_VERDICT), 0));
    if (restart && c._config & CONFIG_VERDICT) {
      // Parks the pass with no visible pending; its tail re-runs it this flush.
      setAdopter(null);
      dropFlushTx();
      c._flags |= REACTIVE_MISSED_WAKE;
      c._loading = true;
      throw new NotReadyError(null);
    }
    if (__TEST__) shadowWindow(c);
    // Observe tier: the windows entered (1 `isPending`, 2 `latest`).
    if (__OBSERVE__) (c as any)._devWindows = ((c as any)._devWindows ?? 0) | window;
  }
}

export function latest<T>(fn: () => T): T {
  if (markVerdictReader(2)) return fn();
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
 * @description https://docs.solidjs.com/reference/solid-js/reactivity/is-pending
 */
export function isPending(fn: () => any): boolean {
  const plain = markVerdictReader(1);
  const prevProbing = probing;
  const prevFound = probeFound;
  const prevVerdict = verdict;
  probing = !plain;
  probeFound = false;
  if (!plain) setVerdict(verdictValue);
  try {
    fn();
    return probeFound;
  } catch (e) {
    // A node with no answer suspends when owned and reads false unowned; a
    // real error is swallowed and the probe keeps what it found (D-23, S-51).
    if (e instanceof NotReadyError && !probeFound && context !== null) throw e;
    // Dev: the probe's own swallow is not a user catch (D-42).
    if (__DEV__) forgetThrownRead();
    return probeFound;
  } finally {
    probing = prevProbing;
    probeFound = prevFound;
    setVerdict(prevVerdict);
  }
}

/** A staged error throws (D-41). */
function staged(el: Signal<any> | Computed<any>): unknown {
  if (el._config & CONFIG_STAGED_ERROR) throw el._pendingValue;
  return el._pendingValue;
}
/** `latest` of a held node: the flushed staging; an unflushed rewrite re-runs
 * its reader in the flush that carries it (F-10). */
function heldLatest(el: Signal<any> | Computed<any>, c: Computed<any> | null): unknown {
  const u = unflushedValue(el);
  if (u === NOT_PENDING) return staged(el);
  if (c) markLateLinker(c);
  return u;
}
/** The read inside a verdict window (D-22, D-23), off `read`'s hot path.
 * Links and pulls like a plain read, then answers by the node's state: a
 * lane's node, a held node, a staging this flush, a flight, or an error. */
function verdictValue(el: Signal<any> | Computed<any>, c: Computed<any> | null): unknown {
  const owner = el as Computed<any>;
  const owned = !!c && !(c._config & CONFIG_CHILDREN_FORBIDDEN);
  const tracked = owned && tracking;
  // A pulled memo's pass is its own, outside the window (D-25, #4366, #4429).
  const prevProbing = probing;
  const prevLatest = latestActive;
  probing = false;
  latestActive = false;
  setVerdict(null);
  prepareComputed(owner, false);
  if (c && tracking) {
    link(el, c);
    // Record where this staging was asked, for `holdStaging` (#4544).
    if (el._pendingValue !== NOT_PENDING)
      ext(el)._askedIn = el._config & CONFIG_HELD ? txOf(el) : flushTransaction || clock;
    if ((el as any)._fn) pullComputed(owner, c);
  }
  setVerdict(verdictValue);
  latestActive = prevLatest;
  probing = prevProbing;
  // A hydration claim reads the server's frame, whole (F-1, #4570).
  const sv =
      snapshotCaptureActive && c && c._config & CONFIG_IN_SNAPSHOT_SCOPE
        ? el._x?._snapshotValue
        : undefined,
    served = sv !== undefined && !(owner._statusFlags & STATUS_ERROR);
  if (__TEST__) shadowExpect(c, el, tracking, latestActive ? 2 : 1, spectating, served);
  if (served) {
    const snapshot = sv === NO_SNAPSHOT ? undefined : sv;
    if ((el._pendingValue !== NOT_PENDING ? el._pendingValue : el._value) !== snapshot)
      c!._flags |= REACTIVE_SNAPSHOT_STALE;
    if (__TEST__) shadowActual(SLOT_SNAPSHOT);
    return snapshot;
  }
  // An `affects()` mark is a declared new question (F-9).
  if (probing && GlobalQueue._marked?.(owner)) {
    probeFound = true;
    if (tracked && flushTransaction) verdictRead(c!, flushTransaction);
  }
  if (
    el._config & CONFIG_OVERRIDE &&
    !(owner._statusFlags & STATUS_ERROR && !(el._config & CONFIG_GUESS))
  ) {
    const l = txOf(el),
      flying = (owner._statusFlags & STATUS_PENDING) !== 0 && !quietPending(owner),
      guess = el._config & CONFIG_GUESS,
      // NOT_PENDING: born in the lane with no answer yet, so loading (F-9, #4363).
      v = guess ? 0 : latestActive && !flying ? latestOf(el) : screenOf(el);
    if (v !== NOT_PENDING) {
      const inLane = passLane !== null && sameLane(passLane, l);
      if (tracked) verdictRead(c!, l._parent ?? l);
      if (guess) {
        if (
          probing &&
          (flying ||
            (landed(el) &&
              (!el._equals || !el._equals(latestOf(el) as any, el._pendingValue as any))))
        )
          probeFound = true;
        // A folded keyed arrangement reads its world whole; D-22's guess
        // clause is not built for it (D-22 status).
        if (latestActive && l.folded) {
          if (__TEST__) shadowActual(landed(el) ? SLOT_P : SLOT_C);
          return l.folded(null, el);
        }
        if (__TEST__) shadowActual(SLOT_LV);
        return latestOf(el);
      }
      // A landed answer the lane has not shown is still pending (D-23,
      // S-54), as is a parked frame flight of its hold (#4365).
      if (probing && (flying || parkUp(resolveTx(l._parent ?? l)))) probeFound = true;
      else if (
        probing &&
        !inLane &&
        l._held &&
        !el._x!._shown &&
        el._pendingValue !== NOT_PENDING &&
        (!el._equals || !el._equals(el._value as any, el._pendingValue as any))
      ) {
        probeFound = true;
        if (tracked) staleReader(c!, l);
      }
      if (__TEST__) shadowActual(latestActive && !flying ? SLOT_LV : SLOT_DV);
      return v;
    }
  }
  // Dev: strict-read scopes warn, but a verdict read of a pending node does not throw.
  if (__DEV__ && strictRead && strictReadActive())
    warnStrictReadUntracked(strictRead, {
      ownerId: c?.id,
      ownerName: (c as any)?._name,
      nodeName: (owner as any)?._name
    });
  const uninitialized = (owner._statusFlags & STATUS_UNINITIALIZED) !== 0;
  if (el._config & CONFIG_HELD) {
    if (!uninitialized) {
      const t = txOf(el);
      // A render effect run off a blocked verdict lane shows the committed
      // value and re-derives at the reveal (D-25, S-30).
      if (
        tracked &&
        !probing &&
        (c as any)._type === EFFECT_RENDER &&
        !passLane &&
        t._verdict?._held &&
        flushTransaction !== t
      ) {
        staleReader(c!, t._verdict);
        if (__TEST__) shadowActual(SLOT_C);
        return el._value;
      }
      // A pass that asks is display-ahead like any other (F-6, S-51).
      if (tracked) verdictRead(c!, t);
      // A pass the hold holds is the hold's work: its probe is final at the
      // landing, never true beside the fresh value (D-23, #4648). An async
      // memo is not re-run, which would ask again (F-9).
      if (probing)
        if (c?._config! & CONFIG_HELD && !c!._x!._transaction?._lane) {
          // In the landing flush the probe reads the landed world (F-1, #4662).
          if (el._pendingValue !== NOT_PENDING && !blocked(t)) {
            watchVerdict(c!);
            if (__TEST__) shadowActual(SLOT_P);
            return staged(el);
          }
          if (!c!._x!._q) staleReader(c!, t);
        } else {
          if (heldNotFinal(owner)) probeFound = true;
          // Not held yet: re-run if the flush parks (D-23). Not an async or
          // first pass, which would ask again (F-9).
          if (owned && !tracked && !c!._x?._q && !(c!._statusFlags & STATUS_UNINITIALIZED))
            watchVerdict(c!);
        }
      if (latestActive && el._pendingValue !== NOT_PENDING) {
        // A corrected shown guess stays `latest`'s value until the commit (D-34, #4689).
        if (keptGuess(el) && blocked(t)) {
          if (__TEST__) shadowActual(SLOT_C);
          return el._value;
        }
        // An action body reading another hold's proposal entangles with it (D-7).
        if (!tracked && flushTransaction && !globalQueue._running) joinFuture(t);
        if (__TEST__) shadowActual(SLOT_P);
        return heldLatest(el, tracked ? c : null);
      }
      if (latestActive) aheadError(owner);
      if (__TEST__) shadowActual(SLOT_C);
      return el._value;
    }
    // Born held: no committed value, so no verdict (F-9); `latest` shows the staging (D-22).
    if (
      el._pendingValue !== NOT_PENDING &&
      (!(owner._statusFlags & STATUS_PENDING) || (latestActive && !probing))
    ) {
      if (probing && owned) joinPass(c!, el);
      if (__TEST__) shadowActual(SLOT_P);
      return staged(el);
    }
  } else if (el._pendingValue !== NOT_PENDING) {
    // A first answer re-asked in its own tick has a verdict (F-9, D-22);
    // an error is no value (D-41).
    if (
      owner._statusFlags & STATUS_PENDING &&
      (!uninitialized || (probing && !(el._config & CONFIG_STAGED_ERROR)))
    )
      pendingVerdict(tracked ? c : null, owner);
    // Writes that net to the committed value are no proposal: final (D-8, #4485).
    else if (tracked && globalQueue._running)
      flushTransaction &&
      !(el as any)._fn &&
      el._pendingValue === el._value &&
      Object.is(el._pendingValue, el._value)
        ? route(c!, flushTransaction)
        : provisionalVerdict(c!, !latestActive && !uninitialized);
    // An unflushed write is invisible (F-10); watch the flush that carries it (#3078).
    else if (tracked && probing) watchVerdict(c!);
    if (latestActive || uninitialized || (owned && !tracked)) {
      // In a flush the staging is visible (F-10); outside one, re-run in the
      // carrying flush.
      if (globalQueue._running) {
        if (__TEST__) shadowActual(SLOT_P);
        return staged(el);
      }
      if (c) markLateLinker(c);
    }
    if (__TEST__) shadowActual(SLOT_C);
    return el._value;
  }
  if (owner._statusFlags & STATUS_PENDING) {
    if (!uninitialized) {
      pendingVerdict(tracked ? c : null, owner);
      if (latestActive) aheadError(owner);
      if (__TEST__) shadowActual(SLOT_C);
      return el._value;
    }
    // As in `read`: an untracked read of a pending node still links.
    if (c && !tracking && !spectating && el !== c) link(el, c);
    throw owner._x?._error;
  }
  if ((el as any)._fn && owner._statusFlags & STATUS_ERROR) throw owner._x!._error;
  if (__TEST__) shadowActual(SLOT_C);
  return el._value;
}

/** An async memo with no window of its own (it read a verdict memo) is the
 * hold's work while its flight is up, in a lane, or re-asked: it drops the
 * verdict posture and waits like any derivation (D-25, F-9; #3884, #4408).
 * Called at a pass's head and when `source` goes pending. */
function holdWork(n: Computed<any>, source: Computed<any>): unknown {
  // Truthy result: CONFIG_ASYNC stays set.
  if (
    (n._config & (CONFIG_ASYNC | CONFIG_OWN_PROBE)) === CONFIG_ASYNC &&
    (!(n._statusFlags & STATUS_PENDING) ||
      n._x!._transaction?._lane ||
      source._flags & REACTIVE_REASK)
  )
    return (n._config &= ~CONFIG_VERDICT);
}

/** A derivation of a staged error carries it with the same frame, marked
 * rather than re-run, so the frame its content owns is kept (D-41, #4562).
 * `EFFECT_TRACKED << 23` spans CONFIG_FRAME and every effect type. */
function stageMark(node: Computed<any>, el: Computed<any>): void {
  if (
    el._config & CONFIG_STAGED_ERROR &&
    !(node._config & (CONFIG_REDERIVE | CONFIG_STAGED_ERROR | (EFFECT_TRACKED << 23)))
  ) {
    // Only a direct reader of the staged error carries it (#4640). A lane
    // reader does not: the staged truth is the hold's, shown at its reveal
    // (F-1, F-11, D-34; #4751, #4841).
    for (let d = node._deps; d; d = d._nextDep)
      if (
        d._dep._config & CONFIG_STAGED_ERROR &&
        !(
          node._x?._transaction?._lane &&
          (!(d._dep._config & CONFIG_GUESS) || d._dep._x!._transaction === node._x._transaction)
        )
      ) {
        node._pendingValue = el._pendingValue;
        node._config |= CONFIG_STAGED_ERROR;
        queuePendingNode(node);
        // A derived store's readers re-derive from the staging (#4189).
        (node as any)._fam?.st(STATUS_ERROR);
        return settlePendingSource(node);
      }
  }
}

/** `el` was republished mainline with the value it had staged: a held reader
 * whose only held read was `el` keeps its pass and publishes as is (#4417). */
function keepReaders(el: Computed<any>): void {
  for (let s = el._subs; s !== null; s = s._nextSub) {
    const r = s._sub;
    if (
      (r._config & (CONFIG_HELD | CONFIG_STAGED)) !== (CONFIG_HELD | CONFIG_STAGED) ||
      (r as any)._type
    )
      continue;
    let d = r._deps;
    while (d !== null && (d._dep === el || !(d._dep._config & CONFIG_HELD))) d = d._nextDep;
    if (d !== null) continue;
    // A mount a probing pass opened attaches at the landing, not now (D-25, S-46).
    if (heldMountUnder(r, null)) continue;
    deleteFromHeap(r, dirtyQueue);
    r._flags &= ~(REACTIVE_DIRTY | REACTIVE_CHECK);
    r._config &= ~CONFIG_HELD;
    queuePendingNode(r);
    insertSubs(r);
  }
}

/** A run the landing holds (lanes.ts `waiting`) runs next round with its held runs. */
function attachWaits(node: Computed<any>): boolean {
  if (waiting?.has(node))
    return (
      globalQueue.enqueue(
        (node as any)._type,
        ((node as any)._boundRunEffect ??= GlobalQueue._runEffect.bind(null, node))
      ),
      true
    );
  return false;
}

/** Whether a plain read of `el` is served the hold's staging. A pass that
 * opened no window of its own inherits no posture (D-25, #4544): it is the
 * hold's work where it reads the hold's own sync write, unless a window
 * asked of that staging under the same hold (`_askedIn`, D-25 pair
 * atomicity). A frame reads the screen. No `el`: a plain store key with no
 * node, decided by posture alone, as for a signal. */
function holdStaging(c: Computed<any>, el?: Signal<any> | Computed<any>): unknown {
  const r = c._x?._readIn,
    a = el?._x?._askedIn,
    h = el && resolveTx(el._config & CONFIG_HELD ? el._x!._transaction! : flushTransaction!);
  // A sync verdict memo's value staged this flush is read plainly, as the
  // window inline would be (D-25, #4778).
  if (
    el &&
    !(c as any)._type &&
    !passLane &&
    (el as any)._fn &&
    (el._config & (CONFIG_VERDICT | CONFIG_ASYNC | CONFIG_HELD | CONFIG_OVERRIDE)) ===
      CONFIG_VERDICT
  )
    return true;
  return (
    r &&
    !(
      c._config & (CONFIG_OWN_PROBE | CONFIG_FRAME) ||
      c._flags & (REACTIVE_WINDOW | REACTIVE_PROBE_UNANSWERED)
    ) &&
    (!el ||
      (el._pendingValue !== NOT_PENDING &&
        !(el._config & (CONFIG_ASYNC | CONFIG_OVERRIDE)) &&
        a !== clock &&
        !(typeof a == "object" && resolveTx(a) === h) &&
        resolveTx(r) === h)) &&
    (!passLane || (passLane._parent!._verdict === passLane && (setPassLane(null), true)))
  );
}

/** Parked frame flights. When the seam re-derives a verdict reader in its
 * lane, the frame pass's flight already asked the hold's question; the
 * landing adopts it instead of asking again (F-9, D-25; #4365, #4393).
 * Adopted at the reader's own turn in the next round, not at the landing,
 * so the hold is judged with the flight on it (F-1). Through a promise of
 * its own, so the frame pass's listener cannot land it twice. */
const armed: Computed<any>[] = [];
/** Readers whose parked frame flight is up: the hold waits on it, however
 * the lane pass came out (F-2, #3884). */
const parks: Computed<any>[] = [];
function park(r: Computed<any>, t: Transaction): void {
  const p = (r._x!._parked = r._x!._inFlight as PromiseLike<any>),
    done = () => {
      const i = parks.indexOf(r);
      if (i !== -1 && r._x!._parked === p) (parks.splice(i, 1), schedule());
    };
  // Only a flight a reader on screen waits on, judged as `blockedBy` does
  // and before the lane's passes replace the frame's pending (F-3, #4504).
  if (
    t._nodes.some((n: any) => {
      if (n._statusFlags & STATUS_PENDING && (n === r || n._x._pendingSources?.has(r))) {
        if (n._type === EFFECT_RENDER) return true;
        for (let s = n._subs; s; s = s._nextSub) {
          const e: any = s._sub;
          if (
            e._type === EFFECT_RENDER
              ? e._statusFlags & STATUS_PENDING || e._flags & REACTIVE_FRAME_READ
              : e._config & CONFIG_REDERIVE && e._statusFlags === STATUS_PENDING
          )
            return true;
        }
      }
    })
  ) {
    parks.indexOf(r) === -1 && parks.push(r);
    p.then(done, done);
  }
}
function parkUp(t: Transaction): boolean {
  for (let i = parks.length - 1; i >= 0; i--) {
    const x = parks[i]._x!,
      l = x._transaction;
    if (!x._parked || parks[i]._flags & REACTIVE_DISPOSED) parks.splice(i, 1);
    else if (l?._lane && resolveTx(l._parent!) === t) return true;
  }
  return false;
}
/** Passes `reask` returned to the frame; truthy when the lane pass was unanswered. */
const left = new Map<Computed<any>, unknown>();
/** A write the hold took reached lane member `c` while the hold waits on a
 * parked flight of it: that flight answers a superseded question, so the
 * new one is asked now by returning `c` (and the lane members it reads) to
 * the frame (F-2, F-9, D-25; #3884). */
function reask(c: Computed<any>, l: Transaction, cur: Computed<any>): void {
  if (left.has(c)) return;
  const i = parks.indexOf(c);
  if (i === -1) {
    if (!(c as any)._type && c._x?._transaction === l)
      for (let s = c._subs; s; s = s._nextSub) reask(s._sub, l, cur);
    return;
  }
  parks.splice(i, 1);
  leave(c, l, cur);
}
/** Seat a lane pass from its first read. */
function seat(r: Computed<any>, t: Transaction): void {
  list(r, verdictLane(t));
  r._flags |= REACTIVE_LANE_DIRTY;
}
function leave(c: Computed<any>, l: Transaction, cur: Computed<any>): void {
  const x = c._x!;
  left.set(c, !x._shown && c._statusFlags & STATUS_PENDING);
  x._shown = false;
  x._transaction = null;
  x._parked = undefined;
  c._pendingValue = NOT_PENDING;
  c._config &= ~(CONFIG_OVERRIDE | CONFIG_VERDICT);
  if (c !== cur) ((c._flags |= REACTIVE_DIRTY), enqueueSub(c));
  for (let d = c._deps; d; d = d._nextDep) {
    const n = d._dep as Computed<any>;
    if ((n as any)._fn && n._x?._transaction === l && !left.has(n)) leave(n, l, cur);
  }
}
const adoptParked = (r: Computed<any>, visit?: number): boolean => {
  if (visit === 2) {
    const l = r._x!._transaction;
    if (parks.length && isVerdict(l)) reask(r, l!, r);
    return false;
  }
  if (visit) {
    const i = armed.indexOf(r);
    if (i < 0) return false;
    armed.splice(i, 1);
    const parked = r._x!._parked!;
    deleteFromHeap(r, dirtyQueue);
    r._flags &= ~(REACTIVE_DIRTY | REACTIVE_CHECK);
    r._x!._parked = undefined;
    releaseFlightTeardown(r);
    try {
      handleAsync(r, parked.then());
    } catch {}
    r._x!._blocked = true;
    notifyStatus(r, STATUS_PENDING, new NotReadyError(r));
    return true;
  }
  // A sync memo re-derived at a landing voids its readers' held runs: they
  // re-run in the landing's frame (F-1).
  if (!((r as any)._type || r._config & CONFIG_ASYNC))
    for (let s = r._subs; s !== null; s = s._nextSub) {
      const e = s._sub as any;
      if (e._type && e._modified) {
        e._modified = false;
        enqueueSub(e);
      }
      arm(e);
    }
  arm(r);
  return false;
};
const arm = (r: Computed<any>): unknown =>
  r._x?._parked &&
  !(r._flags & (REACTIVE_DIRTY | REACTIVE_CHECK | REACTIVE_IN_HEAP)) &&
  !armed.includes(r) &&
  armed.push(r);

/** The seam's park step (lanes.ts `laneSeams`, `lanesBlocked`). `r` set:
 * its probe is unanswered, truthy when nothing re-derives. `r` null: does
 * hold `t` wait on a parked flight. Both null: the seam's end, clear. */
function r5(r: Computed<any> | null, t: Transaction | null): unknown {
  if (!r) {
    if (t) return parkUp(t);
    armed.length = 0;
    left.clear();
    return;
  }
  if (isThenable(r._x?._inFlight)) {
    if (!blocked(t!)) return 1;
    park(r, t!);
    // Seated from its first read, so a plain read before its window does not ask again (D-25).
    seat(r, t!);
  } else if (blocked(t!)) {
    if (left.has(r)) seat(r, t!);
    // Async memos over a sync reader: their frame flights are adopted too (F-9).
    for (let s = r._subs, n; s; s = s._nextSub)
      if (
        isThenable((n = s._sub)._x?._inFlight) &&
        n._x!._pendingSources?.has(n) &&
        n._config & CONFIG_HELD &&
        txOf(n) === t &&
        // A flight asked over the screen is no frame question.
        !(n._flags & REACTIVE_FRAME_READ)
      ) {
        park(n, t!);
        // An unanswered lane pass `reask` took asks again; nothing else would.
        if (left.get(n)) (seat(n, t!), enqueueSub(n));
      }
  }
}

/** At the flush: writes that net to the tick's start made no change (D-8),
 * so readers with every source unchanged leave the heap and ask nothing
 * (F-9). Verdict readers still re-run. Done here rather than per write: an
 * extra arm in the setter cost it its inlining. */
function revert(): void {
  for (const n of pendingNodes)
    // Netting writes are staged as the committed value itself, so only those
    // reach the comparator. A derivation's staging is an answer, not a write.
    if (
      n._pendingValue === n._value &&
      (!(n as Partial<Computed<any>>)._fn || (n as Computed<any>)._flags & REACTIVE_MANUAL_WRITE)
    )
      unwake(n);
  // Held slots rewritten since the last flush are not in `pendingNodes` (F-10).
  if (heldRewrites.length !== 0) for (const n of heldRewrites.splice(0)) unwake(n);
}
function unwake(n: Signal<any>): void {
  if (n._pendingValue === NOT_PENDING || !isSame(n, tickBase(n), n._pendingValue)) return;
  for (let s = n._subs; s !== null; s = s._nextSub) {
    const sub = s._sub;
    if (
      !(sub._flags & REACTIVE_IN_HEAP) ||
      sub._flags & REACTIVE_MISSED_WAKE ||
      sub._config & CONFIG_VERDICT
    )
      continue;
    let same: unknown = true;
    for (let d = sub._deps; d !== null && same; d = d._nextDep) {
      const dep = d._dep as Computed<any>;
      const fn = (dep as Partial<Computed<any>>)._fn !== undefined;
      // A user write on a derivation counts as a written source (#4991).
      same =
        !(fn && dep._flags & (REACTIVE_IN_HEAP | REACTIVE_DIRTY | REACTIVE_CHECK)) &&
        (dep._pendingValue === NOT_PENDING ||
          (fn && !(dep._flags & REACTIVE_MANUAL_WRITE)) ||
          isSame(dep, tickBase(dep), dep._pendingValue));
    }
    if (same) {
      deleteFromHeap(sub, dirtyQueue);
      sub._flags &= ~(REACTIVE_DIRTY | REACTIVE_CHECK);
    }
  }
}
/** A pass whose every source is at its committed value is a quiet re-ask
 * (F-9). Not under a guess or in a lane, nor with no committed value. */
function pass(el: Computed<any>, tail?: 1): boolean {
  if (!tail) {
    // Not on the extension's literal: writing it on every `_x` would change its shape.
    el._x!._aheadError =
      (el._config & (CONFIG_STAGED_ERROR | CONFIG_HELD)) === (CONFIG_STAGED_ERROR | CONFIG_HELD)
        ? el._pendingValue
        : undefined;
    return false;
  }
  if (guessing || passLane !== null || el._statusFlags & STATUS_UNINITIALIZED) return false;
  for (let d = el._deps; d !== null; d = d._nextDep) {
    const dep = d._dep as Computed<any>;
    if (
      dep._pendingValue !== NOT_PENDING
        ? !isSame(dep, dep._value, dep._pendingValue)
        : (dep as Partial<Computed<any>>)._fn && dep._statusFlags & STATUS_PENDING
    )
      return false;
    if (d === el._depsTail) break;
  }
  return true;
}

installVerdictHooks(
  observeFlight,
  holdWork,
  stageMark,
  keepReaders,
  attachWaits,
  holdStaging,
  adoptParked,
  r5,
  revert,
  pass
);
/** An `affects()` mark on a store record with no node (store/affects.ts). */
GlobalQueue._witnessMark = () => {
  if (probing) probeFound = true;
};
