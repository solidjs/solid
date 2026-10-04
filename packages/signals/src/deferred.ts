/**
 * `createDeferred` (docs/create-deferred.md): an async memo that may lag the
 * global clock but never leads it — on L2, the hold model.
 *
 * Pay-for-use by construction: the clamp is a compute wrapper over the
 * commit-#0 loading window core already has (A27). Each pass of an answered
 * node re-opens the window (`_loading = true`) before calling the user's
 * compute, so core serves the committed value for an unready result
 * (`handleAsync`'s serve branch, `recompute`'s `parkLoadingWindow`) exactly
 * as it serves a loadingValue window: the pass neither throws nor goes
 * `STATUS_PENDING`, so no frame observes a flight, no flush parks on it, and
 * the write that re-asked the node commits with its tick (D1). Every site
 * that makes an answer observable closes the window again (`asyncWrite`'s
 * equal-value landing, `commitPendingNode` for a staged one, the sync-resolve
 * paths), so the window IS the flight: open while the node is serving a
 * previous answer with a newer one in flight.
 *
 * The verdict (D4) rides the `affects()` mark channel (affects.ts, A24): an
 * open loud flight is a mark on the node — a count `isPending`'s read finds
 * directly or through the probed node's dependencies (`GlobalQueue._marked`),
 * and a pull through a derived store's family (`pullFamily` reads the derive
 * inside the window). The mark's scope is the flight: registered at its
 * start, released at its landing (`GlobalQueue._deferredLanded`, ahead of
 * the landing's write) or — a rejection, a death — at the seam (affects.ts's
 * `onSeam`), each time re-deriving the verdict readers downstream so the
 * flip is pushed where no value notifies anyone.
 *
 * Never leads (D2): a flight asked inside a flush is queued as a pending node
 * of that flush with nothing staged. If the flush parks — a sibling's flight
 * held the write the node was re-asked with — the seam holds the node with
 * the transaction (`holdNode`) like any pending node, and its landing's
 * `setSignal` re-enters the hold (A34 (1)): the answer reveals with the
 * write, never ahead of it. If the flush commits, the sweep's commit of an
 * unstaged node is a no-op (`commitPendingNode` closes the window only for a
 * staged value). Nothing lane-shaped, nothing new in `read()`.
 *
 * Authoritative readers (D9) — `refresh`'s waiter, `until`'s predicate — are
 * served the committed value like everyone else, so they ask this module
 * whether the node (or, for `until`, anything its pass derives from) is an
 * unanswered flight and park on it (`NotReadyError(flight)`); the flight's
 * close wakes them. A flight whose answer is staged under a hold is answered:
 * authoritative reads see staged truth (A17's carve-out).
 */
import { mark, onSeam, unmark } from "./affects.js";
import { handleAsync, isThenable } from "./core/async.js";
import {
  CONFIG_SLOT_NODE,
  CONFIG_VERDICT,
  NOT_PENDING,
  REACTIVE_DISPOSED,
  REACTIVE_REASK,
  REACTIVE_RECOMPUTING_DEPS,
  STATUS_ERROR,
  STATUS_UNINITIALIZED
} from "./core/constants.js";
import { context, untrack } from "./core/core.js";
import { NotReadyError } from "./core/error.js";
import { enqueueSub } from "./core/heap.js";
import { GlobalQueue, globalQueue, queuePendingNode, schedule } from "./core/scheduler.js";
import type { Computed, Signal } from "./core/types.js";

type Node = Signal<any> | Computed<any>;

/** Open flights: answered nodes serving a previous answer with a newer one in
 * flight (`_loading` re-opened by the wrapper). */
const open = new Set<Computed<any>>();
/** The open flights that carry a mark — asked by a new question. A quiet
 * re-ask (`refresh()`, A24) is open but unmarked. */
const loud = new Set<Computed<any>>();

/** D9: is `el` itself an unanswered open flight? A staged answer (held by a
 * transaction) counts as answered — authoritative reads see staged truth; an
 * errored one answered with its error (D6). */
function unanswered(el: Node): boolean {
  const c = el as Computed<any>;
  return (
    c._loading === true &&
    open.has(c) &&
    el._pendingValue === NOT_PENDING &&
    !(c._statusFlags & STATUS_ERROR)
  );
}

/**
 * D9: the flight an authoritative reader must park on — `el` itself, or
 * (with a `seen` set) one reachable through its current dependencies, hopping
 * a store slot node to its family's derive (a read through the family pulls
 * the derive without linking it). Mid-recompute, only the validated prefix of
 * the dependency list is this pass's. One `Set.size` compare when no flight
 * is open.
 */
export function unansweredFlight(
  el: Node,
  seen: Set<Node> | null = new Set()
): Computed<any> | undefined {
  if (open.size === 0) return;
  if (unanswered(el)) return el as Computed<any>;
  if (seen === null || seen.has(el)) return;
  seen.add(el);
  if (el._config & CONFIG_SLOT_NODE) {
    const fw = GlobalQueue._slotDerive?.(el as Signal<any>);
    return fw != null ? unansweredFlight(fw, seen) : undefined;
  }
  const c = el as Computed<any>;
  const tail = c._flags & REACTIVE_RECOMPUTING_DEPS ? c._depsTail : undefined;
  if (tail === null) return;
  for (let d = c._deps ?? null; d !== null; d = d._nextDep) {
    const f = unansweredFlight(d._dep, seen);
    if (f) return f;
    if (d === tail) break;
  }
}

/** The readers downstream of `node` whose answer changed with no value
 * notifying anyone re-derive: verdict readers (`isPending`/`latest` — the
 * mark's push half, as affects.ts's `repoll`), and — at a close — the
 * authoritative readers parked on the flight (D9). Through derivations,
 * stopping at effects. */
function wake(node: Node, flight: Computed<any> | null, seen = new Set<Computed<any>>()): void {
  for (let s = node._subs; s !== null; s = s._nextSub) {
    const sub = s._sub;
    if (seen.has(sub)) continue;
    seen.add(sub);
    if (
      sub._config & CONFIG_VERDICT ||
      (flight !== null && sub._x?._pendingSources?.has(flight) === true)
    )
      enqueueSub(sub);
    if (!(sub as any)._type) wake(sub, flight, seen);
  }
}

function openFlight(el: Computed<any>, reask: boolean): void {
  if (!open.has(el)) {
    open.add(el);
    // A new question marks the node (A24): its verdict readers re-derive now.
    // A quiet re-ask is open — the waiters park on it — but unmarked.
    if (!reask) {
      loud.add(el);
      mark(el);
      wake(el, null);
    }
  } else if (!reask && !loud.has(el)) {
    // A new question supersedes a quiet re-ask: the flight turns loud. A
    // re-ask superseding a loud flight stays loud (A19 exc. 2: the re-ask
    // does not launder the new question).
    loud.add(el);
    mark(el);
    wake(el, null);
  }
  // Never leads (D2): a flight asked inside a flush belongs to that tick. As
  // a pending node of the flush, the seam holds it with the transaction the
  // flush parks into (a sibling's flight holding the write it was asked
  // with), and its landing re-enters the hold. A committing flush leaves an
  // unstaged node untouched.
  if (globalQueue._running) queuePendingNode(el);
}

/** The flight landed (`asyncWrite`, ahead of the write — as `landStatus`
 * clears a plain memo's pending ahead of it, so the verdict readers the
 * write re-runs read the landing as final, A28), or the wrapper saw a sync
 * answer, or the seam found it rejected (D6: the error is the answer) or
 * dead: drop the mark, re-derive the verdicts it covered, release the
 * authoritative readers parked on it. From here the node's non-finality is
 * its staging's (A19 cause iii: a landing held by a transaction reads
 * pending through `heldNotFinal`, exactly as a plain memo's does). */
function closeFlight(el: Computed<any>): void {
  if (!open.delete(el)) return;
  if (loud.delete(el)) unmark(el);
  wake(el, el);
  schedule();
}

/** The seam (affects.ts's `onSeam`, run from its release hook after the
 * landings) — the close for what no landing reports: a rejected flight
 * (`handleError` propagates the error, and the flush its readers schedule
 * brings the seam — the error outranks the verdict from there; a verdict
 * reader that ran in that flush's heap read the mark once more and
 * re-derives), a node disposed mid-flight (its landing is dropped by
 * identity; `disposeChildren` schedules the seam), a window closed with no
 * `asyncWrite` (a stream's buffered yield). */
function seam(): void {
  if (open.size === 0) return;
  for (const el of open)
    if (!el._loading || el._statusFlags & STATUS_ERROR || el._flags & REACTIVE_DISPOSED)
      closeFlight(el);
}

/** The clamp: a compute wrapper that keeps an answered node's window open. */
export function deferredCompute<T>(compute: (prev: T) => T): (prev: T) => T {
  let answered = false;
  return prev => {
    const el = context as Computed<T>;
    // A flight whose answer became observable at a site the seam has not
    // swept yet (a sync-resolved thenable), or that answered with its error
    // (D6), is closed before this pass opens the next.
    if (!el._loading || el._statusFlags & STATUS_ERROR) closeFlight(el);
    // Answered = initialized with the window closed. A loadingValue node is
    // born with the window open: its first flight is the A27 window
    // (verdict-quiet), and it answers when that flight lands.
    answered ||= !el._loading && !(el._statusFlags & STATUS_UNINITIALIZED);
    if (!answered) return compute(prev);
    // `recompute` carries the re-ask flag through the pass for this read.
    const reask = (el._flags & REACTIVE_REASK) !== 0;
    el._loading = true;
    let result: T;
    let async = false;
    try {
      result = compute(prev);
      if (typeof result === "object" && result !== null)
        untrack(() => {
          async = (result as any)[Symbol.asyncIterator] !== undefined || isThenable(result);
        });
      // An async-shaped result is registered here, as a projection's body
      // registers its own flight (`recompute` takes the self-registered
      // value): a thenable that resolves synchronously, or a stream whose
      // first yield is buffered, has LANDED when `handleAsync` returns — the
      // window is closed and no flight opens, so the verdict never flickers
      // for an answer that was never in flight (A10). Only a result still in
      // the air opens one. (A thenable that rejects synchronously throws
      // through here: a real error, or a NotReady the window parks on.)
      if (async) result = handleAsync(el, result as any);
    } catch (e) {
      // The wrapping form (D8): an unready upstream parks the node
      // (`recompute`'s catch, window open). A real error is the answer (D6).
      if (e instanceof NotReadyError) openFlight(el, reask);
      else {
        el._loading = false;
        closeFlight(el);
      }
      throw e;
    }
    if (async && el._loading) openFlight(el, reask);
    else {
      el._loading = false;
      closeFlight(el);
    }
    return result;
  };
}

/** Installs the landing hook and the seam sweep; called by `createDeferred`. */
export function installDeferred(): void {
  if (GlobalQueue._deferredLanded === undefined) {
    GlobalQueue._deferredLanded = closeFlight;
    onSeam(seam);
  }
}
