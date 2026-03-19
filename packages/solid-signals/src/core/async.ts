import {
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
import { context, setSignal, untrack, updatePendingSignal } from "./core.js";
import { NotReadyError, StatusError } from "./error.js";
import { insertIntoHeap } from "./heap.js";
import { hasActiveOverride, resolveLane, resolveTransition, type OptimisticLane } from "./lanes.js";
import {
  addTransitionBlocker,
  assignOrMergeLane,
  clock,
  dirtyQueue,
  flush,
  globalQueue,
  insertSubs,
  removeTransitionBlocker,
  schedule,
  zombieQueue
} from "./scheduler.js";
import type { Computed, FirewallSignal } from "./types.js";

function addPendingSource(el: Computed<any>, source: Computed<any>): boolean {
  if (el._pendingSource === source || el._pendingSources?.has(source)) return false;
  if (!el._pendingSource) {
    el._pendingSource = source;
    return true;
  }
  if (!el._pendingSources) {
    el._pendingSources = new Set([el._pendingSource, source]);
  } else {
    el._pendingSources.add(source);
  }
  el._pendingSource = undefined;
  return true;
}

function removePendingSource(el: Computed<any>, source: Computed<any>): boolean {
  if (el._pendingSource) {
    if (el._pendingSource !== source) return false;
    el._pendingSource = undefined;
    return true;
  }
  if (!el._pendingSources?.delete(source)) return false;
  if (el._pendingSources.size === 1) {
    el._pendingSource = el._pendingSources.values().next().value;
    el._pendingSources = undefined;
  } else if (el._pendingSources.size === 0) {
    el._pendingSources = undefined;
  }
  return true;
}

function clearPendingSources(el: Computed<any>): void {
  el._pendingSource = undefined;
  el._pendingSources?.clear();
  el._pendingSources = undefined;
}

function setPendingError(el: Computed<any>, source?: Computed<any>, error?: any): void {
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

function forEachDependent(el: Computed<any>, fn: (node: Computed<any>) => void): void {
  for (let s = el._subs; s !== null; s = s._nextSub) fn(s._sub);
  for (
    let child: FirewallSignal<unknown> | null = el._child;
    child !== null;
    child = child._nextChild
  ) {
    for (let s = child._subs; s !== null; s = s._nextSub) fn(s._sub);
  }
}

export function settlePendingSource(el: Computed<any>): void {
  let scheduled = false;
  const visited = new Set<Computed<any>>();
  const settle = (node: Computed<any>) => {
    if (visited.has(node) || !removePendingSource(node, el)) return;
    visited.add(node);
    node._time = clock;
    const source = node._pendingSource ?? node._pendingSources?.values().next().value;
    if (source) {
      setPendingError(node, source);
      updatePendingSignal(node);
    } else {
      node._statusFlags &= ~STATUS_PENDING;
      setPendingError(node);
      updatePendingSignal(node);
      if (node._blocked) {
        if ((node as any)._type === EFFECT_TRACKED) {
          const tracked = node as any;
          if (!tracked._modified) {
            tracked._modified = true;
            tracked._queue.enqueue(EFFECT_USER, tracked._run);
          }
        } else {
          const queue = node._flags & REACTIVE_ZOMBIE ? zombieQueue : dirtyQueue;
          if (queue._min > node._height) queue._min = node._height;
          insertIntoHeap(node, queue);
        }
        scheduled = true;
      }
      node._blocked = false;
    }
    forEachDependent(node, settle);
  };

  forEachDependent(el, settle);

  if (scheduled) schedule();
}

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
    globalQueue.initTransition(resolveTransition(el as any));
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
    globalQueue.initTransition(resolveTransition(el as any));
    clearStatus(el);
    const lane = resolveLane(el as any);
    if (lane) lane._pendingAsync.delete(el);
    if (setter) setter(value);
    else if (el._overrideValue !== undefined) {
      if (el._overrideValue !== undefined && el._overrideValue !== NOT_PENDING)
        el._pendingValue = value;
      else {
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
        // Write to _latestValueComputed so latest() effects get independent lanes
        if (el._latestValueComputed) {
          setSignal(el._latestValueComputed, value);
        }
        insertSubs(el, true);
      }
    } else {
      setSignal(el, () => value);
    }
    settlePendingSource(el);
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
      globalQueue.initTransition(resolveTransition(el as any));
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
          else {
            schedule();
            flush();
          }
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
      globalQueue.initTransition(resolveTransition(el as any));
      throw new NotReadyError(context!);
    }
  }

  return syncValue!;
}

export function clearStatus(el: Computed<any>, clearUninitialized: boolean = false): void {
  clearPendingSources(el);
  removeTransitionBlocker(el);
  el._blocked = false;
  el._statusFlags = clearUninitialized ? 0 : el._statusFlags & STATUS_UNINITIALIZED;
  setPendingError(el);
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
      setPendingError(el, el._pendingSource ?? el._pendingSources?.values().next().value, error);
      if (pendingSource === el) addTransitionBlocker(el);
    } else {
      clearPendingSources(el);
      removeTransitionBlocker(el);
      el._statusFlags =
        status | (status !== STATUS_ERROR ? el._statusFlags & STATUS_UNINITIALIZED : 0);
      el._error = error;
    }
    updatePendingSignal(el);
  }

  if (lane && !blockStatus) {
    assignOrMergeLane(el, lane);
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
  forEachDependent(el, sub => {
    sub._time = clock;
    if (
      (status === STATUS_PENDING &&
        pendingSource &&
        sub._pendingSource !== pendingSource &&
        !sub._pendingSources?.has(pendingSource)) ||
      (status !== STATUS_PENDING &&
        (sub._error !== error || sub._pendingSource || sub._pendingSources))
    ) {
      !sub._transition && globalQueue._pendingNodes.push(sub);
      notifyStatus(sub, status, error, downstreamBlockStatus, downstreamLane);
    }
  });
}
