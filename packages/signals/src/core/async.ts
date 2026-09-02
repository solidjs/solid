import {
  CONFIG_AUTHORITATIVE_OBSERVED,
  CONFIG_CHILD_COMPANIONS,
  CONFIG_AUTO_DISPOSE,
  CONFIG_SYNC,
  EFFECT_TRACKED,
  EFFECT_USER,
  NOT_PENDING,
  REACTIVE_DIRTY,
  REACTIVE_DISPOSED,
  REACTIVE_OPTIMISTIC_DIRTY,
  REACTIVE_ZOMBIE,
  STATUS_ERROR,
  STATUS_PENDING,
  STATUS_UNINITIALIZED
} from "./constants.js";
import { attrHooks } from "./attribution-hooks.js";
import { context, setSignal, untrack, ext, statusNotifierOf } from "./core.js";
import { devTrackHeldPending } from "./invariants.js";
import { emitDiagnostic } from "./dev.js";
import { NotReadyError, StatusError } from "./error.js";
import { trimStaleDeps, unobserved } from "./graph.js";
import { enqueueSub } from "./heap.js";
import { hasActiveOverride, resolveLane, resolveTransition, type OptimisticLane } from "./lanes.js";
import { cleanup } from "./owner.js";
import {
  assignOrMergeLane,
  clock,
  currentTransition,
  dirtyQueue,
  flush,
  GlobalQueue,
  globalQueue,
  insertSubs,
  queuePendingNode,
  schedule,
  zombieQueue
} from "./scheduler.js";
import type { Computed, FirewallSignal, Link } from "./types.js";

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
// Dev-only caller — tree-shaken from prod builds.
function retryReaches(el: Computed<any>, source: any): boolean {
  for (let d = el._deps; d; d = d._nextDep) {
    const dep = ((d._dep as FirewallSignal<unknown>)._firewall || d._dep) as Computed<any>;
    if (dep === source || dep._x?._pendingSources?.has(source)) return true;
  }
  return false;
}

/**
 * A loading-window node hit an unready source (sync throw in recompute, or a
 * NotReadyError-rejected flight): register for the source's settle — the
 * settlePendingSource walk runs off `_pendingSources` + `_blocked` alone —
 * with NO read-visible pending status, no downstream propagation, no
 * transition, no lane registration. Commit #0 keeps serving.
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
  // `?? null`: affects() marks route plain signals (no `_child` slot) through here.
  for (
    let child: FirewallSignal<unknown> | null = el._x?._child ?? null;
    child !== null;
    child = child._nextChild
  ) {
    for (let s = child._subs; s !== null; s = s._nextSub) fn(s._sub, s);
  }
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
// still-broken source simply re-errors. The async dimension needs no twin of
// its own: recovery there passes through a pending window whose re-runners
// set _blocked and ride settlePendingSource. Walks the full dependent graph
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

export function settlePendingSource(el: Computed<any>): void {
  // Invariant: walking a settle implies truth exists. A caller reaching this
  // with an uninitialized source is announcing a settle that has not
  // happened — parked readers would wake into a value that was never
  // produced (the rc.5 regression: the recompute-side walk fired on a
  // projection driver whose first flight was superseded before any commit
  // reached the observable store). "Uninitialized" alone is not the tell,
  // though: a first landing whose commit is transition-held (streamed
  // hydration rides this) parks its value in `_pendingValue` with the flag
  // still set, and a comparator throw on that landing leaves the node
  // uninitialized but errored — both have real truth to reveal. Only an
  // uninitialized node with neither a held value nor an error is a settle
  // that never happened. Silent in production; loud in dev so a future
  // call site that violates the contract fails in its author's test run
  // instead of wedging a downstream app.
  if (__DEV__) {
    const sources = el._x?._pendingSources;
    if (
      el._statusFlags & STATUS_UNINITIALIZED &&
      el._pendingValue === NOT_PENDING &&
      !el._x?._error &&
      // A replacement source makes this a cleanup-only transfer: removing
      // self leaves the source and every propagated dependent parked. No
      // sources (or self alone) would release readers without truth.
      !(sources?.size && (sources.size > 1 || !sources.has(el)))
    ) {
      emitDiagnostic({
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
      });
    }
  }
  // The normal landing path already cleared the source's own set. Superseded
  // re-parks arrive here with an abandoned self entry, which must retire in
  // the same walk as its propagated copies.
  removePendingSource(el, el);
  let scheduled = false;
  let released: Computed<any>[] | undefined;
  const visited = new Set<Computed<any>>();
  // Companion updates no-op without the verdict layer (null hook).
  const updateCompanions = GlobalQueue._updatePendingSignal;
  const settle = (node: Computed<any>) => {
    if (visited.has(node) || !removePendingSource(node, el)) return;
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
      updateCompanions?.(node);
    } else {
      node._statusFlags &= ~STATUS_PENDING;
      if (!errored) setPendingError(node);
      updateCompanions?.(node);
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
  setter?: (value: T) => void
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
  // Attribution hook: a new flight is registered. Fired here (not in the
  // branches below) so every flight shape — plain thenable, iterator, the
  // flattened combinations — is announced exactly once, while the recompute
  // frame that caused it is still on the engine's stack. Not inside a try
  // (#2883 — see attribution-hooks.ts).
  if (__DEV__ && attrHooks !== null) attrHooks.flightStart(el, result as object);
  let syncValue: T;

  // Settle-time transition re-entry. The loading rail is invisible to
  // transactions (#2933): a boundary-caught first load never registers as an
  // async reporter, so its settle — the boundary's fallback -> content
  // reveal — must flow ambiently. The node can still carry a `_transition`
  // stamp (pending-node bookkeeping rides through the stamping sites), and
  // blindly re-entering that stamped, still-incomplete transaction stashed
  // the reveal with it — a deadlock when the transaction's completion
  // depended on the reveal (#2937). An ESCAPED first load did register and
  // keeps transition scheduling; initialized (value-holding) pending settles
  // are the transaction's reveal machinery and always re-enter.
  const settleTransition = () => {
    const transition = resolveTransition(el as any);
    if (
      transition &&
      el._statusFlags & STATUS_UNINITIALIZED &&
      !currentTransition(transition)._asyncReporters.has(el)
    ) {
      // Drop the stale stamp too: the plain settle write (setSignal) and the
      // stash-path restamp both re-enter the transaction through it.
      el._transition = null;
      return;
    }
    globalQueue.initTransition(transition);
  };

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
    settleTransition();
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
  };

  const asyncWrite = (value: T, then?: () => void) => {
    if (el._x?._inFlight !== result) return;
    // If the node was dirtied by a newer write (optimistic override or regular),
    // skip this stale async result — the upcoming flush will recompute the node
    // with the new value, creating a fresh Promise that supersedes this one.
    if (el._flags & (REACTIVE_DIRTY | REACTIVE_OPTIMISTIC_DIRTY)) return;
    settleTransition();
    const wasUninitialized = !!(el._statusFlags & STATUS_UNINITIALIZED);
    // Captured before clearStatus wipes it: a quiet re-ask's landing may be
    // transition-held below, and the displayed value keeps answering the same
    // question until the hold commits — the classification must survive to
    // that reveal or companion synchronization briefly classifies the held
    // old value as pending, a one-frame pulse to direct observers (#3178).
    // A truthy capture implies `_x` exists, so the restore writes it directly.
    const wasReask = el._x?._reask;
    trimStaleDeps(el);
    clearStatus(el);
    if (wasReask) el._x!._reask = true;
    const lane = resolveLane(el as any);
    if (lane) lane._pendingAsync.delete(el);
    // Attribution hook: lets the engine snapshot state before the landing
    // branches, so it can tell whether the plain path's setSignal committed a
    // change (and only then classify it as an async landing).
    if (__DEV__ && attrHooks !== null) attrHooks.asyncStart(el);
    if (setter) {
      setter(value);
      if (wasUninitialized) clearStatus(el, true);
    } else if (el._x?._overrideValue !== undefined) {
      // Optimistic node — resting OR covered by an active override — holds
      // through the shared pending-node path, exactly like a plain async memo,
      // so the commit clears STATUS_UNINITIALIZED (#2806) and elevation to
      // _value happens on this value's OWN transition schedule (A18 as
      // re-ruled 2026-07-07: _value only changes at commit points). With an
      // override active the hold and its eventual commit are unobservable
      // (A17 — every reader sees the override); the revert reveals whatever
      // has committed by then, so corrections reveal atomically with their
      // transition rather than escaping it.
      if (el._pendingValue === NOT_PENDING) queuePendingNode(el);
      el._pendingValue = value;
      if (__DEV__) devTrackHeldPending(el);
      // The hold is a companion-visible write like any other (A13/A19): the
      // clearStatus() above computed its verdict before the hold existed, so
      // isPending must re-derive (the value is not final until commit — V1)
      // and latest() must see the fresh in-flight value (V2). Subscribers are
      // only notified when the hold is visible to them: under an active
      // override every reader sees the override (A17), so waking subs would
      // re-show an unchanged view — the revert is the notification point.
      GlobalQueue._syncCompanions?.(el, value);
      if (!hasActiveOverride(el)) {
        if (__DEV__ && attrHooks !== null) attrHooks.asyncEnd(el, undefined, value, true);
        insertSubs(el);
      } else if (el._config & CONFIG_AUTHORITATIVE_OBSERVED) {
        // A17 silence is stated over ordinary readers; an authoritative-view
        // reader (until()'s predicate) observed this node PAST its override
        // and is waiting for exactly this staged truth. Without the wake the
        // hold deadlocks: the landing waits on the transaction, the
        // transaction on the action, the action on an until() that was never
        // re-notified (#3164). Same selective wake as the equal-landing
        // branch in recompute(). Optional call: the bit implies the
        // optimistic engine WAS consulted, but the hook only installs with
        // it — a bare-core build must not crash here.
        GlobalQueue._notifyAuthoritativeObservers?.(el);
      }
      el._time = clock;
    } else if (lane) {
      // Route through lane's effect queue for independent flushing
      const isEffect = (el as any)._type;
      const prevValue = el._value;
      const equals = el._equals;
      try {
        if ((!isEffect && wasUninitialized) || !equals || !equals(value, prevValue)) {
          el._value = value;
          el._time = clock;
          // The latest() shadow write gives latest() effects independent lanes; the
          // _pendingSignal update is a no-op repeat of the clearStatus() call above
          // (computePendingState doesn't read _value).
          GlobalQueue._syncCompanions?.(el, value);
          insertSubs(el, true);
        }
      } catch (e) {
        // A user comparator throwing during async resolution has no caller to
        // surface to (we're in promise machinery) — route it through the node's
        // error status so boundaries contain it instead of an unhandled
        // rejection (#2837).
        notifyStatus(el, STATUS_ERROR, e);
      }
      // Attribution hook — unconditional, and OUTSIDE the try: rollup's
      // tryCatchDeoptimization retains anything referenced inside a try even
      // behind a folded __DEV__ guard, so even a dev-only flag smuggled out of
      // the commit branch leaves prod residue (#2883). The engine instead
      // detects whether this landing committed by comparing the node against
      // its asyncStart snapshot (see attribution.ts).
      if (__DEV__ && attrHooks !== null) attrHooks.asyncEnd(el, prevValue, value, true);
    } else {
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
      if (__DEV__ && attrHooks !== null) attrHooks.asyncEnd(el, undefined, value, false);
    }
    // First real answer landing: the window closes when the answer becomes
    // OBSERVABLE. A direct commit is observable now; a transition-held write
    // (`_pendingValue` set above or inside setSignal) is not — the verdict's
    // held-value branch is window-gated, and commitPendingNode closes the
    // window when the hold commits, so no one-frame isPending pulse can leak
    // to live observers between the landing and its commit (#2990). The
    // quiet re-ask classification follows the same schedule (#3178).
    if (el._pendingValue === NOT_PENDING) {
      el._loading = false;
      if (wasReask) el._x!._reask = false;
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
    // owner-death backstop, but its disposal list can be zombie-deferred
    // until the SUPERSEDING flight settles. The teardown slot fires at the
    // _inFlight release sites so supersede stops this stream immediately.
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
    // have put it. Deliberately NOT pre-registered at flight start: a
    // non-null `_disposal` reclassifies the node into recompute's deferred
    // (zombie) disposal path, and plain promise flights — the overwhelming
    // majority — must not pay that. Only a flight that actually flattens
    // becomes disposal-bearing, which is exactly the class a directly
    // returned iterable already occupies.
    const registerDeferredClose = (fn: () => void) => {
      if (!el._disposal) el._disposal = fn;
      else if (Array.isArray(el._disposal)) el._disposal.push(fn);
      else el._disposal = [el._disposal, fn];
    };
    (result as PromiseLike<T>).then(
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
      // Loading window: serve commit #0 instead of suspending. No transition
      // is opened — first-flight work on a loadingValue node is loading-class
      // (invisible to boundaries and transitions); the flight itself is
      // already registered in _inFlight and lands through asyncWrite.
      if (el._loading) return el._value;
      globalQueue.initTransition(resolveTransition(el as any));
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
      globalQueue.initTransition(resolveTransition(el as any));
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
  // The pending window is over; its quiet classification dies with it.
  // (Unconditional: _reask is baked into the node literals, so this is a
  // plain store to an existing slot — no shape change.)
  if (el._x !== null) el._x._reask = false;
  el._statusFlags = clearUninitialized ? 0 : el._statusFlags & STATUS_UNINITIALIZED;
  if (el._x?._error) setPendingError(el);
  // Update pending signal for isPending() reactivity (companions only exist
  // once the verdict layer created them, which installs the hooks).
  if (el._x?._pendingSignal || el._x?._latestValueComputed) GlobalQueue._updatePendingSignal!(el);
  if (
    el._x?._child &&
    el._config & CONFIG_CHILD_COMPANIONS &&
    GlobalQueue._updateChildCompanions !== null
  )
    GlobalQueue._updateChildCompanions(el);
  const notify = statusNotifierOf(el);
  if (notify) notify.call(el);
}

export function notifyStatus(
  el: Computed<any>,
  status: number,
  error: any,
  blockStatus?: boolean,
  lane?: OptimisticLane
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
  const isSource = pendingSource === el;
  const isOptimisticBoundary =
    status === STATUS_PENDING && el._x?._overrideValue !== undefined && !isSource;
  const startsBlocking = isOptimisticBoundary && hasActiveOverride(el);

  if (!blockStatus) {
    if (status === STATUS_PENDING && pendingSource) {
      addPendingSource(el, pendingSource);
      el._statusFlags = STATUS_PENDING | (el._statusFlags & STATUS_UNINITIALIZED);
      // Preserve the current source on this propagation so render-effect notification
      // can register every distinct pending source with the transition.
      setPendingError(el, pendingSource, error);
    } else {
      clearPendingSources(el);
      el._statusFlags =
        status | (status !== STATUS_ERROR ? el._statusFlags & STATUS_UNINITIALIZED : 0);
      ext(el)._error = error;
    }
    GlobalQueue._updatePendingSignal?.(el);
    if (
      el._x?._child &&
      el._config & CONFIG_CHILD_COMPANIONS &&
      GlobalQueue._updateChildCompanions !== null
    )
      GlobalQueue._updateChildCompanions(el);
  }

  if (lane && !blockStatus) {
    assignOrMergeLane(el, lane);
  }

  const downstreamBlockStatus = blockStatus || startsBlocking;
  const downstreamLane = blockStatus || isOptimisticBoundary ? undefined : lane;

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
  forEachDependent(el, (sub, link) => {
    sub._time = clock;
    if (
      (status === STATUS_PENDING &&
        pendingSource &&
        !sub._x?._pendingSources?.has(pendingSource)) ||
      (status !== STATUS_PENDING && (sub._x?._error !== error || sub._x?._pendingSources))
    ) {
      // A pending-observer link is the subscription an `isPending` read created.
      // It exists so the observer re-runs when the source settles, but it must
      // not carry a real (non-NotReadyError) error — the synchronous `isPending`
      // read swallows those, and the async path must match. Re-run the observer
      // so `isPending` re-evaluates (to not-pending) instead of forwarding.
      if (link._pendingObserver && status !== STATUS_PENDING && !(error instanceof NotReadyError)) {
        enqueueSub(sub);
        schedule();
        return;
      }
      if (!downstreamBlockStatus && !sub._transition) queuePendingNode(sub);
      notifyStatus(sub, status, error, downstreamBlockStatus, downstreamLane);
    }
  });
}
