import {
  NOT_PENDING,
  REACTIVE_DIRTY,
  REACTIVE_OPTIMISTIC_DIRTY,
  STATUS_ERROR,
  STATUS_PENDING,
  STATUS_UNINITIALIZED
} from "./constants.js";
import { context, read, setSignal, untrack, updatePendingSignal } from "./core.js";
import { NotReadyError, StatusError } from "./error.js";
import { hasActiveOverride, resolveLane, type OptimisticLane } from "./lanes.js";
import {
  activeTransition,
  assignOrMergeLane,
  clock,
  flush,
  globalQueue,
  insertSubs,
  schedule
} from "./scheduler.js";
import type { Computed, FirewallSignal, Signal } from "./types.js";

export function handleAsync<T>(
  el: Computed<T>,
  result: T | PromiseLike<T> | AsyncIterable<T>,
  setter?: (value: T) => void
): T {
  const isObject = typeof result === "object" && result !== null;
  const iterator = isObject && untrack(() => result[Symbol.asyncIterator]);
  const isThenable =
    !iterator && isObject && untrack(() => typeof (result as any).then === "function");

  if (!isThenable && !iterator) {
    el._inFlight = null;
    return result as T;
  }

  el._inFlight = result as PromiseLike<T> | AsyncIterable<T>;
  let syncValue: T;

  const handleError = (error: any) => {
    if (el._inFlight !== result) return;
    globalQueue.initTransition(el._transition);
    // NotReadyError from rejected promises should be treated as pending, not error
    notifyStatus(el, error instanceof NotReadyError ? STATUS_PENDING : STATUS_ERROR, error);
    el._time = clock;
  };

  const asyncWrite = (value: T, then?: () => void) => {
    if (el._inFlight !== result) return;
    // If the node was dirtied by a newer write (optimistic override or regular),
    // skip this stale async result — the upcoming flush will recompute the node
    // with the new value, creating a fresh Promise that supersedes this one.
    if (el._flags & (REACTIVE_DIRTY | REACTIVE_OPTIMISTIC_DIRTY)) return;
    globalQueue.initTransition(el._transition);
    clearStatus(el);
    const lane = resolveLane(el as any);
    if (lane) lane._pendingAsync.delete(el);
    if (setter) setter(value);
    else if (el._optimistic) {
      const hadOverride = el._pendingValue !== NOT_PENDING;
      if ((el as Computed<T>)._fn) el._pendingValue = value;
      if (!hadOverride) {
        el._value = value;
        insertSubs(el);
      }
      el._time = clock;
    } else if (lane) {
      // Route through lane's effect queue for independent flushing
      const prevValue = el._value;
      const equals = el._equals;
      if (!equals || !equals(value, prevValue)) {
        el._value = value;
        el._time = clock;
        // Write to _pendingValueComputed so pending() effects get independent lanes
        if (el._pendingValueComputed) {
          setSignal(el._pendingValueComputed, value);
        }
        insertSubs(el, true);
      }
    } else {
      setSignal(el, () => value);
    }
    schedule();
    flush();
    then?.();
  };

  if (isThenable) {
    let resolved = false,
      isSync = true;
    (result as PromiseLike<T>).then(
      v => {
        if (isSync) {
          syncValue = v;
          resolved = true;
        } else asyncWrite(v);
      },
      e => {
        if (!isSync) handleError(e);
      }
    );
    isSync = false;
    if (!resolved) {
      globalQueue.initTransition(el._transition);
      throw new NotReadyError(context!);
    }
  }

  if (iterator) {
    const it = (result as AsyncIterable<T>)[Symbol.asyncIterator]();
    let hadSyncValue = false;

    const iterate = (): boolean => {
      let syncResult: IteratorResult<T>,
        resolved = false,
        isSync = true;
      it.next().then(
        r => {
          if (isSync) {
            syncResult = r;
            resolved = true;
          } else if (!r.done) asyncWrite(r.value, iterate);
        },
        e => {
          if (!isSync) handleError(e);
        }
      );
      isSync = false;
      if (resolved && !syncResult!.done) {
        syncValue = syncResult!.value;
        hadSyncValue = true;
        return iterate();
      }
      return resolved && syncResult!.done;
    };

    const immediatelyDone = iterate();
    if (!hadSyncValue && !immediatelyDone) {
      globalQueue.initTransition(el._transition);
      throw new NotReadyError(context!);
    }
  }

  return syncValue!;
}

export function clearStatus(el: Computed<any>): void {
  // Preserve STATUS_UNINITIALIZED — it's cleared on first value commit in finalizePureQueue
  el._statusFlags = el._statusFlags & STATUS_UNINITIALIZED;
  el._error = null;
  // Update pending signal for isPending() reactivity
  updatePendingSignal(el);
  el._notifyStatus?.();
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

  const isSource = error instanceof NotReadyError && (error as NotReadyError).source === el;
  const isOptimisticBoundary = status === STATUS_PENDING && el._optimistic && !isSource;
  const startsBlocking = isOptimisticBoundary && hasActiveOverride(el);

  if (!blockStatus) {
    el._statusFlags =
      status | (status !== STATUS_ERROR ? el._statusFlags & STATUS_UNINITIALIZED : 0);
    el._error = error;
    updatePendingSignal(el);
  }

  if (lane && !blockStatus) {
    assignOrMergeLane(el, lane);
  }

  // When an optimistic boundary blocks status propagation, the notification may never
  // reach a render effect (e.g. isPending only subscribes to _pendingSignal, not the node).
  // Directly register the async source with the transition so it doesn't complete prematurely.
  if (startsBlocking && activeTransition && error instanceof NotReadyError) {
    const source = (error as NotReadyError).source;
    if (!activeTransition._asyncNodes.includes(source)) {
      activeTransition._asyncNodes.push(source);
    }
  }

  const downstreamBlockStatus = blockStatus || startsBlocking;
  const downstreamLane = blockStatus || isOptimisticBoundary ? undefined : lane;

  if (el._notifyStatus) {
    if (downstreamBlockStatus) {
      el._notifyStatus(status, error);
    } else {
      el._notifyStatus();
    }
    return;
  }
  for (let s = el._subs; s !== null; s = s._nextSub) {
    s._sub._time = clock;
    if (s._sub._error !== error) {
      !s._sub._transition && globalQueue._pendingNodes.push(s._sub);
      notifyStatus(s._sub, status, error, downstreamBlockStatus, downstreamLane);
    }
  }
  for (
    let child: FirewallSignal<unknown> | null = el._child;
    child !== null;
    child = child._nextChild
  ) {
    for (let s = child._subs; s !== null; s = s._nextSub) {
      s._sub._time = clock;
      if (s._sub._error !== error) {
        !s._sub._transition && globalQueue._pendingNodes.push(s._sub);
        notifyStatus(s._sub, status, error, downstreamBlockStatus, downstreamLane);
      }
    }
  }
}
