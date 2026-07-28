import {
  CONFIG_AUTO_DISPOSE,
  CONFIG_SYNC,
  EFFECT_TRACKED,
  EFFECT_USER,
  NOT_PENDING,
  REACTIVE_DIRTY,
  REACTIVE_OPTIMISTIC_DIRTY,
  REACTIVE_ZOMBIE,
  STATUS_ERROR,
  STATUS_PENDING,
  STATUS_UNINITIALIZED
} from "./constants.js";
import { context, setSignal, untrack } from "./core.js";
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
  if (el._pendingSources?.has(source)) return false;
  (el._pendingSources ??= new Set()).add(source);
  return true;
}

function removePendingSource(el: Computed<any>, source: Computed<any>): boolean {
  if (!el._pendingSources?.delete(source)) return false;
  if (el._pendingSources.size === 0) el._pendingSources = undefined;
  return true;
}

function clearPendingSources(el: Computed<any>): void {
  el._pendingSources?.clear();
  el._pendingSources = undefined;
}

export function setPendingError(el: Computed<any>, source?: Computed<any>, error?: any): void {
  if (!source) {
    el._error = null;
    return;
  }
  if (error instanceof NotReadyError && error.source === source) {
    el._error = error;
    return;
  }
  const current = el._error;
  if (!(current instanceof NotReadyError) || current.source !== source) {
    el._error = new NotReadyError(source);
  }
}

export function forEachDependent(
  el: Computed<any>,
  fn: (node: Computed<any>, link: Link) => void
): void {
  for (let s = el._subs; s !== null; s = s._nextSub) fn(s._sub, s);
  // `?? null`: affects() marks route plain signals (no `_child` slot) through here.
  for (
    let child: FirewallSignal<unknown> | null = el._child ?? null;
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
    if (node._error === error) {
      enqueueSub(node);
      scheduled = true;
    }
    forEachDependent(node, visit);
  };
  forEachDependent(el, visit);
  if (scheduled) schedule();
}

export function settlePendingSource(el: Computed<any>): void {
  let scheduled = false;
  let released: Computed<any>[] | undefined;
  const visited = new Set<Computed<any>>();
  // Companion updates no-op without the verdict layer (null hook).
  const updateCompanions = GlobalQueue._updatePendingSignal;
  const settle = (node: Computed<any>) => {
    if (visited.has(node) || !removePendingSource(node, el)) return;
    visited.add(node);
    node._time = clock;
    const remaining = node._pendingSources?.values().next().value;
    if (remaining) {
      setPendingError(node, remaining);
      updateCompanions !== null && updateCompanions(node);
    } else {
      node._statusFlags &= ~STATUS_PENDING;
      setPendingError(node);
      updateCompanions !== null && updateCompanions(node);
      if (node._blocked) {
        enqueueSub(node);
        scheduled = true;
      }
      node._blocked = false;
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
    el._inFlight = null;
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

  el._inFlight = result as PromiseLike<T> | AsyncIterable<T>;
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
    if (el._inFlight !== result) return;
    settleTransition();
    // NotReadyError from rejected promises should be treated as pending, not error
    const stillPending = error instanceof NotReadyError;
    notifyStatus(el, stillPending ? STATUS_PENDING : STATUS_ERROR, error);
    el._time = clock;
    // A real error settles derivatively-pending dependents (notifyStatus
    // cleared their pending sources), so stranded lazy ones release here —
    // the error twin of settlePendingSource's release (#2934).
    if (!stillPending) releaseSettledDependents(el);
  };

  const asyncWrite = (value: T, then?: () => void) => {
    if (el._inFlight !== result) return;
    // If the node was dirtied by a newer write (optimistic override or regular),
    // skip this stale async result — the upcoming flush will recompute the node
    // with the new value, creating a fresh Promise that supersedes this one.
    if (el._flags & (REACTIVE_DIRTY | REACTIVE_OPTIMISTIC_DIRTY)) return;
    settleTransition();
    const wasUninitialized = !!(el._statusFlags & STATUS_UNINITIALIZED);
    trimStaleDeps(el);
    clearStatus(el);
    const lane = resolveLane(el as any);
    if (lane) lane._pendingAsync.delete(el);
    if (setter) {
      setter(value);
      if (wasUninitialized) clearStatus(el, true);
    } else if (el._overrideValue !== undefined) {
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
      GlobalQueue._syncCompanions !== null && GlobalQueue._syncCompanions(el, value);
      if (!hasActiveOverride(el)) insertSubs(el);
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
          GlobalQueue._syncCompanions !== null && GlobalQueue._syncCompanions(el, value);
          insertSubs(el, true);
        }
      } catch (e) {
        // A user comparator throwing during async resolution has no caller to
        // surface to (we're in promise machinery) — route it through the node's
        // error status so boundaries contain it instead of an unhandled
        // rejection (#2837).
        notifyStatus(el, STATUS_ERROR, e);
      }
    } else {
      try {
        setSignal(el, () => value);
      } catch (e) {
        // Same containment as above: setSignal's comparator throw is the only
        // pre-commit failure here, and there is no user callsite to throw to.
        notifyStatus(el, STATUS_ERROR, e);
      }
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

  if (thenable) {
    let resolved = false,
      rejected = false,
      syncError: any,
      isSync = true;
    (result as PromiseLike<T>).then(
      v => {
        if (isSync) {
          syncValue = v;
          resolved = true;
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
      globalQueue.initTransition(resolveTransition(el as any));
      throw new NotReadyError(context!);
    }
  }

  if (iterator) {
    const it = (result as AsyncIterable<T>)[Symbol.asyncIterator]();
    let hadValue = false;
    let completed = false;
    let initialRead = true;

    cleanup(() => {
      if (completed) return;
      completed = true;
      try {
        const returned = it.return?.();
        if (isThenable(returned)) returned.then(undefined, () => {});
      } catch {}
    });

    // Release check before each next pull: an unobserved lazy node must tear
    // down (its cleanup above closes the iterator) instead of pumping the
    // stream forever with zero subscribers (#2935).
    const iterateOrRelease = () => {
      if (!settleAutodispose()) iterate();
    };

    const iterate = (): boolean => {
      let syncResult: IteratorResult<T>,
        syncError: unknown,
        resolved = false,
        rejected = false,
        isSync = true;
      it.next().then(
        r => {
          if (isSync) {
            syncResult = r;
            resolved = true;
            if (r.done) completed = true;
          } else if (el._inFlight !== result) {
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
          if (isSync) {
            syncError = e;
            rejected = true;
          } else if (el._inFlight === result) {
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
    if (!hadValue && !immediatelyDone) {
      globalQueue.initTransition(resolveTransition(el as any));
      throw new NotReadyError(context!);
    }
  }

  return syncValue!;
}

export function clearStatus(el: Computed<any>, clearUninitialized: boolean = false): void {
  if (el._pendingSources) clearPendingSources(el);
  if (el._blocked) el._blocked = false;
  // The pending window is over; its quiet classification dies with it.
  // (Unconditional: _reask is baked into the node literals, so this is a
  // plain store to an existing slot — no shape change.)
  el._reask = false;
  el._statusFlags = clearUninitialized ? 0 : el._statusFlags & STATUS_UNINITIALIZED;
  if (el._error) setPendingError(el);
  // Update pending signal for isPending() reactivity (companions only exist
  // once the verdict layer created them, which installs the hooks).
  if (el._pendingSignal || el._latestValueComputed) GlobalQueue._updatePendingSignal!(el);
  if (el._child && GlobalQueue._updateChildCompanions !== null)
    GlobalQueue._updateChildCompanions(el);
  if (el._notifyStatus) el._notifyStatus();
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
    status === STATUS_PENDING && el._overrideValue !== undefined && !isSource;
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
      el._error = error;
    }
    GlobalQueue._updatePendingSignal !== null && GlobalQueue._updatePendingSignal(el);
    if (el._child && GlobalQueue._updateChildCompanions !== null)
      GlobalQueue._updateChildCompanions(el);
  }

  if (lane && !blockStatus) {
    assignOrMergeLane(el, lane);
  }

  const downstreamBlockStatus = blockStatus || startsBlocking;
  const downstreamLane = blockStatus || isOptimisticBoundary ? undefined : lane;

  if (el._notifyStatus) {
    if (blockStatus && status === STATUS_PENDING) {
      return;
    }
    if (downstreamBlockStatus) {
      el._notifyStatus(status, error);
    } else {
      el._notifyStatus();
    }
    return;
  }
  forEachDependent(el, (sub, link) => {
    sub._time = clock;
    if (
      (status === STATUS_PENDING && pendingSource && !sub._pendingSources?.has(pendingSource)) ||
      (status !== STATUS_PENDING && (sub._error !== error || sub._pendingSources))
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
