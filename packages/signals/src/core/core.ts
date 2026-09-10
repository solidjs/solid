import {
  clearStatus,
  handleAsync,
  notifyStatus,
  parkLoadingWindow,
  releaseFlightTeardown,
  settleErroredDependents,
  settlePendingSource
} from "./async.js";
import {
  CONFIG_FW_CHILDREN,
  $REFRESH,
  CONFIG_AUTO_DISPOSE,
  CONFIG_CHILDREN_FORBIDDEN,
  CONFIG_AUTHORITATIVE_OBSERVED,
  CONFIG_AUTHORITATIVE_READ,
  CONFIG_HELD_TRUTH,
  CONFIG_DIRECT_COMMIT,
  CONFIG_FRESH_READ,
  CONFIG_IN_SNAPSHOT_SCOPE,
  CONFIG_HAS_COMPANIONS,
  CONFIG_HAS_LANE,
  CONFIG_HAS_SNAPSHOT,
  CONFIG_NO_SNAPSHOT,
  CONFIG_OPTIMISTIC,
  CONFIG_OWNED_WRITE,
  CONFIG_SLOT_NODE,
  CONFIG_SYNC,
  CONFIG_TRANSPARENT,
  defaultContext,
  EFFECT_TRACKED,
  EFFECT_USER,
  NO_SNAPSHOT,
  NOT_PENDING,
  OVERRIDE_UNDEFINED,
  unwrapOverride,
  REACTIVE_CHECK,
  REACTIVE_DIRTY,
  REACTIVE_DISPOSED,
  REACTIVE_IN_HEAP,
  REACTIVE_IN_HEAP_HEIGHT,
  REACTIVE_LAZY,
  REACTIVE_MANUAL_WRITE,
  REACTIVE_MISSED_WAKE,
  REACTIVE_NONE,
  REACTIVE_OPTIMISTIC_DIRTY,
  REACTIVE_REASK,
  REACTIVE_RECOMPUTING_DEPS,
  REACTIVE_SNAPSHOT_STALE,
  CONFIG_UNFLUSHED,
  STATUS_ERROR,
  STATUS_PENDING,
  STATUS_UNINITIALIZED,
  STORE_SNAPSHOT_PROPS,
  type Refreshable
} from "./constants.js";
import { NotReadyError } from "./error.js";
import { dormantNodes, link, trimStaleDeps } from "./graph.js";
import {
  deleteFromHeap,
  enqueueSub,
  insertIntoHeap,
  insertIntoHeapHeight,
  markHeap,
  markNode,
  queueFor
} from "./heap.js";
import { hasActiveOverride, type OptimisticLane } from "./lanes.js";
import {
  clearSignals,
  DEV,
  emitDiagnostic,
  GRAPH_SIZE_WARN_AT,
  noteFanIn,
  reportDiagnostic,
  throwPendingUntrackedRead,
  warnStrictReadUntracked
} from "./dev.js";
import { attrHooks } from "./attribution-hooks.js";
import { devTrackHeldPending } from "./invariants.js";
import { cleanup, disposeChildren, inheritId, markDisposal } from "./owner.js";
import type { Transition } from "./scheduler.js";
import {
  reaskArmed,
  activeTransition,
  armReaskClear,
  clock,
  currentTransition,
  dirtyQueue,
  globalQueue,
  GlobalQueue,
  insertSubs,
  projectionWriteActive,
  queuePendingNode,
  runInTransition,
  schedule,
  zombieQueue
} from "./scheduler.js";
import type {
  Computed,
  FirewallSignal,
  Link,
  NodeExtension,
  NodeOptions,
  Owner,
  RawSignal,
  Root,
  Signal
} from "./types.js";

// The heap's per-node step. A tracked effect's heap visit is its compute
// phase — empty, like a user effect whose compute reads nothing — and hands
// the callback to the user queue. Routing the wake through the heap, rather
// than straight into the queue at notify time, is what orders the run after
// the commit regardless of which phase the write came from: a write in a
// render-effect callback stages its value for the next pass, but a wake pushed
// directly into the user queue ran in the SAME pass, read the old value, and
// nothing re-notified it when the value landed (#3291).
GlobalQueue._update = el => {
  if ((el as any)._type === EFFECT_TRACKED) {
    deleteFromHeap(el, queueFor(el));
    (el as any)._modified = true;
    el._queue.enqueue(EFFECT_USER, (el as any)._run);
  } else recompute(el);
};
GlobalQueue._dispose = disposeChildren;

export const PRIMITIVE_IN_FORBIDDEN_SCOPE_MESSAGE =
  "[PRIMITIVE_IN_FORBIDDEN_SCOPE] Cannot create reactive primitives inside createTrackedEffect or owner-backed onSettled";
export const REACTIVE_WRITE_IN_OWNED_SCOPE_SIGNAL_MESSAGE =
  "[REACTIVE_WRITE_IN_OWNED_SCOPE] Writing to reactive state inside an owned scope (component, computation) is not allowed. " +
  "Move the write outside or set the `ownedWrite` option if this is intentional.";
export const REACTIVE_WRITE_IN_OWNED_SCOPE_REFRESH_MESSAGE =
  "[REACTIVE_WRITE_IN_OWNED_SCOPE] Calling refresh() inside an owned scope (component, computation) is not allowed. " +
  "Move the invalidation outside pure computation.";

export let tracking = false;
/** @internal verdict-module glue */
export function setPendingCheckActive(v: boolean): void {
  pendingCheckActive = v;
}
/** @internal verdict-module glue */
export function setLatestReadActive(v: boolean): void {
  latestReadActive = v;
}
/** @internal verdict-module glue */
export function setContextInternal(v: Owner | null): void {
  context = v;
}
export let stale = false;
export let pendingCheckActive = false;
export let latestReadActive = false;
export let context: Owner | null = null;
export let currentOptimisticLane: OptimisticLane | null = null;

export let snapshotCaptureActive = false;
export let snapshotSources: Set<any> | null = null;

function ownerInSnapshotScope(owner: Owner | null): boolean {
  while (owner) {
    if (owner._snapshotScope) return true;
    owner = owner._parent;
  }
  return false;
}

export function setSnapshotCapture(active: boolean): void {
  snapshotCaptureActive = active;
  if (active && !snapshotSources) snapshotSources = new Set();
}

export function markSnapshotScope(owner: Owner): void {
  owner._snapshotScope = true;
}

export function releaseSnapshotScope(owner: Owner): void {
  owner._snapshotScope = false;
  releaseSubtree(owner);
  schedule();
}

function releaseSubtree(owner: Owner): void {
  let child = owner._firstChild;
  while (child) {
    if (child._snapshotScope) {
      child = child._nextSibling;
      continue;
    }
    if ((child as any)._fn) {
      const comp = child as Computed<any>;
      comp._config &= ~CONFIG_IN_SNAPSHOT_SCOPE;
      if (comp._flags & REACTIVE_SNAPSHOT_STALE) {
        comp._flags &= ~REACTIVE_SNAPSHOT_STALE;
        comp._flags |= REACTIVE_DIRTY;
        if (dirtyQueue._min > comp._height) dirtyQueue._min = comp._height;
        insertIntoHeap(comp, dirtyQueue);
      }
    }
    releaseSubtree(child);
    child = child._nextSibling;
  }
}

export function clearSnapshots(): void {
  if (snapshotSources) {
    for (const source of snapshotSources) {
      delete source._x?._snapshotValue;
      // StoreNode targets share one pre-initialized hidden class (see
      // createStoreProxy) — assign undefined instead of deleting, and only
      // when present so signal-node sources don't grow the field.
      if (source[STORE_SNAPSHOT_PROPS] !== undefined) source[STORE_SNAPSHOT_PROPS] = undefined;
    }
    snapshotSources = null;
  }
  snapshotCaptureActive = false;
}

export function recompute(el: Computed<any>, create: boolean = false): void {
  const isEffect = (el as any)._type;
  // Attribution hook: fired before this run touches the dep list — `_deps`
  // still holds the previous run's links (the subscriptions that could have
  // triggered this run, and the baseline for the engine's subscription diff).
  let devChanged = false;
  if (__OBSERVE__ && attrHooks !== null) attrHooks.recomputeStart(el, create);
  if (!create) {
    if (el._transition && (!isEffect || activeTransition) && activeTransition !== el._transition)
      globalQueue.initTransition(el._transition);
    deleteFromHeap(el, queueFor(el));
    if (el._x !== null) {
      el._x._inFlight = null;
      // Supersede is where an iterator flight dies (#3122): close it now.
      // Its cleanup(close) registration may sit in a zombie-deferred
      // disposal list that a held transition only drains when the
      // SUPERSEDING flight settles — cancellation must not wait for the
      // work that replaced it. Idempotent with the cleanup-channel close.
      releaseFlightTeardown(el);
    }
    // Tracked effects run after finalizePureQueue, so dispose immediately instead of deferring
    if (el._transition || isEffect === EFFECT_TRACKED) disposeChildren(el);
    else if (el._firstChild !== null || el._disposal !== null) {
      markDisposal(el);
      const x = ext(el);
      x._pendingDisposal = el._disposal;
      x._pendingFirstChild = el._firstChild;
      el._disposal = null;
      el._firstChild = null;
      el._childCount = 0;
      if (__DEV__) clearSignals(el);
    } else if (__DEV__) clearSignals(el);
  }

  let isOptimisticDirty = !!(el._flags & REACTIVE_OPTIMISTIC_DIRTY);
  const hasOverride =
    (el._config & CONFIG_OPTIMISTIC) !== 0 &&
    el._x?._overrideValue !== NOT_PENDING &&
    el._x?._overrideValue !== undefined;
  const wasUninitialized = !!(el._statusFlags & STATUS_UNINITIALIZED);
  // Outgoing error, captured before the compute clears status: if this run
  // recovers to an unchanged value, dependents still holding this object must
  // be swept (settleErroredDependents, #2949).
  const outgoingError = el._statusFlags & STATUS_ERROR ? el._x?._error : undefined;
  // Pending SOURCE-hood, captured before the compute clears status: a node
  // whose own flight parked dependents self-registers in _pendingSources
  // (notifyStatus, isSource). If this recompute supersedes that flight and
  // settles synchronously, those dependents settle HERE — asyncWrite's
  // settlePendingSource walk never runs for a landing that was preempted
  // (#3181).
  const wasPendingSource = el._x?._pendingSources?.has(el);
  // Re-ask classification lives in the verdict module; capture the flag before
  // the recompute wipes _flags below.
  const hadReask = (el._flags & REACTIVE_REASK) !== 0;
  // Captured before the compute clears it on a sync landing: if that landing
  // is transition-held below, the window must stay open until the hold
  // commits (commitPendingNode) — a closed window plus a held value reads as
  // a pending frame to live observers of the verdict (#2990).
  const wasLoading = el._loading;

  const oldcontext = context;
  context = el;
  el._depsTail = null;
  el._depGen++;
  el._flags = REACTIVE_RECOMPUTING_DEPS;
  el._time = clock;
  let value = el._pendingValue === NOT_PENDING ? el._value : el._pendingValue;
  let oldHeight = el._height;
  let missedWake = false;
  let prevTracking = tracking;
  let prevLane = currentOptimisticLane;
  let prevStrictRead: string | false = false;
  if (__DEV__) {
    prevStrictRead = strictRead;
    strictRead = false;
  }
  tracking = true;
  // A computed's fn establishes its OWN dependencies, so it must never run
  // inside a latest() read window: read() short-circuits through the
  // companion path before dependency linking, so a memo created (eagerly
  // computed) inside latest(fn) came out permanently dependency-less (#2926).
  // latestRead() already suspends the flag for its pull-recomputes; this
  // covers creation-time computes and flushes that run inside the window.
  const prevLatestRead = latestReadActive;
  latestReadActive = false;
  // Lane posture lives with the engine: OPTIMISTIC_DIRTY is only ever set by
  // engine-driven paths, and _optimisticNodes is only pushed by
  // _optimisticWrite, so the hook is installed whenever either gate holds.
  if (isOptimisticDirty) {
    const lane = GlobalQueue._recomputeLane!(el, true);
    if (lane) currentOptimisticLane = lane;
    // `false` = wake-only lane demotion: recompute plain so a mid-tick
    // latest()/isPending() pull stages instead of direct-committing (#3009).
    // The predicate lives with the engine (recomputeLane).
    else if (lane === false) isOptimisticDirty = false;
  } else if (activeTransition && !create && activeTransition._optimisticNodes.length) {
    // Lane adoption: parent-deeper-than-owned-child can run before its OPT-dirty
    // child propagates. Walk deps once and inherit the OPT lane so this node
    // recomputes under the right posture and propagates correctly.
    const lane = GlobalQueue._recomputeLane!(el, false);
    if (lane) {
      isOptimisticDirty = true;
      currentOptimisticLane = lane;
    }
  }
  const isStaleEffect = isEffect && isEffect !== EFFECT_USER;
  const prevStale = stale;
  if (isStaleEffect) stale = true;
  // Writes this run issues (a firewall staging its leaves, a boundary's
  // status signal) are part of this pass: promoted at the tail below, in
  // this run's posture (context, lane, RECOMPUTING_DEPS still set). Local
  // length reads: this is the hottest function in the library, and the
  // common case (a run that wrote nothing) must cost one comparison.
  const unflushedFrom = unflushedNodes.length;
  try {
    if (!__DEV__ && el._config & CONFIG_SYNC) {
      value = el._fn(value);
      if (el._x !== null) el._x._inFlight = null;
      el._loading = false;
    } else {
      // Snapshot `_inFlight` so we can detect whether `_fn` self-registered an async
      // subscription (e.g. `createProjection` calls `handleAsync` from inside its body
      // with a setter callback). In that case, the outer `handleAsync` call below would
      // clobber the fresh subscription, so we skip it and let the internally-registered
      // iteration drive updates.
      const prevInFlight = el._x?._inFlight;
      const fnResult = el._fn(value);
      const isAsyncResult = typeof fnResult === "object" && fnResult !== null;
      const inFlightChanged = el._x?._inFlight !== prevInFlight;
      value = inFlightChanged || !isAsyncResult ? fnResult : handleAsync(el, fnResult);
      if (!inFlightChanged && !isAsyncResult) {
        if (el._x !== null) el._x._inFlight = null;
        // A sync (non-object) return is the first real answer; async-shaped
        // results clear inside handleAsync at their own landing points, and a
        // self-registered flight (inFlightChanged — projections) clears when
        // its internal handleAsync lands.
        el._loading = false;
      }
    }
    // On a status-free node clearStatus is a guaranteed no-op: every field
    // its body gates on is either _statusFlags or lives in the cold
    // extension — no extension, no status to clear. (_x from an unrelated
    // installer just makes clearStatus a cheap re-verified no-op.)
    if (el._statusFlags !== 0 || el._x !== null) clearStatus(el, create);
    // _optimisticLane is only ever assigned by engine paths (CONFIG_HAS_LANE
    // is their sticky presence mark).
    if (el._config & CONFIG_HAS_LANE && el._x?._optimisticLane) GlobalQueue._laneAsyncSettled!(el);
  } catch (e) {
    const notReady = e instanceof NotReadyError;
    if (notReady && el._loading) {
      // Loading window with an unready sync dependency: register for the
      // source's settle (the settlePendingSource walk runs off
      // _pendingSources + _blocked alone) but take NO read-visible pending
      // status, no downstream propagation, no transition, no lane
      // registration — the committed loading value keeps serving. If the
      // node is currently errored the error stays the answer until this
      // retry can actually run.
      parkLoadingWindow(el, e as NotReadyError);
    } else {
      // Track pending async in the lane (not the lane's source — it creates the lane
      // but doesn't belong to it). Set lane BEFORE notifyStatus for downstream propagation.
      if (notReady && currentOptimisticLane) GlobalQueue._laneAsyncPending!(el);
      let reaskChanged = false;
      if (notReady) {
        ext(el)._blocked = true;
        if (GlobalQueue._applyReask !== null) reaskChanged = GlobalQueue._applyReask(el, hadReask);
      }
      notifyStatus(
        el,
        notReady ? STATUS_PENDING : STATUS_ERROR,
        e,
        undefined,
        notReady ? el._x?._optimisticLane : undefined
      );
      // The replacement source is fully propagated now. If no new flight
      // re-owned self, retire the superseded flight and its dependent copies.
      if (notReady && wasPendingSource && !el._x?._inFlight) settlePendingSource(el);
      if (reaskChanged) GlobalQueue._repollVerdicts!(el);
    }
  } finally {
    if (unflushedNodes.length !== unflushedFrom) promoteUnflushed(unflushedFrom);
    tracking = prevTracking;
    latestReadActive = prevLatestRead;
    if (__DEV__) strictRead = prevStrictRead;
    if (isStaleEffect) stale = prevStale;
    // Consume the missed-wake latch (#3037, set by insertSubs): a dep write
    // landed beneath this pass on a link it had already validated. The wipe
    // below must not key off DIRTY/CHECK — the read-time pull protocol
    // (markNode(c) in read()) marks the running node as part of ordinary
    // bookkeeping, and those marks are correctly discarded here.
    missedWake = (el._flags & REACTIVE_MISSED_WAKE) !== 0;
    el._flags = REACTIVE_NONE | (create ? el._flags & REACTIVE_SNAPSHOT_STALE : 0);
    context = oldcontext;
  }

  if (!el._x?._error) {
    trimStaleDeps(el);
    // Observe-tier fan-in (HUGE_FAN_IN): with the stale tail trimmed, the dep
    // list IS this pass's distinct sources — count it here rather than per
    // link. A begin/end bracket around the pass plus a per-link increment
    // measured -5.8% on createRenderEffects:create1to1 (CodSpeed, dev tier)
    // and cost several points of the shape wins elsewhere; this walk is a
    // fraction of the reads that built the list and keeps no module state,
    // so nested pulls need no save/restore.
    if (__OBSERVE__) {
      let fanIn = 0;
      for (let d = el._deps; d !== null; d = d._nextDep) fanIn++;
      if (fanIn >= GRAPH_SIZE_WARN_AT) noteFanIn(el, fanIn);
    }
    // INV-11 (#3330): the equality gate compares against the slot this run
    // publishes to. An override-covered node publishes the override; a lane
    // recompute (OPT-dirty) direct-commits `_value` — the lane's own reveal
    // schedule — so a transaction-held `_pendingValue` that already equals
    // the new result is not "unchanged": the screen still shows `_value`.
    // Only a transaction-staged run compares against `_pendingValue`.
    const compareValue = hasOverride
      ? unwrapOverride(el._x?._overrideValue)
      : isOptimisticDirty || el._pendingValue === NOT_PENDING
        ? el._value
        : el._pendingValue;
    let valueChanged = false;
    try {
      valueChanged =
        (!isEffect && wasUninitialized) || !el._equals || !el._equals(compareValue, value);
    } catch (e) {
      // A throwing user comparator is an error of this node's computation.
      // Route it through the same status path as a compute-phase throw so
      // error boundaries contain it; otherwise it unwinds the scheduler
      // flush, bypassing every boundary and wedging the queue (#2837).
      notifyStatus(el, STATUS_ERROR, e);
    }

    // A committed derived change becomes a cause for this node's subscribers,
    // chaining their attribution through this node to the root write.
    if (__OBSERVE__ && attrHooks !== null) {
      devChanged = valueChanged && !el._x?._error;
      if (devChanged && !isEffect && !create) attrHooks.derivedChanged(el);
    }

    // Effects use `_equals: false` (no per-effect closure). The side effects that
    // the equals closure used to perform — flagging the effect dirty and enqueueing
    // its runner — happen here instead. `!create` matches the previous `initialized`
    // gate: the explicit recompute(node, true) inside effect() does not enqueue, so
    // effect() can call its runner synchronously for the first run.
    if (isEffect && valueChanged) {
      (el as any)._modified = !el._x?._error;
      // Reuse one bound runner per effect — runEffect no-ops on a stale
      // `_modified`, so re-enqueueing the same function is harmless.
      if (!create) {
        el._queue.enqueue(
          isEffect,
          ((el as any)._boundRunEffect ??= GlobalQueue._runEffect.bind(null, el))
        );
        // Contested effect (#3322). Effects don't entangle transactions (a
        // shared effect is not shared state), yet they have one value slot:
        // when this write commits under a different transaction
        // (`activeTransition`, null = mainline) than the one that produced the
        // previous value (`_valueTransition`), that view is gone. Rather than
        // merge the two, each commit re-derives the effect against its own
        // committed world (Transition._contested, re-dirtied by
        // finalizePureQueue ahead of the heap run). The previous owner always
        // needs it if still live: its commit is silent (staging already
        // notified) and the value it computed is gone. The new owner needs it
        // too, for the same reason, unless it is mainline — mainline publishes
        // what it computes. A previous owner that was mainline, or already
        // committed, left nothing to protect.
        let prev: Transition | null = (el as any)._valueTransition;
        if (prev !== activeTransition) {
          (el as any)._valueTransition = activeTransition;
          if (
            prev !== null &&
            (prev = currentTransition(prev)) !== activeTransition &&
            !prev._done
          ) {
            (prev._contested ??= []).push(el);
            if (activeTransition !== null) (activeTransition._contested ??= []).push(el);
          }
        }
      }
    }

    if (el._x?._error) {
      // Comparator threw: skip the commit — the node is now errored and the
      // status propagation above owns downstream notification.
    } else if (valueChanged) {
      const prevVisible = hasOverride ? el._x?._overrideValue : undefined;

      if (
        create ||
        // Plain sync flush (no transition on either side) commits effect
        // values directly — the pending round-trip (queuePendingNode +
        // commitPendingNodes) exists to sequence transition reveals, and
        // paying it per effect on the plain path is pure overhead.
        // DIRECT_COMMIT effects (resolve/until) commit directly even under
        // their own held transition: their applies deliver on a microtask,
        // not the stashed queues, so a staged value would hand the immediate
        // apply stale state — see CONFIG_DIRECT_COMMIT.
        (isEffect &&
          (activeTransition !== el._transition ||
            activeTransition === null ||
            el._config & CONFIG_DIRECT_COMMIT)) ||
        isOptimisticDirty
        // NOTE (stage-3, 2026-08-21): a quiet-world MEMO direct-commit was
        // attempted here and REVERTED — memo staging is load-bearing beyond
        // transitions: mid-batch pulls (latest()/isPending()/read-triggered
        // recomputes before sources commit) must see the fresh value while
        // PLAIN reads stay committed until flush (#3009 purity). The pending
        // round-trip is that separation; it cannot be skipped on any path a
        // pull can reach.
      ) {
        el._value = value;
        // Lane-propagated correction: upstream data is fresh, correct the
        // override unconditionally. The direct _value commit is the lane's
        // own reveal schedule; drop any superseded older hold so its queued
        // commit can't clobber the fresh value.
        if (hasOverride && isOptimisticDirty) {
          ext(el)._overrideValue = value === undefined ? OVERRIDE_UNDEFINED : value;
          el._pendingValue = NOT_PENDING;
        }
      } else {
        el._pendingValue = value;
        if (__DEV__) devTrackHeldPending(el);
        // A window landing that gets held re-opens the window until the hold
        // commits — the verdict's held-value branch is window-gated (#2990).
        if (wasLoading) el._loading = true;
        // Transition-held sync recompute is a write path like setSignal/asyncWrite,
        // so sync derivations of held sources stay visible to isPending()/latest()
        // (#2831). Both companion writes are transition-scoped (optimistic) and
        // auto-revert/re-derive at commit. Skipped for plain flushes where the
        // pending value commits before effects run.
        if ((activeTransition || el._transition) && GlobalQueue._syncCompanions !== null)
          GlobalQueue._syncCompanions(el, value);
      }

      // insertSubs only walks _subs (no scheduling of its own), so a
      // subscriber-less node has nothing to notify.
      if (
        el._subs !== null &&
        (!hasOverride || isOptimisticDirty || el._x?._overrideValue !== prevVisible)
      )
        insertSubs(el, isOptimisticDirty || hasOverride);
    } else if (hasOverride) {
      // Unchanged value (equals the override) recomputed while the override
      // is active: _value may still be stale, so hold the authoritative value
      // for commit on its own transition's schedule — invisibly (A17/A18).
      if (el._pendingValue === NOT_PENDING) queuePendingNode(el);
      el._pendingValue = value;
      if (__DEV__) devTrackHeldPending(el);
      if (wasLoading) el._loading = true; // see the held branch above (#2990)
      // An authoritative-view reader (until()'s predicate, refresh()'s waiter)
      // observed this node past its override — and "authoritative arrival
      // equal to the override" is exactly the acknowledgment it waits for.
      // Wake those readers only; A17 silence holds for every ordinary
      // subscriber. (Hook installed by both setters of the gating bit, #3303.)
      if (el._config & CONFIG_AUTHORITATIVE_OBSERVED)
        GlobalQueue._notifyAuthoritativeObservers!(el);
    } else if (el._height != oldHeight) {
      for (let s = el._subs; s !== null; s = s._nextSub) {
        insertIntoHeapHeight(s._sub, queueFor(s._sub));
      }
    }

    // Silent recovery: errored → unchanged value fires no notification, but
    // dependents still holding the propagated error consumed their dirty flag
    // in an errored run and may sit on stale commits (#2949). Changed-value
    // recoveries ride insertSubs above; a comparator throw re-errored the node
    // (el._x?._error re-set), so this only runs on a genuinely clean recovery.
    if (outgoingError !== undefined && !valueChanged && !el._x?._error)
      settleErroredDependents(el, outgoingError);

    // #3181: a synchronous settle supersedes the old landing callback, so
    // recompute owns its pending-source sweep. An uninitialized node without
    // a replacement source still has no truth to reveal and must stay parked.
    if (wasPendingSource && !(el._statusFlags & (STATUS_PENDING | STATUS_UNINITIALIZED)))
      settlePendingSource(el);
  }
  // Attribution hook: fired before the lane restore so `currentOptimisticLane`
  // still reflects THIS run's posture. The facts distinguish an overlay
  // recompute (optimistic lane, transition replay, transition-held commit)
  // from a plain committed one — the engine must not blame overlay runs as
  // waste or double-count them against plain aggregates.
  if (__OBSERVE__ && attrHooks !== null)
    attrHooks.recomputeEnd(
      el,
      create,
      devChanged,
      isOptimisticDirty || currentOptimisticLane !== null,
      activeTransition !== null || el._transition !== null,
      el._pendingValue !== NOT_PENDING
    );
  currentOptimisticLane = prevLane;
  const needsPendingCommit =
    el._pendingValue !== NOT_PENDING ||
    (el._x !== null && (el._x._pendingFirstChild !== null || el._x._pendingDisposal !== null)) ||
    (el._statusFlags & (STATUS_PENDING | STATUS_UNINITIALIZED)) !== 0;
  // Override-covered holds (hasOverride) always queue: their commit belongs
  // to their own transition's schedule (A18 re-rule) and is unobservable
  // under the override (A17). Revert no longer commits anything, so an
  // unqueued covered hold would leak (INV-7) once the revert clears
  // _transition.
  needsPendingCommit &&
    (!create || el._statusFlags & STATUS_PENDING) &&
    (!el._transition || hasOverride) &&
    queuePendingNode(el);
  el._transition &&
    isEffect &&
    activeTransition !== el._transition &&
    runInTransition(el._transition, () => recompute(el));
  // Missed-wake reschedule (see the finally above): values this pass read
  // before the nested commit are stale, so run again now that the heap will
  // accept the node. Equality gates stop same-value landings from cascading,
  // and a re-run only latches again if another nested commit changes a dep
  // beneath it — convergent unless deps genuinely keep changing.
  if (missedWake) {
    enqueueSub(el);
    schedule();
  }
}

function updateIfNecessary(el: Computed<unknown>): void {
  // Never re-enter a node that is currently computing: its dep bookkeeping
  // (_depsTail/_depGen) is live, and a nested recompute would corrupt it.
  // A mid-pass mark stays latched for recompute's own tail to reschedule
  // (#3037); readers meanwhile serve the values the pass has so far.
  // Never recompute a DISPOSED node either: recompute rewrites _flags and
  // would resurrect it (#2983) — readers serve its last value.
  if (el._flags & (REACTIVE_RECOMPUTING_DEPS | REACTIVE_DISPOSED)) return;
  if (el._flags & REACTIVE_CHECK) {
    for (let d = el._deps; d; d = d._nextDep) {
      const dep1 = d._dep;
      const dep = (dep1 as FirewallSignal<unknown>)._firewall || dep1;
      if ((dep as Computed<unknown>)._fn) {
        updateIfNecessary(dep);
      }
      if (el._flags & REACTIVE_DIRTY) {
        break;
      }
    }
  }

  if (
    el._flags & (REACTIVE_DIRTY | REACTIVE_OPTIMISTIC_DIRTY) ||
    (el._x?._error && el._time < clock && !el._x?._inFlight)
  ) {
    recompute(el);
  }

  el._flags = el._flags & (REACTIVE_SNAPSHOT_STALE | REACTIVE_IN_HEAP | REACTIVE_IN_HEAP_HEIGHT);
}

export function computed<T>(fn: (prev?: T) => T | PromiseLike<T> | AsyncIterable<T>): Computed<T>;
export function computed<T>(
  fn: (prev: T) => T | PromiseLike<T> | AsyncIterable<T>,
  options?: NodeOptions<T>
): Computed<T>;
export function computed<T>(
  fn: (prev?: T) => T | PromiseLike<T> | AsyncIterable<T>,
  options?: NodeOptions<T>
): Computed<T> {
  const transparent = options?.transparent ?? false;
  // `in` (not `!== undefined`): an explicit `loadingValue: undefined` on a
  // `T | undefined` node is a real commit #0. The typeof guard tolerates
  // non-object option values that older call shapes force through `as any`.
  const loading = options !== null && typeof options === "object" && "loadingValue" in options;
  // Two literals, one per tier, selected at build time (the observe flag is
  // a literal after replacement; the untaken branch is dead code). The observe
  // literal is the prod literal plus its `_name` slot — a slot in the
  // boilerplate, because a post-construction `self._name = …` forces a
  // hidden-class transition and an out-of-object property store on EVERY node
  // (measured: the whole of the observe tier's creation overhead). Keep the
  // two in sync — the dist artifact test pins observe's key set to prod's
  // plus `_name`.
  const self: Computed<T> = __OBSERVE__
    ? ({
        id: inheritId(options, transparent, context),
        _config:
          (transparent ? CONFIG_TRANSPARENT : 0) |
          (options?.ownedWrite ? CONFIG_OWNED_WRITE : 0) |
          (!context || options?.lazy ? CONFIG_AUTO_DISPOSE : 0) |
          (options?.sync ? CONFIG_SYNC : 0) |
          (options?._noSnapshot ? CONFIG_NO_SNAPSHOT : 0) |
          (snapshotCaptureActive && ownerInSnapshotScope(context) ? CONFIG_IN_SNAPSHOT_SCOPE : 0),
        _equals: options?.equals ?? isEqual,
        _disposal: null,
        _queue: context?._queue ?? globalQueue,
        _context: context?._context ?? defaultContext,
        _childCount: 0,
        _fn: fn,
        _value: (loading ? options!.loadingValue : undefined) as T,
        _height: 0,
        _nextHeap: undefined,
        _prevHeap: null as any,
        _deps: null,
        _depsTail: null,
        _depGen: 0,
        _subs: null,
        _subsTail: null,
        _parent: context,
        _nextSibling: null,
        _prevSibling: null,
        _firstChild: null,
        _flags: options?.lazy ? REACTIVE_LAZY : REACTIVE_NONE,
        _statusFlags: loading ? 0 : STATUS_UNINITIALIZED,
        _time: clock,
        _pendingValue: NOT_PENDING,
        _transition: null,
        _loading: loading,
        _x: null,
        _name: options?.name ?? "computed"
      } as Computed<T>)
    : ({
        id: inheritId(options, transparent, context),
        _config:
          (transparent ? CONFIG_TRANSPARENT : 0) |
          (options?.ownedWrite ? CONFIG_OWNED_WRITE : 0) |
          (!context || options?.lazy ? CONFIG_AUTO_DISPOSE : 0) |
          (options?.sync ? CONFIG_SYNC : 0) |
          (options?._noSnapshot ? CONFIG_NO_SNAPSHOT : 0) |
          (snapshotCaptureActive && ownerInSnapshotScope(context) ? CONFIG_IN_SNAPSHOT_SCOPE : 0),
        _equals: options?.equals ?? isEqual,
        _disposal: null,
        _queue: context?._queue ?? globalQueue,
        _context: context?._context ?? defaultContext,
        _childCount: 0,
        _fn: fn,
        _value: (loading ? options!.loadingValue : undefined) as T,
        _height: 0,
        _nextHeap: undefined,
        _prevHeap: null as any,
        _deps: null,
        _depsTail: null,
        _depGen: 0,
        _subs: null,
        _subsTail: null,
        _parent: context,
        _nextSibling: null,
        _prevSibling: null,
        _firstChild: null,
        _flags: options?.lazy ? REACTIVE_LAZY : REACTIVE_NONE,
        // A loadingValue node is born committed: commit #0 is already in _value.
        _statusFlags: loading ? 0 : STATUS_UNINITIALIZED,
        _time: clock,
        _pendingValue: NOT_PENDING,
        _transition: null,
        _loading: loading,
        // Cold machinery (async/transition/optimistic/verdict slots) lives one
        // hop away in the lazily-allocated extension — the core literal MUST
        // stay under V8's in-object boundary (§12: past ~39 fields every
        // allocation spills to a backing store and creation cost ~4x's).
        _x: null
      } as Computed<T>);
  if (options?.unobserved) (ext(self) as NodeExtension)._unobserved = options.unobserved;
  setupComputedNode(self, options);
  return self;
}

/** Lazily allocate a node's cold extension (ONE shape for signals and
 * computeds — `_x` access stays monomorphic). Installers write through
 * this; hot paths read `el._x?._field` gated by the _config presence bits.
 * Never call ext() just to store a field's default. */
export function ext(el: { _x: NodeExtension | null }): NodeExtension {
  return (el._x ??= {
    _overrideValue: undefined,
    _overrideOwner: undefined,
    _optimisticLane: undefined,
    _pendingSignal: undefined,
    _latestValueComputed: undefined,
    _flushedStaged: NOT_PENDING,
    _pendingOverride: NOT_PENDING,
    _parentSource: undefined,
    _affectsCount: 0,
    _inFlight: null,
    _flightTeardown: null,
    _error: undefined,
    _blocked: undefined,
    _pendingSources: undefined,
    _notifyStatus: undefined,
    _reask: false,
    _child: null,
    _unobserved: undefined,
    _snapshotValue: undefined,
    _pendingDisposal: null,
    _pendingFirstChild: null,
    _companionChildren: undefined
  });
}

/**
 * Build an Effect node with all effect-specific fields baked into a single object literal,
 * so V8 sees the full hidden class shape at construction time. Effects always run in lazy
 * mode (recompute is called explicitly by `effect()`), so we hardcode the lazy bits and skip
 * the auto-dispose CONFIG bit (effect() previously cleared it post-construction).
 */
export function createEffectNode<T>(
  fn: (prev?: T) => T,
  effectFn: (val: T, prev: T | undefined) => void | (() => void),
  errorFn: ((err: unknown, cleanup: () => void) => void | (() => void)) | undefined,
  type: number,
  options: NodeOptions<T> | undefined
): any {
  const transparent = options?.transparent ?? false;
  // Prod and observe boilerplates — see computed() for why the observe tier
  // gets its `_name` as a literal slot rather than a write after the fact.
  // The default label is the node kind (tracked effects relabel their computed
  // in trackedEffect); the wrappers in signals.ts no longer spread a name into
  // the options to get it.
  const self = __OBSERVE__
    ? ({
        id: inheritId(options, transparent, context),
        _config:
          (transparent ? CONFIG_TRANSPARENT : 0) |
          (options?.ownedWrite ? CONFIG_OWNED_WRITE : 0) |
          (options?.sync ? CONFIG_SYNC : 0) |
          (options?._extraConfig ?? 0) |
          (snapshotCaptureActive && ownerInSnapshotScope(context) ? CONFIG_IN_SNAPSHOT_SCOPE : 0),
        _equals: false as unknown as Computed<T>["_equals"],
        _disposal: null,
        _queue: context?._queue ?? globalQueue,
        _context: context?._context ?? defaultContext,
        _childCount: 0,
        _fn: fn,
        _value: undefined as T,
        _height: 0,
        _nextHeap: undefined,
        _prevHeap: null as any,
        _deps: null,
        _depsTail: null,
        _depGen: 0,
        _subs: null,
        _subsTail: null,
        _parent: context,
        _nextSibling: null,
        _prevSibling: null,
        _firstChild: null,
        _flags: REACTIVE_LAZY,
        _statusFlags: STATUS_UNINITIALIZED,
        _time: clock,
        _pendingValue: NOT_PENDING,
        _transition: null,
        _loading: false,
        _modified: false,
        _prevValue: undefined as T | undefined,
        _effectFn: effectFn,
        _errorFn: errorFn,
        _cleanup: undefined as (() => void) | undefined,
        _type: type,
        _valueTransition: null,
        _x: null,
        _name: options?.name ?? "effect"
      } as any)
    : ({
        id: inheritId(options, transparent, context),
        _config:
          (transparent ? CONFIG_TRANSPARENT : 0) |
          (options?.ownedWrite ? CONFIG_OWNED_WRITE : 0) |
          (options?.sync ? CONFIG_SYNC : 0) |
          (options?._extraConfig ?? 0) |
          (snapshotCaptureActive && ownerInSnapshotScope(context) ? CONFIG_IN_SNAPSHOT_SCOPE : 0),
        _equals: false as unknown as Computed<T>["_equals"],
        _disposal: null,
        _queue: context?._queue ?? globalQueue,
        _context: context?._context ?? defaultContext,
        _childCount: 0,
        _fn: fn,
        _value: undefined as T,
        _height: 0,
        _nextHeap: undefined,
        _prevHeap: null as any,
        _deps: null,
        _depsTail: null,
        _depGen: 0,
        _subs: null,
        _subsTail: null,
        _parent: context,
        _nextSibling: null,
        _prevSibling: null,
        _firstChild: null,
        _flags: REACTIVE_LAZY,
        _statusFlags: STATUS_UNINITIALIZED,
        _time: clock,
        _pendingValue: NOT_PENDING,
        _transition: null,
        _loading: false,
        _modified: false,
        _prevValue: undefined as T | undefined,
        _effectFn: effectFn,
        _errorFn: errorFn,
        _cleanup: undefined as (() => void) | undefined,
        _type: type,
        _valueTransition: null,
        _x: null
      } as any);
  // Effects dispatch status through the SHARED notifier (statusNotifierOf,
  // keyed off _type) — storing it per node forced a full NodeExtension
  // allocation on EVERY effect at creation (an alloc + 19 field stores,
  // +23% effect creation, caught by the creation benches). Only genuinely
  // per-node channels (boundaries) live on _x.
  if (options?.unobserved) ext(self)._unobserved = options.unobserved;
  setupComputedNode(self, lazyOptions);
  return self;
}

/**
 * The shared status notifier for effect nodes, installed once by effect.ts
 * at module evaluation (`this`-dispatched — one function serves every
 * effect, so nodes never store it). Boundary computeds keep their own
 * per-node channel on `_x._notifyStatus`, which takes precedence.
 */
export let effectStatusNotify: ((this: any, status?: number, error?: any) => void) | null = null;
export function setEffectStatusNotify(fn: NonNullable<typeof effectStatusNotify>): void {
  effectStatusNotify = fn;
}

/** Resolve a node's status notifier: an own `_x` channel (boundaries) wins;
 * effect nodes (`_type` — EFFECT_PURE is 0, and only effect literals carry
 * the field) fall back to the shared notifier. Presence doubles as the
 * "display consumer" membership test in the status walks, exactly as the
 * per-node field did when every effect carried one. */
export function statusNotifierOf(
  el: any
): ((this: any, status?: number, error?: any) => void) | undefined {
  const own = el._x?._notifyStatus;
  if (own !== undefined) return own;
  return el._type ? (effectStatusNotify ?? undefined) : undefined;
}

const lazyOptions = { lazy: true } as const;

function setupComputedNode<T>(self: Computed<T>, options: NodeOptions<T> | undefined): void {
  self._prevHeap = self;
  const parent = (context as Root)?._root
    ? (context as Root)._parentComputed
    : (context as Computed<any> | null);
  if (__DEV__ && context && context._config & CONFIG_CHILDREN_FORBIDDEN) {
    emitDiagnostic({
      code: "PRIMITIVE_IN_FORBIDDEN_SCOPE",
      kind: "lifecycle",
      severity: "error",
      message: PRIMITIVE_IN_FORBIDDEN_SCOPE_MESSAGE,
      ownerId: context.id,
      ownerName: (context as any)._name
    });
    throw new Error(PRIMITIVE_IN_FORBIDDEN_SCOPE_MESSAGE);
  }
  if (context) {
    const lastChild = context._firstChild;
    if (lastChild === null) {
      context._firstChild = self;
    } else {
      self._nextSibling = lastChild;
      lastChild._prevSibling = self;
      context._firstChild = self;
    }
  }
  if (__DEV__) DEV.hooks.onOwner?.(self);
  if (parent) self._height = parent._height + 1;
  if (GlobalQueue._wireExternalSource !== null) GlobalQueue._wireExternalSource(self);
  !options?.lazy && recompute(self, true);
  if (snapshotCaptureActive && !options?.lazy) {
    if (!(self._statusFlags & STATUS_PENDING) && !(self._config & CONFIG_NO_SNAPSHOT)) {
      ext(self)._snapshotValue = self._value === undefined ? NO_SNAPSHOT : self._value;
      self._config |= CONFIG_HAS_SNAPSHOT;
      snapshotSources!.add(self);
    }
  }
}

export function signal<T>(v: T, options?: NodeOptions<T>): Signal<T>;
export function signal<T>(
  v: T,
  options?: NodeOptions<T>,
  firewall?: Computed<any>
): FirewallSignal<T>;
export function signal<T>(
  v: T,
  options?: NodeOptions<T>,
  firewall: Computed<unknown> | null = null
): Signal<T> {
  // Prod and observe boilerplates — see computed(). The observe literal adds
  // `_name` and `_owner` (the creating owner, stamped by registerGraph for
  // createSignal nodes so ownerPath can locate signal subjects; null here,
  // and staying null on internal signals — one shape either way).
  const s = __OBSERVE__
    ? {
        _equals: options?.equals ?? isEqual,
        _config:
          (options?.ownedWrite ? CONFIG_OWNED_WRITE : 0) |
          (options?._noSnapshot ? CONFIG_NO_SNAPSHOT : 0),
        _value: v,
        _subs: null,
        _subsTail: null,
        _time: clock,
        _firewall: firewall,
        _nextChild: firewall?._x?._child || null,
        _prevChild: null,
        _pendingValue: NOT_PENDING,
        _transition: null,
        _x: null,
        _name: options?.name ?? "signal",
        _owner: null as Owner | null
      }
    : {
        _equals: options?.equals ?? isEqual,
        _config:
          (options?.ownedWrite ? CONFIG_OWNED_WRITE : 0) |
          (options?._noSnapshot ? CONFIG_NO_SNAPSHOT : 0),
        _value: v,
        _subs: null,
        _subsTail: null,
        _time: clock,
        _firewall: firewall,
        _nextChild: firewall?._x?._child || null,
        _prevChild: null,
        _pendingValue: NOT_PENDING,
        // Signal-literal diet (§12e): NO _time/_fn/_statusFlags slots. Stores
        // materialize one signal per touched leaf, so signal bytes are store
        // bytes. _time is write-only on signals (every read site is computed-
        // typed error-retry gating); _fn/_statusFlags read falsy-identically as
        // missing properties on the shared paths (undefined masks to 0).
        _transition: null,
        _x: null
      };
  if (__DEV__) (s as any)._internal = !!firewall;
  if (options?.unobserved) ext(s as any)._unobserved = options.unobserved;
  if (firewall) linkFirewallChild(firewall, s as FirewallSignal<unknown>);
  if (
    snapshotCaptureActive &&
    !(s._config & CONFIG_NO_SNAPSHOT) &&
    !((firewall?._statusFlags ?? 0) & STATUS_PENDING)
  ) {
    ext(s as any)._snapshotValue = v === undefined ? NO_SNAPSHOT : v;
    (s as any)._config |= CONFIG_HAS_SNAPSHOT;
    snapshotSources!.add(s);
  }
  return s as Signal<T>;
}

// ---------------------------------------------------------------------------
// SLOT SIGNALS (store leaves) — the create-floor diet. Store mounts
// materialize one signal per touched leaf (~13 × rows on dbmon), so per-node
// allocations are mount bytes: the generic path costs an options object, an
// equals closure, an unobserved closure, a NodeExtension to hold it, and
// three post-construction expandos (acc/px/pxv → hidden-class transitions).
// slotSignal bakes everything into ONE literal: `_host`/`_key` backrefs
// replace the closures (equals is a method call — `this` is the node; the
// unobserved sweep dispatches CONFIG_SLOT_NODE to one shared hook), and the
// store's wrap-cache fields are pre-shaped.

/** The shared slot-node unobserved handler — a live binding read directly by
 * the sweep sites (no wrapper frame, no null check: a CONFIG_SLOT_NODE node
 * existing implies the store module loaded and registered the hook). */
export let slotUnobservedHook: (node: Signal<any>) => void;
/** Install the shared slot-node unobserved handler (store module, once). */
export function setSlotUnobserved(fn: (node: Signal<any>) => void): void {
  slotUnobservedHook = fn;
}

/** Push a new node onto its firewall's child chain (the literal already
 * points `_nextChild` at the old head). Doubly linked so a released leaf
 * unlinks in O(1) — the chain is walked per mark of the projection and
 * would otherwise grow by one node per leaf ever read (#3351). */
function linkFirewallChild(firewall: Computed<unknown>, s: FirewallSignal<unknown>): void {
  const head = s._nextChild;
  if (head !== null) head._prevChild = s;
  ext(firewall)._child = s;
  firewall._config |= CONFIG_FW_CHILDREN;
}

/** Release a firewall child the store no longer addresses (unobserved sweep
 * dropped it from its target's cache): unlink it from the chain so the
 * projection stops retaining it and its last value. The node keeps its own
 * `_nextChild` so a walk that is mid-chain on it still terminates. Nodes in
 * `_companionChildren` stay there — companions are permanent by contract
 * and snap through that set, not the chain. */
export function unlinkFirewallChild(node: Signal<any>): void {
  const n = node as FirewallSignal<any>;
  const fw = n._firewall;
  if (!fw) return;
  const prev = n._prevChild;
  const next = n._nextChild;
  if (prev !== null) prev._nextChild = next;
  else if (fw._x!._child === n) fw._x!._child = next;
  if (next !== null) next._prevChild = prev;
  n._prevChild = null;
}

export function slotSignal<T>(
  v: T,
  equals: (a: T, b: T) => boolean,
  host: object,
  key: PropertyKey,
  acc: boolean,
  firewall: Computed<unknown> | null = null
): Signal<T> {
  // Prod and observe boilerplates — see computed(). The store relabels the
  // observe slot (`store.<key>`) when the attribution engine is installed.
  const s = __OBSERVE__
    ? {
        _equals: equals,
        _config: CONFIG_OWNED_WRITE | CONFIG_SLOT_NODE,
        _value: v,
        _subs: null,
        _subsTail: null,
        _time: clock,
        _firewall: firewall,
        _nextChild: firewall?._x?._child || null,
        _prevChild: null,
        _pendingValue: NOT_PENDING,
        _transition: null,
        _x: null,
        _host: host,
        _key: key,
        acc,
        px: undefined,
        pxv: undefined,
        _name: "signal"
      }
    : {
        _equals: equals,
        _config: CONFIG_OWNED_WRITE | CONFIG_SLOT_NODE,
        _value: v,
        _subs: null,
        _subsTail: null,
        _time: clock,
        _firewall: firewall,
        _nextChild: firewall?._x?._child || null,
        _prevChild: null,
        _pendingValue: NOT_PENDING,
        _transition: null,
        _x: null,
        // Slot backrefs: what the equals/unobserved closures used to capture.
        _host: host,
        _key: key,
        // Store read-path caches, pre-shaped (were post-construction expandos).
        acc,
        px: undefined,
        pxv: undefined
      };
  if (__DEV__) (s as any)._internal = !!firewall;
  if (firewall) linkFirewallChild(firewall, s as unknown as FirewallSignal<unknown>);
  if (snapshotCaptureActive && !((firewall?._statusFlags ?? 0) & STATUS_PENDING)) {
    ext(s as any)._snapshotValue = v === undefined ? NO_SNAPSHOT : v;
    (s as any)._config |= CONFIG_HAS_SNAPSHOT;
    snapshotSources!.add(s);
  }
  return s as unknown as Signal<T>;
}

export function optimisticSignal<T>(v: T, options?: NodeOptions<T>): Signal<T> {
  const s = signal(v, options);
  ext(s)._overrideValue = NOT_PENDING;
  s._config |= CONFIG_OPTIMISTIC;
  return s;
}

export function optimisticComputed<T>(
  fn: (prev?: T) => T | PromiseLike<T> | AsyncIterable<T>,
  options?: NodeOptions<T>
): Computed<T> {
  const c = computed(fn, options);
  ext(c)._overrideValue = NOT_PENDING;
  c._config |= CONFIG_OPTIMISTIC;
  return c;
}

export function isEqual<T>(a: T, b: T): boolean {
  return a === b;
}

/**
 * When set to a component name string, any reactive read that is not inside a nested tracking
 * scope will log a dev-mode warning. Managed automatically by `untrack(fn, strictReadLabel)`.
 */
export let strictRead: string | false = false;
export function setStrictRead(v: string | false): string | false {
  const prev = strictRead;
  strictRead = v;
  return prev;
}

/**
 * Runs `fn` outside of any reactive tracking — reads inside `fn` will not
 * subscribe the current scope. Returns whatever `fn` returns.
 *
 * Use `untrack` inside a memo or effect when you need to read a signal once
 * without making the surrounding computation depend on its future changes.
 *
 * Pass a `strictReadLabel` string to enable a dev-mode warning: any reactive
 * read inside `fn` that isn't inside a nested tracking scope will log a
 * warning naming the label.
 *
 * @example
 * ```ts
 * createEffect(
 *   () => trigger(),                 // tracks `trigger` only
 *   () => {
 *     const snapshot = untrack(() => state); // read once, untracked
 *     log(snapshot);
 *   }
 * );
 * ```
 */
export function untrack<T>(fn: () => T, strictReadLabel?: string | false): T {
  if (
    GlobalQueue._externalUntrack === null &&
    !tracking &&
    (!__DEV__ || (!strictRead && !strictReadLabel))
  )
    return fn();
  const prevTracking = tracking;
  const prevStrictRead = strictRead;
  tracking = false;
  if (__DEV__) strictRead = strictReadLabel || false;
  try {
    if (GlobalQueue._externalUntrack !== null) return GlobalQueue._externalUntrack(fn);
    return fn();
  } finally {
    tracking = prevTracking;
    if (__DEV__) strictRead = prevStrictRead;
  }
}

/**
 * Bring a computed to a readable state: lazy/disposed nodes are (re)computed;
 * an isPending() probe (`refresh`) additionally pulls the node fully up to
 * date so its status flags reflect the current graph.
 */
export function prepareComputed(comp: Computed<unknown>, refresh: boolean): void {
  if (comp._flags & REACTIVE_LAZY) {
    comp._flags &= ~REACTIVE_LAZY;
    recompute(comp as Computed<any>, true);
  } else if (comp._flags & REACTIVE_DISPOSED) {
    // Two disposal lifecycles share the flag (#3024). Observation-lifecycle
    // nodes (CONFIG_AUTO_DISPOSE) are dormant — torn down by unobserved()
    // when the last subscriber left — and reads reawaken them; that is the
    // pay-for-use contract. Owner-lifecycle nodes are dead: recomputing would
    // re-run user code in a torn-down tree (and discard manual writes on
    // derived-writable signals), so reads return the last committed value.
    if (comp._config & CONFIG_AUTO_DISPOSE) recompute(comp as Computed<any>, true);
  } else if (refresh) {
    updateIfNecessary(comp);
  }
}

/**
 * Sentinel returned by readNodeFast when the plain-signal fast path does not
 * apply and the caller must fall back to the full read().
 */
export const READ_SLOW = Symbol("read-slow");

/**
 * read()'s plain-signal fast path as a standalone entry for hot callers
 * (store traps). Safe to substitute for read() only because the bail
 * conditions mirror read()'s prelude and fast-path guard exactly: the
 * latestRead and pendingCheck windows run side-effectful hooks before the
 * fast path, `_fn` nodes need prepareComputed, and firewall / override /
 * snapshot / transition / lane / dev-strictRead state all take the full
 * resolution. Anything slow returns READ_SLOW; the caller then calls read().
 */
/**
 * Wake only authoritative-view readers (until() predicates) subscribed to `el`.
 * The A17-silent ack paths — an authoritative arrival equal to the active
 * override — use this so the predicate re-evaluates without re-firing
 * ordinary subscribers whose visible (override) value did not change.
 * Pay-for-use: reached through GlobalQueue._notifyAuthoritativeObservers,
 * installed at first until() call — apps that never use until() shake it.
 */
export function notifyAuthoritativeObservers(el: Signal<any> | Computed<any>): void {
  for (let s = el._subs; s !== null; s = s._nextSub) {
    const sub = s._sub;
    if (!(sub._config & CONFIG_AUTHORITATIVE_READ)) continue;
    // Missed-wake latch (#3037), same contract as insertSubs: the reader may
    // itself have pulled this recompute (updateIfNecessary from its own
    // read), and the heap refuses RECOMPUTING nodes — latch so recompute's
    // tail reschedules it with the staged value visible.
    if (sub._flags & REACTIVE_RECOMPUTING_DEPS && s._gen === sub._depGen && s !== sub._depsTail)
      sub._flags |= REACTIVE_MISSED_WAKE;
    enqueueSub(sub);
  }
  schedule();
}

/** Installs the authoritative-reader wakeup hook. Idempotent; called by every
 * creator of a CONFIG_AUTHORITATIVE_READ computation — until() and refresh() —
 * before its first read (same late-binding contract as the optimistic engine;
 * the gating bit is only ever set by such a read, so the `!` call sites are
 * safe once every setter installs, #3303). */
export function installAuthoritativeRead(): void {
  if (GlobalQueue._notifyAuthoritativeObservers === null)
    GlobalQueue._notifyAuthoritativeObservers = notifyAuthoritativeObservers;
}

/**
 * Value selection for a node carrying an unflushed write (CONFIG_UNFLUSHED):
 * writes become visible at flush, so a tracked reader running between the
 * write and its flush — a computation created in the same tick, a companion's
 * first compute — sees the FLUSHED world: the staged value the node was
 * holding, else committed. It is re-marked when the write flushes
 * (promoteUnflushed's re-walk), so it never goes stale on it.
 */
function unflushedView<T>(el: Signal<T> | Computed<T>): T {
  const staged = el._x?._flushedStaged;
  return (staged !== undefined && staged !== NOT_PENDING ? staged : el._value) as T;
}

export function readNodeFast<T>(el: Signal<T>): T | typeof READ_SLOW {
  if (
    latestReadActive ||
    pendingCheckActive ||
    (el as Partial<Computed<T>>)._fn ||
    (el as FirewallSignal<T>)._firewall ||
    el._x?._overrideValue !== undefined ||
    el._x?._snapshotValue !== undefined ||
    activeTransition !== null ||
    currentOptimisticLane !== null ||
    snapshotCaptureActive ||
    (__DEV__ && strictRead)
  )
    return READ_SLOW;
  let c = context;
  if ((c as Root)?._root) c = (c as Root)._parentComputed;
  if (c && tracking) link(el, c as Computed<any>);
  // Children-forbidden readers (createTrackedEffect / onSettled callbacks) get
  // committed visibility: like the effect half of createEffect and event
  // handlers, effect-phase code never observes its own unsettled write — the
  // write lands in the same flush's continuation (#3006).
  // A stale reader (render effect) recomputing with no transaction active is
  // mainline: a write staged by a live transaction (`_transition` stamped —
  // ambient staging never is) stays masked until that transaction's reveal,
  // the same rule the slow path applies (#3322). Without it a zombie
  // recompute, or a commit-time re-derive of a contested effect, published
  // another transaction's uncommitted value.
  return (
    !c ||
    el._pendingValue === NOT_PENDING ||
    c._config & CONFIG_CHILDREN_FORBIDDEN ||
    (stale && el._transition !== null)
      ? el._value
      : el._config & CONFIG_UNFLUSHED
        ? unflushedView(el)
        : el._pendingValue
  ) as T;
}

export function read<T>(el: Signal<T> | Computed<T>): T {
  // Handle latest() mode: read from _latestValueComputed
  // Checked before isPending so that isPending(() => latest(x)) checks
  // the _pendingSignal of _latestValueComputed (async in flight) rather
  // than the original node (which stays "pending" while held in a transition).
  if (latestReadActive) return GlobalQueue._latestRead!(el) as T;

  let c = context;
  if ((c as Root)?._root) c = (c as Root)._parentComputed;
  const computed = el as Partial<Computed<unknown>>;
  const firewall = (el as FirewallSignal<any>)._firewall;
  const owner = firewall || el;

  // Handle isPending() mode: collect pending state while preserving normal read semantics.
  // Probe mode is suspended while preparing the node so nested reads during a
  // recompute don't collect into the probe.
  if (pendingCheckActive) {
    GlobalQueue._pendingCheck!(el, c as Computed<any> | null, owner as any, firewall);
  } else if (typeof computed._fn === "function") {
    prepareComputed(el as Computed<unknown>, false);
  }

  if (
    !computed._fn &&
    owner === el &&
    el._x?._overrideValue === undefined &&
    el._x?._snapshotValue === undefined &&
    activeTransition === null &&
    currentOptimisticLane === null &&
    !snapshotCaptureActive &&
    (!__DEV__ || !strictRead)
  ) {
    if (c && tracking) link(el, c as Computed<any>);
    // Committed visibility for children-forbidden readers and for stale
    // readers of a foreign transaction's staged write — see readNodeFast.
    return (
      !c ||
      el._pendingValue === NOT_PENDING ||
      c._config & CONFIG_CHILDREN_FORBIDDEN ||
      (stale && el._transition !== null)
        ? el._value
        : el._config & CONFIG_UNFLUSHED
          ? unflushedView(el)
          : el._pendingValue
    ) as T;
  }

  // The dev component-body safeguard (#2897) must not fire inside an
  // isPending() probe: its plain Error would be swallowed by the probe's
  // catch (which only rethrows NotReadyError), making dev return false where
  // prod propagates NotReady (#2928). Probe reads follow the prod path.
  if (__DEV__ && strictRead && !pendingCheckActive && owner._statusFlags & STATUS_PENDING)
    throwPendingUntrackedRead(strictRead, {
      ownerId: c?.id,
      ownerName: (c as any)?._name,
      nodeName: (owner as any)?._name
    });

  if (c && tracking) {
    link(el, c as Computed<any>, pendingCheckActive);

    if ((owner as Computed<unknown>)._fn) {
      const elQueue = queueFor(el as Computed<unknown>);
      if (owner._height >= elQueue._min) {
        markNode(c as Computed<any>);
        markHeap(elQueue);
        updateIfNecessary(owner);
      }
      // Fresh-pull readers (awaitable refresh's waiter) recompute a dirty
      // source inline even when the height gate defers to the flush: the
      // waiter must park on the re-ask's window (or serve its sync answer),
      // never read the PRE-re-ask value as settled. Self-guarded: a clean
      // node no-ops and updateIfNecessary refuses disposed nodes (#2983) —
      // a dead target serves its last value, which is already quiescent.
      else if (c._config & CONFIG_FRESH_READ) updateIfNecessary(owner);
      const height = owner._height;
      // parent check is shallow, might need to be recursive
      if (height >= (c as Computed<any>)._height && (el as Computed<any>)._parent !== c) {
        (c as Computed<any>)._height = height + 1;
      }
    }
  }

  if (owner._statusFlags & STATUS_PENDING) {
    // A render reader landing on a pending node throws, whichever transaction
    // the node is stamped with: the reveal that discovered the flight holds on
    // it (A15 — observed async settles as one unit; #3305). A stale reader
    // used to carve out nodes pending in ANOTHER transition and show their
    // committed value instead, on the theory that the stamp meant the
    // transaction also held the node's inputs. It does not: the stamp is
    // pending-node bookkeeping, and the inputs may already be on screen —
    // committed (#3305), lane-revealed (#3334), or held only by a reveal that
    // itself waits on this flight — so the committed value tears the frame.
    if (c) {
      if (__DEV__ && c && c._config & CONFIG_CHILDREN_FORBIDDEN) {
        const message =
          "[PENDING_ASYNC_FORBIDDEN_SCOPE] Reading a pending async value inside createTrackedEffect or onSettled will throw. " +
          "Use createEffect instead which supports async-aware reactivity.";
        reportDiagnostic(
          emitDiagnostic(
            {
              code: "PENDING_ASYNC_FORBIDDEN_SCOPE",
              kind: "async",
              severity: "warn",
              message,
              ownerId: c.id,
              ownerName: (c as any)._name,
              nodeName: (owner as any)?._name
            },
            c
          )
        );
      }
      // Per-lane suspension lives with the engine (a non-null lane implies it
      // is installed): under a lane, only same-lane pending async without an
      // active override throws — plus uninitialized sources regardless of
      // lane (#3276); that check rides laneSuspends so floor bundles don't
      // pay for it.
      if (currentOptimisticLane === null || GlobalQueue._laneSuspends!(owner)) {
        if (!tracking && el !== c) link(el, c as Computed<any>);
        throw owner._x?._error;
      }
    } else if (c && owner._statusFlags & STATUS_UNINITIALIZED) {
      // A stale (render) reader of a node held pending in ANOTHER transition
      // normally keeps showing the node's committed value instead of
      // entangling the two transactions — but an uninitialized node has no
      // committed value to show. Suspend on it (firewall-backed store reads
      // always took this branch; plain memos now do too): the reader
      // registers as a reporter of that source, and its pending-node stamp
      // ties it to the active transaction, so the two transactions merge
      // when the source settles. Falling through served `undefined` as if
      // settled and stranded the reader outside both transactions, so it
      // never re-ran when either landed (#3043 port).
      if (!tracking && el !== c) link(el, c as Computed<any>);
      throw owner._x?._error;
    } else if (!c && owner._statusFlags & STATUS_UNINITIALIZED) {
      throw owner._x?._error;
    }
  }
  // `owner` is the computed itself, or the firewall behind a store node —
  // firewall-backed reads follow the same rules (memo parity, #2897 ruling):
  // an errored derive throws for every late reader instead of silently
  // serving node values (the seed, or last-good data after a failed refetch).
  if ((owner as Computed<any>)._fn && (owner as Computed<any>)._statusFlags & STATUS_ERROR) {
    // Only a genuine reactive re-read may retry an errored async source:
    // - tracking: owned/tracked scope only (never events / `untrack` / effect side-effect phase)
    // - !pendingCheckActive: an `isPending` probe observes the error, never refetches
    // - owner._time < clock: only on a later cycle than the one the error was found
    if (tracking && !pendingCheckActive && (owner as Computed<any>)._time < clock) {
      recompute(owner as Computed<unknown>);
      return read(el);
    } else throw (owner as Computed<any>)._x?._error;
  }

  if (snapshotCaptureActive && c && (c as Computed<any>)._config & CONFIG_IN_SNAPSHOT_SCOPE) {
    const sv = el._x?._snapshotValue;
    if (sv !== undefined) {
      const snapshot = sv === NO_SNAPSHOT ? undefined : sv;
      const current = el._pendingValue !== NOT_PENDING ? el._pendingValue : el._value;
      if (current !== snapshot) (c as Computed<any>)._flags |= REACTIVE_SNAPSHOT_STALE;
      return snapshot as T;
    }
  }

  if (__DEV__ && strictRead)
    warnStrictReadUntracked(strictRead, {
      ownerId: c?.id,
      ownerName: (c as any)?._name,
      nodeName: (owner as any)?._name
    });

  if (el._x?._overrideValue !== undefined && el._x?._overrideValue !== NOT_PENDING) {
    // A17: the override IS the value for every reader — except an authoritative
    // reader (until()'s predicate carries CONFIG_AUTHORITATIVE_READ): it must
    // observe independently-arriving truth, and serving it the caller's own
    // tentative write would trivially satisfy the predicate. The bit is checked
    // on the reading computation itself, so a shared computed the predicate
    // pulls recomputes as ITSELF (context = the memo, no bit) under the normal
    // view. Fall through to normal value selection (staged `_pendingValue` is
    // authoritative — optimism never lives there); the sticky mark makes the
    // A17-silent "landing equals override" paths notify this node's subs so
    // the reader re-runs when truth arrives.
    if (!(c && c._config & CONFIG_AUTHORITATIVE_READ))
      return unwrapOverride<T>(el._x?._overrideValue);
    el._config |= CONFIG_AUTHORITATIVE_OBSERVED;
  }

  // Entanglement gate: a reader recomputing under an optimistic lane that reads
  // a pending mid-transition write sees the committed value. Projection-store
  // manual writes use the firewall's manual-write flag to opt into this path.
  // Async drivers are not under an optimistic lane and so bypass this, reading
  // _pendingValue for correct fetching. The sub is recorded for replay at commit
  // so it re-runs with the new committed view. (Gate details live with the
  // engine — a non-null lane implies it is installed.)
  if (
    currentOptimisticLane !== null &&
    activeTransition !== null &&
    c !== null &&
    GlobalQueue._gatedRead!(el as Signal<any>, owner, c as Computed<any>)
  ) {
    return el._value as T;
  }

  // In optimistic lane context, return _value for optimistic/lane-assigned signals
  // and for regular signals in stale mode (render effects). Non-stale readers (user
  // effects) see _pendingValue so that latest() and direct reads stay consistent.
  // (The lane-context clause lives with the engine.) Children-forbidden readers
  // (createTrackedEffect / onSettled callbacks) get committed visibility — see
  // readNodeFast (#3006).
  const value =
    !c ||
    (currentOptimisticLane !== null &&
      GlobalQueue._laneReadsCommitted!(el, owner, c as Computed<any>)) ||
    el._pendingValue === NOT_PENDING ||
    c._config & CONFIG_CHILDREN_FORBIDDEN ||
    (stale && el._transition && activeTransition !== el._transition) ||
    // A17 for HELD truth (#3164, see CONFIG_HELD_TRUTH): staged confirming
    // truth — fold-staged onto an armed family, or entangle-stolen by an
    // awaited until() — is masked from ordinary readers until its
    // transaction's reveal; the retaining transaction's own speculative
    // recomputes included (partial override coverage would otherwise
    // compose override + staged truth into a state no timeline contains).
    // Authoritative readers (until()'s predicate) and latest() see the
    // staged truth — the tunnel that keeps the hold deadlock-free.
    (el._config & CONFIG_HELD_TRUTH &&
      !latestReadActive &&
      !((c as Computed<any>)._config & CONFIG_AUTHORITATIVE_READ))
      ? el._value
      : el._config & CONFIG_UNFLUSHED
        ? unflushedView(el)
        : (el._pendingValue as T);
  // Record that this isPending() probe observed the fresh pending value, so
  // the probe doesn't pair "pending" with the new value (#2831).
  if (pendingCheckActive) GlobalQueue._recordFresh!(el, value);
  if (
    !c &&
    owner === el &&
    typeof computed._fn === "function" &&
    el._config & CONFIG_AUTO_DISPOSE &&
    !(owner._statusFlags & STATUS_PENDING) &&
    !el._subs
  ) {
    // Deferred, not inline (#3078): an inline unobserved() here made untracked
    // reads destructive — dispose on this read, full revival recompute on the
    // next — so consecutive reads could answer differently with no write in
    // between (the revival samples the ambient transition/lane context).
    // The sweep at flush finalization re-validates and reclaims; schedule()
    // guarantees that flush happens even if nothing else is queued.
    dormantNodes.add(el as Computed<unknown>);
    schedule();
  }
  return value;
}

/**
 * Nodes carrying an unflushed write (CONFIG_UNFLUSHED), in write order.
 * There is ONE write path — every staging write lands here — and the
 * consumers promote: `promoteUnflushed` runs wherever a heap pass is about
 * to compute against the writes issued since the last promotion. The top of
 * a flush (the tick's imperative writes), the tail of a recompute (its own
 * writes, by cursor), and inside a flush after each commit-hook / boundary
 * sweep step that a heap run follows — so a write and the derivation it
 * dirties land in the same clock cycle, which the clock-gated re-asks
 * (an errored source's retry) key on.
 */
const unflushedNodes: Array<Signal<any> | Computed<any>> = [];

/**
 * Writes become visible at flush. Every staging write calls this after
 * setting `_pendingValue`, with the staged value it replaced (`prevStaged`,
 * NOT_PENDING if none): the write is UNFLUSHED — both of its remaining
 * halves, the companion sync and the subscriber walk, are deferred to
 * `promoteUnflushed`. Imperative writes (handler, action body, async
 * landing) are promoted at the top of the next flush; writes issued inside
 * a recompute (a boundary's status signal, a firewall staging its leaves)
 * are promoted at that recompute's tail, so they are part of its pass
 * whether it runs in a flush or as a lazy init. With no walk, nothing
 * downstream is dirty before the flush, so a mid-tick pull cannot derive
 * from an imperative write; and the tick's first write to a HELD node
 * stashes the flushed staged value it overwrites so latest() and isPending()
 * keep serving the flushed world until the rewrite flushes.
 */
export function markUnflushed(el: Signal<any> | Computed<any>, prevStaged: unknown): void {
  if (el._config & CONFIG_UNFLUSHED) return;
  el._config |= CONFIG_UNFLUSHED;
  if (prevStaged !== NOT_PENDING) ext(el)._flushedStaged = prevStaged;
  unflushedNodes.push(el);
}

/**
 * Unflushed writes from list position `from` on become the world in
 * progress. For each node, clear the mark and the stashed flushed-staged
 * value, then perform the write's deferred halves in the classic order —
 * push the value into the companions (the latest() shadow, an optimistic
 * node, so latest() readers wake on its lane ahead of a held transaction;
 * the isPending() verdict), then walk the subscribers. At the top of a flush
 * (`from` 0) this runs before runHeap so everything marked computes in THIS
 * pass — a subscriber that linked in between (a computation created in the
 * same tick read the flushed view) is marked by the walk like any other. At
 * a recompute's tail it promotes only that recompute's own writes.
 */
export function promoteUnflushed(from: number = 0): void {
  // Callers check the list first (recompute compares lengths locally); the
  // guard here covers the flush sites. The truncating `length =` below is a
  // runtime call V8 does not inline — paying it once per recompute with an
  // empty list cost update1to1 ~25% (CodSpeed on #3337).
  if (unflushedNodes.length === from) return;
  const sync = GlobalQueue._syncCompanions;
  // A companion sync is itself a write (the pendingSignal, the shadow) and
  // lands on the list mid-promotion: the loop bound is live so it is
  // promoted in the same pass; the list is truncated once nothing new arrives.
  for (let i = from; i < unflushedNodes.length; i++) {
    const node = unflushedNodes[i];
    node._config &= ~CONFIG_UNFLUSHED;
    if (node._x !== null) {
      node._x._flushedStaged = NOT_PENDING;
      // An optimistic write flushes here: the engine installs the override,
      // syncs the companions to it and walks the subscribers on its lane —
      // the write's deferred halves, like a plain write's below. It is the
      // value for every reader from this instant (A17), so a plain staged
      // write the same tick left on the node needs no walk of its own.
      if (node._x._pendingOverride !== NOT_PENDING) {
        GlobalQueue._promoteOverride!(node);
        continue;
      }
    }
    // The write may already have committed (a sweep's write staged before
    // finalize's commitPendingNodes ran) — the walk is still owed.
    if (node._config & CONFIG_HAS_COMPANIONS && sync !== null)
      sync(node, node._pendingValue === NOT_PENDING ? node._value : node._pendingValue);
    // Same wake rule as the eager landing (asyncWrite): under an active
    // override every reader sees the override (A17), so the hold is not
    // visible to them and the revert is their notification — only an
    // authoritative-view reader (until()'s predicate) waiting on the staged
    // truth is woken (#3164). Only CONFIG_OPTIMISTIC nodes carry an
    // override slot (see constants.ts): plain nodes skip the probe.
    if (!(node._config & CONFIG_OPTIMISTIC) || !hasActiveOverride(node)) insertSubs(node);
    else if (node._config & CONFIG_AUTHORITATIVE_OBSERVED)
      GlobalQueue._notifyAuthoritativeObservers?.(node);
  }
  unflushedNodes.length = from;
}

/**
 * Store-rewrite setter guard: the rewrite parks writes in a pending backing
 * (no setSignal at write time), so the owned-scope write protection must
 * fire at the setter entry instead. Mirrors setSignal's guard condition
 * minus the node-specific exemptions (ownedWrite/firewall), which don't
 * apply to plain store setters.
 */
export function devGuardStoreSetterWrite(): void {
  if (!__DEV__) return;
  // Roots are not owned computation scopes — setters inside createRoot bodies
  // are legal (legacy parity; the guard targets computed/effect bodies).
  if (context && !(context as any)._root && !(context._config & CONFIG_CHILDREN_FORBIDDEN)) {
    emitDiagnostic({
      code: "REACTIVE_WRITE_IN_OWNED_SCOPE",
      kind: "write",
      severity: "error",
      message: REACTIVE_WRITE_IN_OWNED_SCOPE_SIGNAL_MESSAGE,
      ownerId: context.id,
      ownerName: (context as any)._name,
      data: { operation: "setStore" }
    });
    // the owner name reaches the THROWN message too, not just the
    // diagnostics channel apps don't subscribe to by default (#3157)
    throw new Error(ownedScopeWriteMessage(context));
  }
}

function ownedScopeWriteMessage(owner: Owner) {
  const name = (owner as any)._name;
  return name
    ? `${REACTIVE_WRITE_IN_OWNED_SCOPE_SIGNAL_MESSAGE} (in ${name})`
    : REACTIVE_WRITE_IN_OWNED_SCOPE_SIGNAL_MESSAGE;
}

export function setSignal<T>(el: Signal<T> | Computed<T>, v: T | ((prev: T) => T)): T {
  if (
    __DEV__ &&
    !(el._config & CONFIG_OWNED_WRITE) &&
    !(context && context._config & CONFIG_CHILDREN_FORBIDDEN) &&
    context &&
    (el as FirewallSignal<any>)._firewall !== context
  ) {
    emitDiagnostic({
      code: "REACTIVE_WRITE_IN_OWNED_SCOPE",
      kind: "write",
      severity: "error",
      message: REACTIVE_WRITE_IN_OWNED_SCOPE_SIGNAL_MESSAGE,
      ownerId: context.id,
      ownerName: (context as any)._name,
      nodeName: (el as any)._name,
      data: { operation: "setSignal" }
    });
    throw new Error(ownedScopeWriteMessage(context));
  }

  if (el._transition && activeTransition !== el._transition)
    globalQueue.initTransition(el._transition);

  // The optimistic write path lives with the engine: only optimisticSignal /
  // optimisticComputed callers and optimistic store nodes carry an
  // _overrideValue slot (flagged by CONFIG_OPTIMISTIC — a masked read of the
  // always-present config instead of a missing-property probe), and every
  // module that installs one installs the engine first.
  if (el._config & CONFIG_OPTIMISTIC && !projectionWriteActive)
    return GlobalQueue._optimisticWrite!(el, v);

  const currentValue = el._pendingValue === NOT_PENDING ? el._value : (el._pendingValue as T);

  if (typeof v === "function") v = (v as (prev: T) => T)(currentValue);

  // Uninitialized check first: the first commit has no previous value, so the
  // user comparator must not run against `undefined` (matches recompute).
  const valueChanged =
    !!((el as Computed<T>)._statusFlags & STATUS_UNINITIALIZED) ||
    !el._equals ||
    !el._equals(currentValue, v);
  if (!valueChanged) return v;

  // Attribution hook: this committed write is where a re-run chain begins.
  if (__OBSERVE__ && attrHooks !== null) attrHooks.write(el, currentValue, v);

  const wasStaged = el._pendingValue !== NOT_PENDING;
  if (!wasStaged) queuePendingNode(el);
  el._pendingValue = v;
  if (__DEV__) devTrackHeldPending(el);
  // _time is a computed-only slot (§12e): writing it on a signal would fork
  // the lean shape. Every read site is computed-typed.
  if ((el as any)._fn !== undefined) el._time = clock;

  // Writes become visible at flush (markUnflushed): the companion sync and
  // the subscriber walk run when the write is promoted — at the next flush's
  // top, or at the tail of the recompute that issued it. Repeated writes to
  // one node before then walk once.
  markUnflushed(el, wasStaged ? currentValue : NOT_PENDING);
  schedule();
  return v;
}

/**
 * Suppresses automatic recomputation of `el` until the scheduler drains. Used
 * when a manual write should win over dependency changes queued in the same
 * tick. The MANUAL_WRITE flag is cleared by the pending-node drain; projection
 * computeds don't commit values, but they still need the same end-of-tick
 * cleanup point.
 */
export function suppressComputedRecompute(el: Computed<unknown>): void {
  deleteFromHeap(el, queueFor(el));
  if (!(el._flags & REACTIVE_MANUAL_WRITE) && el._pendingValue === NOT_PENDING) {
    queuePendingNode(el);
    schedule();
  }
  el._flags = (el._flags & ~(REACTIVE_DIRTY | REACTIVE_CHECK)) | REACTIVE_MANUAL_WRITE;
  el._manualWriteTime = clock;
}

/**
 * User-facing setter for the memo form of `createSignal(fn)`. Behaves like
 * `setSignal`, but also cancels any pending recompute of the memo so the
 * manual value wins over a value that would otherwise be produced by an
 * upstream change in the same tick.
 */
export function setMemo<T>(el: Computed<T>, v: T | ((prev: T) => T)): T {
  const result = setSignal(el, v);
  suppressComputedRecompute(el as Computed<unknown>);
  return result;
}

/**
 * Executes `fn` with the given `owner` set as the current owner. Any reactive
 * primitives (`createSignal`, `createMemo`, `createEffect`, `onCleanup`,
 * `cleanup`, etc.) created inside `fn` are attached to that owner, so they
 * are disposed when the owner is disposed.
 *
 * The classic pattern: capture the current owner with `getOwner()` inside a
 * component, then re-enter it from a callback (event handler, async resolve,
 * setTimeout) so disposables created in the callback get cleaned up with the
 * component.
 *
 * @example
 * ```ts
 * function delayed<T>(ms: number, fn: () => T) {
 *   const owner = getOwner();
 *   setTimeout(() => runWithOwner(owner, fn), ms);
 * }
 * ```
 */
export function runWithOwner<T>(owner: Owner | null, fn: () => T): T {
  if (__DEV__ && owner && (owner as any)._flags & REACTIVE_DISPOSED) {
    const message =
      "[RUN_WITH_DISPOSED_OWNER] runWithOwner called with a disposed owner. Children created inside will never be disposed.";
    reportDiagnostic(
      emitDiagnostic(
        {
          code: "RUN_WITH_DISPOSED_OWNER",
          kind: "owner",
          severity: "warn",
          message,
          ownerId: owner.id,
          ownerName: (owner as any)._name
        },
        owner
      )
    );
  }
  const oldContext = context;
  const prevTracking = tracking;
  context = owner;
  tracking = false;
  try {
    return fn();
  } finally {
    context = oldContext;
    tracking = prevTracking;
  }
}

export function staleValues<T>(fn: () => T, set = true): T {
  const prevStale = stale;
  stale = set;
  try {
    return fn();
  } finally {
    stale = prevStale;
  }
}

/**
 * Core marking half of `refresh()` (the public wrapper lives in signals.ts —
 * it validates the target, marks through here, then builds the quiescence
 * promise on the resolve()/until() effect machinery). Flags the node's next
 * recompute as a quiet re-ask and schedules it; no-ops for non-derived or
 * disposed targets and for same-tick manual writes.
 */
export function markRefresh(node: Computed<any>): void {
  if (
    __DEV__ &&
    context &&
    !((node._config ?? 0) & CONFIG_OWNED_WRITE) &&
    !(context._config & CONFIG_CHILDREN_FORBIDDEN)
  ) {
    emitDiagnostic({
      code: "REACTIVE_WRITE_IN_OWNED_SCOPE",
      kind: "write",
      severity: "error",
      message: REACTIVE_WRITE_IN_OWNED_SCOPE_REFRESH_MESSAGE,
      ownerId: context.id,
      ownerName: (context as any)._name,
      nodeName: (node as any)._name,
      data: { operation: "refresh" }
    });
    throw new Error(REACTIVE_WRITE_IN_OWNED_SCOPE_REFRESH_MESSAGE);
  }
  if (typeof node._fn === "function" && !(node._flags & REACTIVE_DISPOSED)) {
    if (node._flags & REACTIVE_MANUAL_WRITE) {
      // A manual write in the CURRENT tick wins over the refresh (#2692).
      // A mask stamped in an earlier tick only survives because a
      // transaction (action) is holding the pending drain open; there the
      // refresh is a later, explicit re-ask and lifts the mask — otherwise
      // any setStore early in an action silently swallows every refresh()
      // for the rest of the transaction (#3026).
      if (node._manualWriteTime === clock) return;
      node._flags &= ~REACTIVE_MANUAL_WRITE;
      // The lift falls through to the re-ask classification below. The held
      // write's value change already rides the transaction; the refetch it
      // asks for is the same question with unchanged inputs. Skipping the
      // mark here classified that refetch as a NEW question, which pends
      // every leaf (3.1) — an action doing setStore + yield + refresh(store)
      // lit up every sibling row, and affects() could not narrow it (a mark
      // only turns pending on). Same-question motion stays silent (3.4);
      // the written slot and any declared mark carry the pending instead.
    }
    // A refresh with no value-change dirt already queued is a re-ask of the
    // same question: mark it so the recompute classifies any resulting
    // pending window as quiet (not pending). If the node is already dirty
    // from a real input change, the question changed — don't mark.
    // REACTIVE_IN_HEAP counts as dirt: insertSubs schedules subscribers by
    // heap insertion alone (no DIRTY/CHECK flag), so a same-batch value
    // change followed by refresh() must not be laundered into a quiet re-ask.
    if (!(node._flags & (REACTIVE_DIRTY | REACTIVE_CHECK | REACTIVE_IN_HEAP))) {
      node._flags |= REACTIVE_REASK;
      armReaskClear();
    }
    node._flags = (node._flags & ~REACTIVE_CHECK) | REACTIVE_DIRTY;
    // A refresh() self-invalidation is a root cause too — the target's next
    // run has no changed dep to point at, so it points here instead.
    if (__OBSERVE__ && attrHooks !== null) attrHooks.refreshed(node);
    insertIntoHeap(node, queueFor(node));
    schedule();
  }
}
