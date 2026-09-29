/**
 * `createDeferred` (docs/create-deferred.md): an async memo that may lag the
 * global clock but never leads it.
 *
 * Pay-for-use by construction: the clamp is a compute wrapper over the
 * commit-#0 loading window core already has. Each pass of an answered node
 * re-opens the window (`_loading = true`) before calling the user's compute,
 * so core serves the committed value for an unready result (handleAsync's
 * serve branch, recompute's park) exactly as it serves a loadingValue window,
 * and every landing site closes it again. Nothing in core knows the node is
 * deferred except one optional landing hook (`GlobalQueue._deferredLanded`).
 *
 * The window IS the flight: an open flight is `_loading` on a node in
 * `openFlights`. Every site that makes an answer observable clears `_loading`
 * (asyncWrite, commitPendingNode, the sync-resolve paths), so the mark reads
 * closed the moment the answer is observable even where no hook runs; the set
 * is pruned lazily (the hook, the next pass). The set counts into
 * `activeAffectsMarks`, the verdict's one-compare gate.
 */
import {
  NOT_PENDING,
  REACTIVE_RECOMPUTING_DEPS,
  REACTIVE_REASK,
  STATUS_ERROR,
  STATUS_UNINITIALIZED
} from "./constants.js";
import { settlePendingSource } from "./async.js";
import { context, untrack } from "./core.js";
import { NotReadyError } from "./error.js";
import { InvariantHooks } from "./invariants.js";
import {
  activeTransition,
  GlobalQueue,
  globalQueue,
  queuePendingNode,
  shiftAffectsMarks
} from "./scheduler.js";
import type { Computed, FirewallSignal, Signal } from "./types.js";

type Node = Signal<any> | Computed<any>;

const openFlights = new Set<Computed<any>>();
/** Open flights asked by a quiet re-ask (`refresh`, A24). */
const quietFlights = new Set<Computed<any>>();

/** The verdict mark (markWalk): a loud flight is open on this node. */
export function deferredMark(el: Node): boolean {
  return (
    (el as Computed<any>)._loading === true &&
    openFlights.has(el as Computed<any>) &&
    !quietFlights.has(el as Computed<any>)
  );
}

function unanswered(el: Node): boolean {
  return (
    (el as Computed<any>)._loading === true &&
    openFlights.has(el as Computed<any>) &&
    el._pendingValue === NOT_PENDING &&
    !((el as Computed<any>)._statusFlags & STATUS_ERROR)
  );
}

/**
 * D9: the flight an authoritative reader must park on — `el` itself, or (with
 * a `seen` set) one reachable through its current deps, hopping store
 * firewalls. A flight whose answer has arrived but is held (`_pendingValue`
 * staged) is not waited on: authoritative reads see staged truth (`until`'s
 * contract).
 */
export function unansweredFlight(
  el: Node,
  seen: Set<Node> | null = new Set()
): Computed<any> | undefined {
  if (openFlights.size === 0) return;
  if (unanswered(el)) return el as Computed<any>;
  if (seen === null || seen.has(el)) return;
  seen.add(el);
  const firewall = (el as FirewallSignal<any>)._firewall;
  const found = firewall && unansweredFlight(firewall, seen);
  if (found) return found;
  const comp = el as Computed<any>;
  const tail = comp._flags & REACTIVE_RECOMPUTING_DEPS ? comp._depsTail : undefined;
  if (tail === null) return;
  for (let d = comp._deps ?? null; d !== null; d = d._nextDep) {
    const f = !d._pendingObserver && unansweredFlight(d._dep, seen);
    if (f) return f;
    if (d === tail) break;
  }
}

function openFlight(el: Computed<any>, reask: boolean): void {
  if (!openFlights.has(el)) {
    openFlights.add(el);
    shiftAffectsMarks(1);
    if (reask) quietFlights.add(el);
    // Under a held transition the flip rides the companion's live write (its
    // lane escapes the hold's effect stash, #2887). With none, the live
    // write's override would be reverted at finalize and its reader woken a
    // second time for the same answer: publish committed.
    else GlobalQueue._repollVerdicts?.(el, activeTransition === null);
  } else if (!reask && quietFlights.delete(el)) {
    // A new question supersedes a quiet re-ask: the flight turns loud. A
    // re-ask superseding a loud flight stays loud (applyReask's rule, A24).
    GlobalQueue._repollVerdicts?.(el, activeTransition === null);
  }
  // Never leads (D2): a flight asked inside a flush belongs to this tick. As a
  // pending node of the batch, a transition adopting the batch stamps it, and
  // its landing re-enters the hold (setSignal's held-node arm). After the
  // re-poll: pending nodes commit in queue order, and queued ahead of its
  // companion's staged verdict the node's commit sweep would publish it twice.
  if (globalQueue._running) queuePendingNode(el);
}

/** The flight's answer is observable (or it errored): drop the mark, re-poll
 * the verdicts it covered, and release authoritative readers parked on it
 * (D9 — only an async landing's own settle walk would otherwise find them). */
function closeFlight(el: Computed<any>, snap?: boolean): void {
  if (!openFlights.delete(el)) return;
  quietFlights.delete(el);
  shiftAffectsMarks(-1);
  GlobalQueue._repollVerdicts?.(el, snap);
  settlePendingSource(el);
}

/** The clamp: a compute wrapper that keeps an answered node's window open. */
export function deferredCompute<T>(compute: (prev: T) => T): (prev: T) => T {
  let answered = false;
  return prev => {
    const el = context as Computed<T>;
    // A flight whose answer became observable at a site with no hook (a held
    // landing's commit, a sync-resolved thenable) closed its window already;
    // a rejected one answered with its error (D6).
    if (!el._loading || el._statusFlags & STATUS_ERROR) closeFlight(el);
    // Answered = initialized with the window closed. A loadingValue node is
    // born with the window open: its first flight is the A27 window
    // (verdict-quiet), and it answers when that flight lands.
    answered ||= !el._loading && !(el._statusFlags & STATUS_UNINITIALIZED);
    if (!answered) return compute(prev);
    // recompute carries the re-ask flag through the pass for this read.
    const reask = (el._flags & REACTIVE_REASK) !== 0;
    el._loading = true;
    let result: T;
    try {
      result = compute(prev);
    } catch (e) {
      // The wrapping form (D8): an unready upstream parks the node
      // (recompute's catch, window open). A real error is the answer (D6).
      if (e instanceof NotReadyError) openFlight(el, reask);
      else {
        el._loading = false;
        closeFlight(el);
      }
      throw e;
    }
    let async = false;
    if (typeof result === "object" && result !== null)
      untrack(() => {
        async =
          (result as any)[Symbol.asyncIterator] !== undefined ||
          typeof (result as any).then === "function";
      });
    if (async) openFlight(el, reask);
    else {
      el._loading = false;
      closeFlight(el);
    }
    return result;
  };
}

/** Installs the landing hook; called by `createDeferred`. */
export function installDeferred(): void {
  GlobalQueue._deferredLanded ??= closeFlight;
  if (__DEV__) InvariantHooks.coveredByDeferred = coveredByDeferred;
}

/** INV-4 (dev): a companion covered by a live flight is not a stale verdict. */
function coveredByDeferred(el: Node, seen: Set<Node> = new Set()): boolean {
  if (openFlights.size === 0) return false;
  if (deferredMark(el)) return true;
  if ((el as Computed<any>)._statusFlags & STATUS_ERROR) return false;
  if (seen.has(el)) return false;
  seen.add(el);
  const firewall = (el as FirewallSignal<any>)._firewall;
  if (firewall && coveredByDeferred(firewall, seen)) return true;
  for (let d = (el as Computed<any>)._deps ?? null; d !== null; d = d._nextDep)
    if (coveredByDeferred(d._dep, seen)) return true;
  return false;
}
