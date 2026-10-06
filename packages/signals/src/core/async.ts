import {
  CONFIG_AUTO_DISPOSE,
  CONFIG_REDERIVE,
  CONFIG_GUESS,
  CONFIG_OVERRIDE,
  CONFIG_HELD,
  CONFIG_SYNC,
  CONFIG_VERDICT,
  EFFECT_TRACKED,
  EFFECT_USER,
  NOT_PENDING,
  REACTIVE_DIRTY,
  REACTIVE_DISPOSED,
  REACTIVE_ZOMBIE,
  STATUS_ERROR,
  STATUS_PENDING,
  STATUS_UNINITIALIZED
} from "./constants.js";
import { attrHooks } from "./attribution-hooks.js";
import { context, setSignal, untrack, ext, statusNotifierOf } from "./core.js";
import { devTrackHeldPending } from "./invariants.js";
import { emitDiagnostic, reportDiagnostic, watchAsyncTail } from "./dev.js";
import { NotReadyError, StatusError } from "./error.js";
import { trimStaleDeps, unobserved } from "./graph.js";
import { enqueueSub } from "./heap.js";
import { cleanup } from "./owner.js";
import {
  clock,
  flush,
  globalQueue,
  GlobalQueue,
  joinFuture,
  MAINLINE_QUESTION,
  passLane,
  question,
  queuePendingNode,
  schedule,
  txOf
} from "./scheduler.js";
import type { Computed, Link } from "./types.js";

// The lazily-created Set is the ONE container for pending sources. Its
// predecessor — a singular slot promoted to a Set on the second source —
// created dual state whose migration invariant was easy to break: a third
// overlapping source landed beside the Set and removePendingSource refused
// to clear it, stranding the Set members' pending forever (#2893).
export function addPendingSource(el: Computed<any>, source: Computed<any>): boolean {
  if (el._x?._pendingSources?.has(source)) return false;
  (ext(el)._pendingSources ??= new Set()).add(source);
  return true;
}

function removePendingSource(el: Computed<any>, source: Computed<any>): boolean {
  const sources = el._x?._pendingSources;
  if (!sources?.delete(source)) return false;
  if (!sources.size) el._x!._pendingSources = undefined;
  return true;
}

function clearPendingSources(el: Computed<any>): void {
  // This set is node-owned and never shared; dropping the sole reference
  // releases the set and every entry without a redundant clear() walk.
  if (el._x !== null) el._x._pendingSources = undefined;
}

// A rejection-pending only resolves through the settle sweep over the
// SOURCE's subscribers, so it is retryable iff a tracked read created that
// edge: a dep that IS the source, or one whose own pending chain carries it
// (pending sources propagate the origin node, so this covers any depth).
// Also guards branch-local recovery: another dependency may still need the source.
function retryReaches(el: Computed<any>, source: any): boolean {
  for (let d = el._deps; d; d = d._nextDep) {
    const dep = d._dep as Computed<any>;
    if (dep === source || dep._x?._pendingSources?.has(source)) return true;
  }
  return false;
}

/**
 * A loading-window node hit an unready source (sync throw in recompute, or a
 * NotReadyError-rejected flight): register for the source's settle — the
 * settlePendingSource walk runs off `_pendingSources` + `_blocked` alone —
 * with NO read-visible pending status and no downstream propagation. Commit
 * #0 keeps serving.
 */
export function parkLoadingWindow(el: Computed<any>, e: NotReadyError): void {
  ext(el)._blocked = true;
  if (e.source) addPendingSource(el, e.source as Computed<any>);
  // A settled error is the node's answer ("the error stays the answer until
  // this retry can actually run") — the park must not replace it: reads
  // throw `_error` while STATUS_ERROR is set, and overwriting it here leaks
  // a pending-class NotReadyError from a read-invisible park (#2989).
  if (!(el._statusFlags & STATUS_ERROR)) setPendingError(el, e.source as Computed<any>, e);
}

export function setPendingError(el: Computed<any>, source?: Computed<any>, error?: any): void {
  if (!source) {
    if (el._x !== null) el._x._error = null;
    return;
  }
  if (error instanceof NotReadyError && error.source === source) {
    ext(el)._error = error;
    return;
  }
  const current = el._x?._error;
  if (!(current instanceof NotReadyError) || current.source !== source) {
    ext(el)._error = new NotReadyError(source);
  }
}

export function forEachDependent(
  el: Computed<any>,
  fn: (node: Computed<any>, link: Link) => void
): void {
  for (let s = el._subs; s !== null; s = s._nextSub) fn(s._sub, s);
}

// Queue a node to re-run on the next flush (used both when a pending source
// settles and when an `isPending` observer must re-evaluate after a real error):
// shared scheduling helper in heap.ts (tracked effects bypass the heap).

// Settle-time counterpart of unlinkSubs' last-one-out check. A lazy node that
// loses its last subscriber while STATUS_PENDING is exempt from autodispose
// (the in-flight work is an observer), so whatever CLEARS that pending state
// must run the release — otherwise the node stays linked and recomputes
// forever with zero subscribers (#2934). The node's own promise/iterator
// callbacks handle their own release (settleAutodispose in handleAsync); this
// covers derivatively-pending dependents, which have no callbacks of their own.
function releaseIfSettledUnobserved(node: Computed<any>): void {
  (node as any)._fn &&
    node._config & CONFIG_AUTO_DISPOSE &&
    !node._subs &&
    !(node._flags & REACTIVE_ZOMBIE) &&
    !(node._statusFlags & STATUS_PENDING) &&
    unobserved(node);
}

// Error-path sweep: notifyStatus(STATUS_ERROR) clears dependents' pending
// sources through its own recursion (no per-node settle callback), so after
// the propagation completes, walk the same graph for stranded lazy nodes.
// Collect-then-release so unobserved() never unlinks under the walk.
export function releaseSettledDependents(el: Computed<any>): void {
  let candidates: Computed<any>[] | undefined;
  const visited = new Set<Computed<any>>();
  const visit = (node: Computed<any>) => {
    if (visited.has(node)) return;
    visited.add(node);
    if (!node._subs && node._config & CONFIG_AUTO_DISPOSE) (candidates ??= []).push(node);
    forEachDependent(node, visit);
  };
  forEachDependent(el, visit);
  if (candidates) for (const node of candidates) releaseIfSettledUnobserved(node);
}

// Error-dimension twin of settlePendingSource's blocked re-enqueue (#2949):
// a node in STATUS_ERROR that recovers by recomputing to an UNCHANGED value
// fires no value notification — the recovery is completely silent. But a
// dependent that re-ran during the error window consumed its dirty flag and
// committed nothing (the fresh sibling values it read were absorbed into an
// errored run), so its committed value is stale. The propagated error is one
// object identity down the whole dependent tree, and holding it is exactly
// the "blocked on this error" marker — re-enqueue those holders so they
// re-run: fresh values commit and flow, and a dependent with another
// still-broken source simply re-errors. Pending recovery uses
// settlePendingSource to clear inherited status and retry blocked readers.
// Walks the full dependent graph
// (releaseSettledDependents shape): identity holders can sit below an
// intermediate whose own error state has since been scrubbed or replaced
// (e.g. an error boundary's tree node).
export function settleErroredDependents(el: Computed<any>, error: any): void {
  let scheduled = false;
  const visited = new Set<Computed<any>>();
  const visit = (node: Computed<any>) => {
    if (visited.has(node)) return;
    visited.add(node);
    if (node._x?._error === error) {
      enqueueSub(node);
      scheduled = true;
    }
    forEachDependent(node, visit);
  };
  forEachDependent(el, visit);
  if (scheduled) schedule();
}

// Retire `source` from pending state along the dependent graph rooted at `el`.
// By default, `el` is the source whose flight settled or was superseded.
// With a distinct `source`, `el` is a recovered computation that dropped it:
// the source may still be pending, so dependents with another path to it stay pending.
export function settlePendingSource(el: Computed<any>, source: Computed<any> = el): void {
  // Invariant: walking a settle implies truth exists. A caller reaching this
  // with an uninitialized traversal root (`el`) is announcing a settle that has not
  // happened — parked readers would wake into a value that was never
  // produced (the rc.5 regression: the recompute-side walk fired on a
  // projection driver whose first flight was superseded before any commit
  // reached the observable store). "Uninitialized" alone is not the tell,
  // though: a first landing staged for this flush's commit (streamed
  // hydration rides this) parks its value in `_pendingValue` with the flag
  // still set, and a comparator throw on that landing leaves the node
  // uninitialized but errored — both have real truth to reveal. Only an
  // uninitialized node with neither a staged value nor an error is a settle
  // that never happened. A lane derivation's first landing is truth too: it
  // sits in the lane slot until the lane shows (#3648). Silent in
  // production; loud in dev so a future call site that violates the
  // contract fails in its author's test run instead of wedging a downstream
  // app.
  if (__DEV__) {
    const sources = el._x?._pendingSources;
    if (
      el._statusFlags & STATUS_UNINITIALIZED &&
      el._pendingValue === NOT_PENDING &&
      !el._x?._error &&
      !(
        (el._config & (CONFIG_OVERRIDE | CONFIG_GUESS)) === CONFIG_OVERRIDE &&
        el._x!._lane !== NOT_PENDING
      ) &&
      // A replacement source makes this a cleanup-only transfer: removing
      // self leaves the source and every propagated dependent parked. No
      // sources (or self alone) would release readers without truth.
      !(sources?.size && (sources.size > 1 || !sources.has(el)))
    ) {
      // Reported, not thrown: the walk runs from promise machinery with no
      // caller to surface to, so the message must reach the console here —
      // emitDiagnostic alone leaves only the repair-guide footer (#3648).
      reportDiagnostic(
        emitDiagnostic(
          {
            code: "SETTLE_WALK_UNINITIALIZED_SOURCE",
            kind: "lifecycle",
            severity: "error",
            message:
              "[SETTLE_WALK_UNINITIALIZED_SOURCE] settlePendingSource was called on a source that " +
              "never produced a value. Settling parked readers requires truth to reveal — an " +
              "uninitialized source waking its dependents serves them its initial face instead of " +
              "settled data.",
            ownerId: el.id,
            ownerName: (el as any)._name
          },
          el
        )
      );
    }
  }
  // Landing and branch recovery already cleared el's own set. Superseded
  // re-parks can retain an abandoned self entry (source === el), which must
  // retire in the same walk as its propagated copies.
  removePendingSource(el, source);
  let scheduled = false;
  let released: Computed<any>[] | undefined;
  const visited = new Set<Computed<any>>();
  const settle = (node: Computed<any>) => {
    if (
      visited.has(node) ||
      // A conditional dropped this source, but another dependency can still
      // carry it. Only retire pending state inherited through the recovered
      // branch. Deliberately NOT marked visited on this early return: the
      // carrying dependency may itself be a later branch of this same walk
      // (two unchanged memos converging), and its visit must be free to
      // re-examine this node once that branch has retired the source.
      (source !== el && retryReaches(node, source)) ||
      !removePendingSource(node, source)
    )
      // A19: a verdict reader holds no pending of its own (it was re-derived
      // when the source went pending, `propagateStatus`), and a landing
      // equal to the committed value notifies nobody — the source settling
      // is its verdict changing: it runs again.
      return node._config & CONFIG_VERDICT && enqueueSub(node);
    visited.add(node);
    node._time = clock;
    const remaining = node._x?._pendingSources?.values().next().value;
    // STATUS_ERROR + pending sources only coexist via an errored loading
    // window's park (notifyStatus(STATUS_ERROR) clears pending sources
    // otherwise): the settled error stays the answer through the settle —
    // nulling it here would have reads throw `null` until the re-enqueued
    // retry lands, or lose it entirely if that retry parks again (#2989).
    const errored = node._statusFlags & STATUS_ERROR;
    if (remaining) {
      if (!errored) setPendingError(node, remaining);
    } else {
      node._statusFlags &= ~STATUS_PENDING;
      if (!errored) setPendingError(node);
      // L2: a landing resumes the transaction waiting on it (maintainer: "it
      // resumes the sync frame") — a held reader's re-pass over the landed
      // value is that transaction's work, and the flush that carries it
      // parks into it.
      if (node._config & CONFIG_HELD) joinFuture(txOf(node));
      if (node._x?._blocked) {
        enqueueSub(node);
        scheduled = true;
      }
      if (node._x !== null) node._x._blocked = false;
      // Fully settled with nobody watching: release candidate (#2934). Checked
      // again at release time — deferred so unobserved() can't unlink subs
      // lists this walk is still iterating.
      if (!node._subs && node._config & CONFIG_AUTO_DISPOSE) (released ??= []).push(node);
    }
    forEachDependent(node, settle);
  };

  forEachDependent(el, settle);

  // Release before the flush schedule below: unobserved() pulls the node back
  // out of the heap, so the enqueueSub above never recomputes a released node.
  if (released) for (const node of released) releaseIfSettledUnobserved(node);

  if (scheduled) schedule();
}

// Object-thenable detection (Promises/A+ shape).
export function isThenable<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
  return (
    value != null &&
    typeof value === "object" &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

/** Fire and clear a node's iterator-flight cancellation hook (#3122). */
export function releaseFlightTeardown(el: Computed<any>): void {
  const teardown = el._x?._flightTeardown;
  if (teardown != null) {
    el._x!._flightTeardown = null;
    teardown();
  }
}

export function handleAsync<T>(
  el: Computed<T>,
  result: T | PromiseLike<T> | AsyncIterable<T>,
  setter?: (value: T) => void,
  // The flight rejected (after the node's status is set): a projection
  // tells its leaves' readers, who are not the node's dependents
  // (store/projection.ts). `pending`: a NotReady rejection — the node is
  // pending on another source, not errored.
  onError?: (error: unknown, pending: boolean) => void
): T {
  let iterator: any = false;
  let thenable = false;
  if (typeof result === "object" && result !== null) {
    untrack(() => {
      iterator = (result as any)[Symbol.asyncIterator];
      thenable = !iterator && isThenable(result as T | PromiseLike<T>);
    });
  }

  if (!thenable && !iterator) {
    if (el._x !== null) el._x._inFlight = null;
    // A sync landing is the first real answer for a loadingValue node.
    el._loading = false;
    return result as T;
  }

  // Dev-only contract enforcement for `sync: true` nodes. In production these
  // never reach `handleAsync` (the recompute fast path skips the call), but in
  // dev they do — we run the full async-shape probe and diagnose if a Promise
  // / AsyncIterable comes through. The fast-path semantics in production would
  // silently store the unawaited value, which is what the user opted out of by
  // passing `sync: true`; the diagnostic surfaces that mistake immediately.
  if (__DEV__ && el._config & CONFIG_SYNC) {
    const message =
      `[SYNC_NODE_RECEIVED_ASYNC] A computed/effect created with \`sync: true\` returned ` +
      `${thenable ? "a Promise" : "an AsyncIterable"}. The value would be stored as-is and ` +
      `never awaited in production; remove \`sync: true\` to use async-aware behavior, or ` +
      `unwrap the value before returning.`;
    emitDiagnostic({
      code: "SYNC_NODE_RECEIVED_ASYNC",
      kind: "lifecycle",
      severity: "error",
      message,
      ownerId: el.id,
      ownerName: (el as any)._name
    });
    throw new Error(message);
  }

  // Flight replacement relies on recompute's supersede release for iterator
  // teardown (#3122): every handleAsync call — including the projection
  // self-registration — runs during a recompute of `el`, which has already
  // fired _flightTeardown. A future non-recompute registration path must
  // release it here before overwriting _inFlight.
  ext(el)._inFlight = result as PromiseLike<T> | AsyncIterable<T>;
  // The question this flight answers (A18 provenance, lanes.ts): the action
  // whose slice asked it; mainline is always the current question.
  el._x!._q = question || MAINLINE_QUESTION;
  // The run that asked this flight read every input without throwing: an
  // input still in flight was masked for it (an active override, A17), so
  // pending state those inputs propagated onto the node earlier does not
  // describe this answer. Drop it — the flight is the node's pending now.
  // The landing retires only the flight's own entry (landStatus, #3373), so
  // an entry that survived here would hold the node past its own answer.
  el._x!._pendingSources = undefined;
  // Attribution hook: a new flight is registered. Fired here (not in the
  // branches below) so every flight shape — plain thenable, iterator, the
  // flattened combinations — is announced exactly once, while the recompute
  // frame that caused it is still on the engine's stack. Not inside a try
  // (#2883 — see attribution-hooks.ts).
  if (__OBSERVE__ && attrHooks !== null) attrHooks.flightStart(el, result as object);
  let syncValue: T;

  const handleError = (error: any) => {
    if (el._x?._inFlight !== result) return;
    // NotReadyError from rejected promises should be treated as pending, not error
    let stillPending = error instanceof NotReadyError;
    // Dev-only authorship diagnostic (#2987): no edge means a post-`await`
    // FIRST read — untracked, so the source's settle sweep can never find
    // this node and "pending" wedges it (and its boundary) forever while
    // isPending reads false. Fail loud in dev; prod pays no bytes for the
    // forbidden pattern (the wedge stands there, caught during development).
    // Runs BEFORE the loading-window parking below: a non-retryable read is
    // a real error, and the window must not silently park a wedge that can
    // never settle.
    if (__DEV__ && stillPending && !retryReaches(el, (error as NotReadyError).source)) {
      stillPending = false;
      error = new Error(
        "Read of an unresolved async source after an `await`. Reads inside async " +
          "computations only register as dependencies before the first `await`; a source " +
          "first read after it cannot retry when it settles. Read it before the first " +
          "`await` (or restructure so the value is an input)."
      );
    }
    if (stillPending && el._loading) {
      // Loading window: the flight died waiting on an unready source. Keep
      // serving commit #0 — same parking as recompute's catch for sync
      // dependency throws. The dead flight is released so the clock-gated
      // error-retry pull (updateIfNecessary) can also re-ask.
      if (el._x !== null) el._x._inFlight = null;
      parkLoadingWindow(el, error);
      el._time = clock;
      return;
    }
    notifyStatus(el, stillPending ? STATUS_PENDING : STATUS_ERROR, error);
    // A NotReady rejection is a landing into another pending source. The
    // rejected flight will never settle its self entry, so transfer ownership
    // after notifyStatus has propagated the replacement source.
    if (stillPending) settlePendingSource(el);
    el._time = clock;
    // A real error settles derivatively-pending dependents (notifyStatus
    // cleared their pending sources), so stranded lazy ones release here —
    // the error twin of settlePendingSource's release (#2934).
    if (!stillPending) releaseSettledDependents(el);
    onError?.(error, stillPending);
  };

  const asyncWrite = (value: T, then?: () => void) => {
    if (el._x?._inFlight !== result) return;
    // If the node was dirtied by a newer write (optimistic override or regular),
    // skip this stale async result — the upcoming flush will recompute the node
    // with the new value, creating a fresh Promise that supersedes this one.
    if (el._flags & REACTIVE_DIRTY) return;
    const wasUninitialized = !!(el._statusFlags & STATUS_UNINITIALIZED);
    landStatus(el);
    // Attribution hook: lets the engine snapshot state before the landing
    // branches, so it can tell whether the plain path's setSignal committed a
    // change (and only then classify it as an async landing).
    if (__OBSERVE__ && attrHooks !== null) attrHooks.asyncStart(el);
    if (setter) {
      try {
        setter(value);
      } catch (error) {
        handleError(error);
        return;
      }
      if (wasUninitialized) landStatus(el, true);
    } else {
      // CARVE 2: the override-covered landing (hold + A18 supersession) and the
      // lane-routed landing (derived override, lane effect queue) went with
      // the optimistic engine; every landing is the plain setSignal.
      try {
        setSignal(el, () => value);
      } catch (e) {
        // Same containment as above: setSignal's comparator throw is the only
        // pre-commit failure here, and there is no user callsite to throw to.
        notifyStatus(el, STATUS_ERROR, e);
      }
      // Attribution hook: this path landed through setSignal, whose write
      // hook already saw any committed change — direct=false lets the engine
      // reclassify that write as an async landing iff it actually committed.
      // Outside the try (#2883 — see attribution-hooks.ts).
      if (__OBSERVE__ && attrHooks !== null) attrHooks.asyncEnd(el, undefined, value, false);
    }
    // First real answer landing: the window closes when the answer becomes
    // OBSERVABLE. A direct commit is observable now; a staged write
    // (`_pendingValue` set inside setSignal) is not — commitPendingNode closes
    // the window when the flush commits it, so no one-frame pulse can leak to
    // observers between the landing and its commit (#2990).
    if (el._pendingValue === NOT_PENDING) {
      el._loading = false;
      // The landing published: the dependency tail the flight's pass left
      // linked goes now (A30, #3410). A staged landing has not replaced the
      // committed frame yet; `commitPendingNode` trims it.
      trimStaleDeps(el);
    }
    settlePendingSource(el);
    schedule();
    flush();
    then?.();
  };

  // A pending node's in-flight promise is an observer: `unlinkSubs` skips
  // autodispose while STATUS_PENDING so subscriber churn can't orphan the
  // work (a lazy async memo would otherwise tear down and re-execute — one
  // fetch per suspended re-read). Settling is that observer's release, so
  // it runs the same last-one-out check the other release sites run.
  // Returns whether the node released, so the iterator branch can stop
  // pulling values instead of pumping an unobserved stream forever (#2935).
  const settleAutodispose = (): boolean => {
    if (el._config & CONFIG_AUTO_DISPOSE && !el._subs && !(el._statusFlags & STATUS_PENDING)) {
      unobserved(el as Computed<unknown>);
      return true;
    }
    return false;
  };

  // Consumes an AsyncIterable as this flight's value stream. Two postures:
  // LIVE (called synchronously from this read — the compute returned an
  // iterable directly, or a sync-settled thenable held one), where the
  // initial drain may stash a sync first yield for the caller to return and
  // close registration uses the ambient owner; and DEFERRED (the flattening
  // path — a thenable resolved to an iterable in a later microtask), where
  // there is no caller to serve and no ambient owner: sync-settled steps
  // write through asyncWrite, and close registration goes through the slot
  // the thenable branch pre-registered while it still owned the context.
  // Returns whether a sync answer landed (first yield or empty completion) —
  // meaningful only in the live posture.
  const consumeIterator = (
    source: AsyncIterable<T>,
    registerClose?: (fn: () => void) => void
  ): boolean => {
    const it = source[Symbol.asyncIterator]();
    let hadValue = false;
    let completed = false;
    let initialRead = !registerClose;

    const close = () => {
      if (completed) return;
      completed = true;
      try {
        const returned = it.return?.();
        if (isThenable(returned)) returned.then(undefined, () => {});
      } catch {}
    };
    registerClose ? registerClose(close) : cleanup(close);
    // Flight-identity cancellation (#3122): the registration above is the
    // owner-death backstop; the teardown slot fires at the _inFlight release
    // sites so supersede stops this stream immediately.
    ext(el)._flightTeardown = close;

    // Release check before each next pull: an unobserved lazy node must tear
    // down (its close above runs via disposal, closing the iterator) instead
    // of pumping the stream forever with zero subscribers (#2935).
    const iterateOrRelease = () => {
      if (!settleAutodispose()) iterate();
    };

    const iterate = (): boolean => {
      let syncResult: IteratorResult<T>,
        syncError: unknown,
        resolved = false,
        rejected = false,
        isSync = true;
      // Protocol tolerance, matching `for await`: `await` unwraps whatever
      // next() returns — a thenable OR a bare IteratorResult. Real producers
      // use the bare form as a promise-free fast path when a value is already
      // buffered (seroval's deserialized streams do), so a bare result is
      // assimilated as an already-settled step instead of crashing on `.then`.
      const step = it.next();
      const settled: PromiseLike<IteratorResult<T>> = isThenable(step)
        ? step
        : { then: onSettle => void onSettle!(step) as any };
      settled.then(
        r => {
          // The sync stash only serves the INITIAL drain (handleAsync's caller
          // consumes syncValue / throws NotReady from it). A sync-settled step
          // after an async gap — seroval buffering values between pulls, a
          // sync-thenable producer mid-stream — has no caller reading the
          // stash: it must write through the async path or the value is
          // silently dropped. (The deferred posture never has a caller, so
          // initialRead starts false there and everything writes through.)
          if (isSync && initialRead) {
            syncResult = r;
            resolved = true;
            if (r.done) completed = true;
          } else if (el._x?._inFlight !== result) {
            return;
          } else if (!r.done) {
            hadValue = true;
            asyncWrite(r.value, iterateOrRelease);
          } else {
            completed = true;
            if (hadValue) {
              schedule();
              flush();
            } else {
              // Empty completion settles like the immediately-done sync path.
              asyncWrite(undefined as T);
            }
            settleAutodispose();
          }
        },
        e => {
          if (isSync && initialRead) {
            syncError = e;
            rejected = true;
          } else if (el._x?._inFlight === result) {
            completed = true;
            handleError(e);
            settleAutodispose();
          }
        }
      );
      isSync = false;
      if (rejected) {
        // Match the promise branch, but only rethrow during the initial read.
        completed = true;
        handleError(syncError);
        if (initialRead) throw syncError;
        return true;
      }
      if (resolved && !syncResult!.done) {
        syncValue = syncResult!.value;
        hadValue = true;
        return iterate();
      }
      return resolved && syncResult!.done;
    };

    const immediatelyDone = iterate();
    // Later iterate() calls run from asyncWrite, where rethrowing would be unhandled.
    initialRead = false;
    return hadValue || immediatelyDone;
  };

  // Landed-synchronously verdict for a LIVE iterator drain; null when no live
  // drain ran (plain promise flight, or a deferred flatten). Drives the
  // shared NotReady/loading tail below.
  let liveLanded: boolean | null = null;

  // Flatten one async level: a thenable that RESOLVES to an AsyncIterable —
  // the shape every async stub returning a stream produces — consumes as the
  // stream itself rather than settling on the iterable object. One level
  // only: A+ `then` already collapses nested thenables, so the resolved
  // value is never itself a thenable.
  const flattenIfIterable = (value: any, registerClose?: (fn: () => void) => void): boolean => {
    let innerIterator: any = false;
    if (typeof value === "object" && value !== null) {
      untrack(() => {
        innerIterator = value[Symbol.asyncIterator];
      });
    }
    if (!innerIterator) return false;
    const landed = consumeIterator(value as AsyncIterable<T>, registerClose);
    if (!registerClose) liveLanded = landed;
    return true;
  };

  if (thenable) {
    let resolved = false,
      rejected = false,
      syncError: any,
      isSync = true;
    // Close registration for the flattening path. Consumption starts in a
    // microtask where the ambient owner is gone (or worse, someone else's),
    // so `cleanup()` can't be used — the close targets el's disposal list
    // directly, exactly where a live cleanup() during this recompute would
    // have put it. Only a flight that actually flattens becomes
    // disposal-bearing.
    const registerDeferredClose = (fn: () => void) => {
      if (!el._disposal) el._disposal = fn;
      else if (Array.isArray(el._disposal)) el._disposal.push(fn);
      else el._disposal = [el._disposal, fn];
    };
    (__DEV__ ? watchAsyncTail(el, result as PromiseLike<T>) : (result as PromiseLike<T>)).then(
      v => {
        if (isSync) {
          syncValue = v;
          resolved = true;
        } else if (
          el._x?._inFlight === result &&
          !(el._flags & REACTIVE_DISPOSED) &&
          flattenIfIterable(v, registerDeferredClose)
        ) {
          // Flattened: the stream is the value. Each yield lands through
          // asyncWrite under this flight's identity; the first one clears
          // pending exactly like a plain promise resolution would have.
          // (Disposed nodes never start a pump — their disposal list has
          // already run, so nothing could ever close the iterator.)
        } else {
          asyncWrite(v);
          settleAutodispose();
        }
      },
      e => {
        if (isSync) {
          syncError = e;
          rejected = true;
        } else {
          handleError(e);
          settleAutodispose();
        }
      }
    );
    isSync = false;
    if (rejected) {
      // Settle through the same status path an async rejection uses, then
      // unwind the in-progress synchronous read so the errored node isn't
      // momentarily read as `undefined`.
      handleError(syncError);
      throw syncError;
    } else if (!resolved) {
      // Loading window: serve commit #0 instead of suspending — first-flight
      // work on a loadingValue node is loading-class (invisible to
      // boundaries); the flight itself is already registered in _inFlight and
      // lands through asyncWrite.
      if (el._loading) return el._value;
      throw new NotReadyError(context!);
    } else if (!flattenIfIterable(syncValue!)) {
      // Synchronously-resolved promise: the first real answer landed.
      el._loading = false;
    }
    // A sync-resolved promise holding an AsyncIterable flattened LIVE (we
    // are still inside the synchronous read): full initial-drain semantics
    // apply and the shared tail below settles the verdict.
  }

  if (iterator) flattenIfIterable(result);

  if (liveLanded !== null) {
    if (!liveLanded) {
      // Loading window: serve commit #0 (see the promise branch above).
      if (el._loading) return el._value;
      throw new NotReadyError(context!);
    }
    // A sync first yield (or immediate empty completion) is the first real
    // answer; async yields clear inside asyncWrite.
    el._loading = false;
  }

  return syncValue!;
}

export function clearStatus(el: Computed<any>, clearUninitialized: boolean = false): void {
  if (el._x?._pendingSources) clearPendingSources(el);
  if (el._x?._blocked) if (el._x !== null) el._x._blocked = false;
  el._statusFlags = clearUninitialized ? 0 : el._statusFlags & STATUS_UNINITIALIZED;
  if (el._x?._error) setPendingError(el);
  const notify = statusNotifierOf(el);
  if (notify) notify.call(el);
}

/**
 * Status clear for a flight LANDING (asyncWrite). A landing answers the
 * node's OWN question — it retires the node's self entry, not the pending
 * state its sources propagated onto it. An input re-asked while this flight
 * was up (a second write to the signal feeding `a` while `b`'s first flight
 * is in the air, #3373) marks `b` pending on `a` by propagation, with `b`'s
 * flight still current: nothing superseded it (the re-ask only changed `a`'s
 * status, not yet its value), so the landing arrives, and a full clear made
 * `b` answer with the stale value — the newer signal committed beside the
 * older derived value (`2 / 1`) for the gap (#3376).
 * With another source still pending the node stays derivatively pending on
 * it; the landed value is written below (the staged answer is still the
 * answer for the inputs it was asked with) and the input's own settle
 * releases it, or its value change recomputes the node into a fresh flight.
 * `_blocked` clears like a full clear: a landing that passed the `_inFlight`
 * guard was not superseded by a re-run (recompute nulls `_inFlight` first),
 * so the flag is the flight's own registration throw — the input settling
 * unchanged must not re-run the node (an extra flight for the same inputs).
 * The node is already STATUS_PENDING in that branch (only notifyStatus fills
 * the set, with status; a loading-window park cannot coexist with a live
 * flight since registration drops the set), so the flags only change when
 * the first landing retires UNINITIALIZED. `_error` must move off self: a
 * reader thrown NotReady(self) would park on a retired entry. Companions
 * keep their verdict (pending before and after; the write re-syncs them).
 */
function landStatus(el: Computed<any>, clearUninitialized: boolean = false): void {
  const sources = el._x?._pendingSources;
  // (The full clear below drops the set whether or not self was retired first.)
  if (sources && (sources.delete(el), sources.size)) {
    el._x!._blocked = false;
    if (clearUninitialized) el._statusFlags = STATUS_PENDING;
    setPendingError(el, sources.values().next().value);
  } else clearStatus(el, clearUninitialized);
}

export function notifyStatus(
  el: Computed<any>,
  status: number,
  error: any,
  blockStatus?: boolean
): void {
  // Wrap regular errors to track source node
  if (
    status === STATUS_ERROR &&
    !(error instanceof StatusError) &&
    !(error instanceof NotReadyError)
  )
    error = new StatusError(el, error);

  const pendingSource =
    status === STATUS_PENDING && error instanceof NotReadyError ? error.source : undefined;
  // (CARVE 2: the lane assignment went with the engine.)

  if (!blockStatus) {
    if (status === STATUS_PENDING && pendingSource) {
      addPendingSource(el, pendingSource);
      el._statusFlags = STATUS_PENDING | (el._statusFlags & STATUS_UNINITIALIZED);
      // Preserve the current source on this propagation so readers park on
      // the distinct pending source.
      setPendingError(el, pendingSource, error);
    } else {
      clearPendingSources(el);
      el._statusFlags =
        status | (status !== STATUS_ERROR ? el._statusFlags & STATUS_UNINITIALIZED : 0);
      ext(el)._error = error;
    }
  }

  const downstreamBlockStatus = blockStatus;

  // Lanes: a written guess is an optimistic boundary (A17 — "the optimistic
  // future value until we know otherwise"). Its own source in flight is its
  // status, not its readers': they read the guess. The flight is the parent
  // transition's to wait on — the frame it was asked in holds (A17: "a
  // transition whose optimistic node is still pending on its own fetch is
  // not complete"), through the node itself (`blocked`).
  if (status === STATUS_PENDING && el._config & CONFIG_GUESS) {
    if (passLane === null) joinFuture(null);
    return;
  }

  const elNotify = statusNotifierOf(el);
  if (elNotify) {
    if (blockStatus && status === STATUS_PENDING) {
      return;
    }
    if (downstreamBlockStatus) {
      elNotify.call(el, status, error);
    } else {
      elNotify.call(el);
    }
    return;
  }
  propagateStatus(el, status, error, downstreamBlockStatus);
}

/** The dependents' half of `notifyStatus`: `el`'s status reaches each
 * subscriber as a propagated mark (or a re-derive). On its own for a store
 * family's leaves, which are not the derive's dependents — the family
 * propagates the derive's status from each leaf to the leaf's readers
 * (store/projection.ts `wakeFamily`), exactly as a memo's would reach its. */
export function propagateStatus(
  el: Computed<any>,
  status: number,
  error: any,
  downstreamBlockStatus?: boolean
): void {
  const pendingSource =
    status === STATUS_PENDING && error instanceof NotReadyError ? error.source : undefined;
  forEachDependent(el, (sub, link) => {
    sub._time = clock;
    // A pending mark on a kept-tail link re-derives the subscriber instead of
    // marking it (A30, #3494 review; fuzzer latest-1 #2141; #3519 review).
    // Past `_depsTail` lie the committed frame's deps, kept by A30 because
    // that frame still derives from them while the pass that dropped them is
    // staged. A source going pending there is a question for the node's NEXT
    // pass, not a fact about its current one. Re-derived, the pass decides:
    // it reads the dep and registers through its own read, or reads neither
    // and is done. Clears and errors still ride every link. A link inside the prefix carries the
    // pass's generation (`link()`), so the test is O(1); mid-pass the prefix
    // is what the pass has read so far, and the heap refuses a recomputing
    // node — a dep it has yet to reach registers through its own read.
    // A verdict reader likewise (CONFIG_VERDICT), for either status: the
    // dependency going pending or erroring changed what `isPending`/`latest`
    // answer, so its pass runs again — it decides, breaking out as the
    // verdict lane's, going pending through a plain read of its own, or
    // answering an errored source (`isPending` false; `latest` throws it).
    // Inheriting the error would make a probe's reader errored. A boundary's
    // output (CONFIG_REDERIVE, boundaries.ts) the same: content or fallback
    // is its pass's call.
    if (
      sub._config & (CONFIG_REDERIVE | CONFIG_VERDICT) ||
      (status === STATUS_PENDING && link._gen !== sub._depGen)
    ) {
      enqueueSub(sub);
      schedule();
      return;
    }
    // Already pending on this source (a re-ask of its flight): the status is
    // unchanged and nothing re-notifies. The re-asking write is held with the
    // flight the observer waits on (fuzzer #3446 P1): the propagation joins
    // the observer's transaction. An independent render effect in the same
    // frame still passes through — its pass is the frame's (#3372, compiled
    // shape: the unmount it stages makes the observer a zombie whose say is
    // moot for this transaction, A15 #3463).
    if (status === STATUS_PENDING && pendingSource && sub._x?._pendingSources?.has(pendingSource)) {
      if (
        passLane === null &&
        (sub._config & (CONFIG_HELD | CONFIG_OVERRIDE)) === CONFIG_HELD &&
        globalQueue._running
      )
        joinFuture(txOf(sub));
      return;
    }
    if (
      (status === STATUS_PENDING && pendingSource) ||
      (status !== STATUS_PENDING && (sub._x?._error !== error || sub._x?._pendingSources))
    ) {
      // The marked subscriber is queued for the commit sweep so its status
      // bookkeeping (loading window, uninitialized clear) runs with the flush
      // — with the lane, when the pass propagating is the lane's work and
      // the dependent's pending is the lane's own flight (`lanePending`).
      if (!downstreamBlockStatus) {
        if (passLane === null || !GlobalQueue._lanePending!(sub, el, passLane)) {
          queuePendingNode(sub);
          // A15 (#3443): pending propagates onto a held memo without
          // recomputing it, and the propagation itself enters the memo's
          // transaction — the flight flows into a memo that transaction
          // holds, so the write that started it is held with it. A render
          // effect's membership is its pass's (`notify`), never sticky.
          if (
            status === STATUS_PENDING &&
            (sub._config & (CONFIG_HELD | CONFIG_OVERRIDE)) === CONFIG_HELD &&
            !(sub as any)._type
          )
            joinFuture(txOf(sub));
        }
      }
      notifyStatus(sub, status, error, downstreamBlockStatus);
    }
  });
}
