import {
  $REFRESH,
  defaultContext,
  EFFECT_TRACKED,
  NOT_PENDING,
  REACTIVE_CHECK,
  REACTIVE_DIRTY,
  REACTIVE_DISPOSED,
  REACTIVE_NONE,
  REACTIVE_OPTIMISTIC_DIRTY,
  REACTIVE_RECOMPUTING_DEPS,
  REACTIVE_ZOMBIE,
  STATUS_ERROR,
  STATUS_PENDING,
  STATUS_UNINITIALIZED
} from "./constants.js";
import { NotReadyError } from "./error.js";
import { clearStatus, handleAsync, notifyStatus } from "./async.js";
import { leafEffectActive } from "./effect.js";
import { link, unlinkSubs } from "./graph.js";
import {
  deleteFromHeap,
  insertIntoHeapHeight,
  markHeap,
  markNode
} from "./heap.js";
import {
  findLane,
  getOrCreateLane,
  hasActiveOverride,
  mergeLanes,
  resolveLane,
  signalLanes,
  type OptimisticLane
} from "./lanes.js";
export { handleAsync };
import {
  activeTransition,
  clock,
  dirtyQueue,
  globalQueue,
  GlobalQueue,
  insertSubs,
  projectionWriteActive,
  runInTransition,
  schedule,
  zombieQueue
} from "./scheduler.js";
import type {
  Computed,
  Disposable,
  FirewallSignal,
  Link,
  Owner,
  Root,
  Signal,
  NodeOptions
} from "./types.js";

export type { Computed, Disposable, FirewallSignal, Link, Owner, Root, Signal, NodeOptions };

import {
  createOwner,
  createRoot,
  disposeChildren,
  dispose,
  getNextChildId,
  getObserver,
  getOwner,
  markDisposal,
  onCleanup
} from "./owner.js";
export {
  createOwner,
  createRoot,
  dispose,
  getNextChildId,
  getObserver,
  getOwner,
  onCleanup
};

GlobalQueue._update = recompute;
GlobalQueue._dispose = disposeChildren;
export let tracking = false;
export let stale = false;
export let refreshing = false;
export let pendingCheckActive = false;
export let foundPending = false;
export let pendingReadActive = false;
export let context: Owner | null = null;
export let currentOptimisticLane: OptimisticLane | null = null;

export function recompute(el: Computed<any>, create: boolean = false): void {
  const isEffect = (el as any)._type;
  if (!create) {
    if (el._transition && (!isEffect || activeTransition) && activeTransition !== el._transition)
      globalQueue.initTransition(el._transition);
    deleteFromHeap(el, el._flags & REACTIVE_ZOMBIE ? zombieQueue : dirtyQueue);
    // Tracked effects run after finalizePureQueue, so dispose immediately instead of deferring
    if (el._transition || isEffect === EFFECT_TRACKED) disposeChildren(el);
    else {
      markDisposal(el);
      el._pendingDisposal = el._disposal;
      el._pendingFirstChild = el._firstChild;
      el._disposal = null;
      el._firstChild = null;
    }
  }

  const isOptimisticDirty = !!(el._flags & REACTIVE_OPTIMISTIC_DIRTY);
  const hasOverride = hasActiveOverride(el);
  // Track if node was pending (for detecting async resolution)
  const wasPending = !!(el._statusFlags & STATUS_PENDING);

  const oldcontext = context;
  context = el;
  el._depsTail = null;
  el._flags = REACTIVE_RECOMPUTING_DEPS;
  el._time = clock;
  let value = el._pendingValue === NOT_PENDING ? el._value : el._pendingValue;
  let oldHeight = el._height;
  let prevTracking = tracking;
  let prevLane = currentOptimisticLane;
  tracking = true;
  if (isOptimisticDirty) {
    const lane = resolveLane(el);
    if (lane) currentOptimisticLane = lane;
  }
  try {
    value = handleAsync(el, el._fn(value));
    clearStatus(el);
    const resolvedLane = resolveLane(el);
    if (resolvedLane) {
      resolvedLane._pendingAsync.delete(el);
      updatePendingSignal(resolvedLane._source);
    }
  } catch (e) {
    // Track pending async in the lane (not the lane's source — it creates the lane
    // but doesn't belong to it). Set lane BEFORE notifyStatus for downstream propagation.
    if (e instanceof NotReadyError && currentOptimisticLane) {
      const lane = findLane(currentOptimisticLane);
      if (lane._source !== el) {
        lane._pendingAsync.add(el);
        el._optimisticLane = lane;
        updatePendingSignal(lane._source);
      }
    }
    notifyStatus(
      el,
      e instanceof NotReadyError ? STATUS_PENDING : STATUS_ERROR,
      e,
      undefined,
      e instanceof NotReadyError ? el._optimisticLane : undefined
    );
  } finally {
    tracking = prevTracking;
    el._flags = REACTIVE_NONE;
    context = oldcontext;
  }

  if (!el._error) {
    const depsTail = el._depsTail as Link | null;
    let toRemove = depsTail !== null ? depsTail._nextDep : el._deps;
    if (toRemove !== null) {
      do {
        toRemove = unlinkSubs(toRemove);
      } while (toRemove !== null);
      if (depsTail !== null) depsTail._nextDep = null;
      else el._deps = null;
    }
    // For optimistic nodes with override, compare against _value (the readable override)
    const compareValue = hasOverride
      ? el._value
      : el._pendingValue === NOT_PENDING
        ? el._value
        : el._pendingValue;
    const valueChanged = !el._equals || !el._equals(compareValue, value);

    if (valueChanged) {
      // Capture override value before writes to detect if visible value changed
      const prevVisible = hasOverride ? el._value : undefined;

      if (create || (isEffect && activeTransition !== el._transition) || isOptimisticDirty)
        el._value = value;
      else el._pendingValue = value;

      // Version-gated correction: correct the override if the computed value differs
      // BUT only if the override hasn't been refreshed by a newer action.
      // isOptimisticDirty bypasses this: upstream _inFlight matching already ensures
      // data freshness for lane-propagated corrections.
      if (hasOverride && !isOptimisticDirty && wasPending) {
        const ov = (el as any)._overrideVersion || 0;
        const lv = (el as any)._laneVersion || 0;
        if (ov <= lv) el._value = value;
      }

      // Skip notification if override survived — visible value unchanged,
      // downstream would read the same override and recompute needlessly
      if (!hasOverride || isOptimisticDirty || el._value !== prevVisible) {
        insertSubs(el, isOptimisticDirty || hasOverride);
      }
    } else if (hasOverride) {
      // Even when value didn't change (override matches), update _pendingValue
      el._pendingValue = value;
    } else if (el._height != oldHeight) {
      for (let s = el._subs; s !== null; s = s._nextSub) {
        insertIntoHeapHeight(s._sub, s._sub._flags & REACTIVE_ZOMBIE ? zombieQueue : dirtyQueue);
      }
    }
  }
  currentOptimisticLane = prevLane;
  (!create || el._statusFlags & STATUS_PENDING) &&
    !el._transition &&
    !(activeTransition && el._optimistic) &&
    globalQueue._pendingNodes.push(el);
  el._transition &&
    isEffect &&
    activeTransition !== el._transition &&
    runInTransition(el._transition, () => recompute(el));
}


function updateIfNecessary(el: Computed<unknown>): void {
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

  if (el._flags & (REACTIVE_DIRTY | REACTIVE_OPTIMISTIC_DIRTY) || (el._error && el._time < clock)) {
    recompute(el);
  }

  el._flags = REACTIVE_NONE;
}


export function computed<T>(fn: (prev?: T) => T | PromiseLike<T> | AsyncIterable<T>): Computed<T>;
export function computed<T>(
  fn: (prev: T) => T | PromiseLike<T> | AsyncIterable<T>,
  initialValue?: T,
  options?: NodeOptions<T>
): Computed<T>;
export function computed<T>(
  fn: (prev?: T) => T | PromiseLike<T> | AsyncIterable<T>,
  initialValue?: T,
  options?: NodeOptions<T>
): Computed<T> {
  const self: Computed<T> = {
    id: options?.id ?? (context?.id != null ? getNextChildId(context) : undefined),
    _equals: options?.equals != null ? options.equals : isEqual,
    _pureWrite: !!options?.pureWrite,
    _unobserved: options?.unobserved,
    _disposal: null,
    _queue: context?._queue ?? globalQueue,
    _context: context?._context ?? defaultContext,
    _childCount: 0,
    _fn: fn,
    _value: initialValue as T,
    _height: 0,
    _child: null,
    _nextHeap: undefined,
    _prevHeap: null as any,
    _deps: null,
    _depsTail: null,
    _subs: null,
    _subsTail: null,
    _parent: context,
    _nextSibling: null,
    _firstChild: null,
    _flags: REACTIVE_NONE,
    _statusFlags: STATUS_UNINITIALIZED,
    _time: clock,
    _pendingValue: NOT_PENDING,
    _pendingDisposal: null,
    _pendingFirstChild: null,
    _inFlight: null,
    _transition: null
  } as Computed<T>;
  if (__DEV__) (self as any)._name = options?.name ?? "computed";
  self._prevHeap = self;
  const parent = (context as Root)?._root
    ? (context as Root)._parentComputed
    : (context as Computed<any> | null);
  if (__DEV__ && leafEffectActive && context) {
    throw new Error("Cannot create reactive primitives inside createTrackedEffect");
  }
  if (context) {
    const lastChild = context._firstChild;
    if (lastChild === null) {
      context._firstChild = self;
    } else {
      self._nextSibling = lastChild;
      context._firstChild = self;
    }
  }
  if (parent) self._height = parent._height + 1;
  !options?.lazy && recompute(self, true);

  return self;
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
  const s = {
    _equals: options?.equals != null ? options.equals : isEqual,
    _pureWrite: !!options?.pureWrite,
    _unobserved: options?.unobserved,
    _value: v,
    _subs: null,
    _subsTail: null,
    _time: clock,
    _firewall: firewall,
    _nextChild: firewall?._child || null,
    _pendingValue: NOT_PENDING
  };
  if (__DEV__) (s as any)._name = options?.name ?? "signal";
  firewall && (firewall._child = s as FirewallSignal<unknown>);
  return s as Signal<T>;
}

export function optimisticSignal<T>(v: T, options?: NodeOptions<T>): Signal<T> {
  const s = signal(v, options);
  s._optimistic = true;
  return s;
}

export function optimisticComputed<T>(
  fn: (prev?: T) => T | PromiseLike<T> | AsyncIterable<T>,
  initialValue?: T,
  options?: NodeOptions<T>
): Computed<T> {
  const c = computed(fn, initialValue, options);
  c._optimistic = true;
  return c;
}


export function isEqual<T>(a: T, b: T): boolean {
  return a === b;
}

/**
 * Returns the current value stored inside the given compute function without triggering any
 * dependencies. Use `untrack` if you want to also disable owner tracking.
 */
export function untrack<T>(fn: () => T): T {
  if (!tracking) return fn();
  tracking = false;
  try {
    return fn();
  } finally {
    tracking = true;
  }
}

export function read<T>(el: Signal<T> | Computed<T>): T {
  // Handle pending() mode: read from _pendingValueComputed
  // Checked before isPending so that isPending(() => pending(x)) checks
  // the _pendingSignal of _pendingValueComputed (async in flight) rather
  // than the original node (which stays "pending" while held in a transition).
  if (pendingReadActive) {
    const pendingComputed = getPendingValueComputed(el);
    const prevPending = pendingReadActive;
    pendingReadActive = false;
    const value = read(pendingComputed);
    pendingReadActive = prevPending;
    if (pendingComputed._statusFlags & STATUS_PENDING) return el._value as T;
    // Cross-lane stale read: in a child lane reading pending(x) from a parent lane
    // with unresolved async, return committed value (stale) until parent resolves.
    if (stale && currentOptimisticLane && pendingComputed._optimisticLane) {
      const pcLane = findLane(pendingComputed._optimisticLane);
      const curLane = findLane(currentOptimisticLane);
      if (pcLane !== curLane && pcLane._pendingAsync.size > 0) {
        return el._value as T;
      }
    }
    return value as T;
  }

  // Handle isPending() mode: read from _pendingSignal, set foundPending if true
  if (pendingCheckActive) {
    // For store properties, check the firewall's (projection's) pending state
    const target = (el as FirewallSignal<any>)._firewall || el;
    const pendingSig = getPendingSignal(target);
    const prevCheck = pendingCheckActive;
    pendingCheckActive = false;
    if (read(pendingSig)) {
      foundPending = true;
    }
    pendingCheckActive = prevCheck;
    return el._value as T;
  }

  let c = context;
  if ((c as Root)?._root) c = (c as Root)._parentComputed;
  if (refreshing && (el as Computed<unknown>)._fn) recompute(el as Computed<unknown>);
  if (c && tracking) {
    if ((el as Computed<unknown>)._fn && (el as Computed<unknown>)._flags & REACTIVE_DISPOSED)
      recompute(el as Computed<any>);
    link(el, c as Computed<any>);

    const owner = (el as FirewallSignal<any>)._firewall || el;
    if ((owner as Computed<unknown>)._fn) {
      const isZombie = (el as Computed<unknown>)._flags & REACTIVE_ZOMBIE;
      if (owner._height >= (isZombie ? zombieQueue._min : dirtyQueue._min)) {
        markNode(c as Computed<any>);
        markHeap(isZombie ? zombieQueue : dirtyQueue);
        updateIfNecessary(owner);
      }
      const height = owner._height;
      // parent check is shallow, might need to be recursive
      if (height >= (c as Computed<any>)._height && (el as Computed<any>)._parent !== c) {
        (c as Computed<any>)._height = height + 1;
      }
    }
  }

  const asyncCompute = (el as FirewallSignal<any>)._firewall || el;
  if (
    c &&
    asyncCompute._statusFlags & STATUS_PENDING &&
    !(stale && asyncCompute._transition && activeTransition !== asyncCompute._transition)
  ) {
    if (currentOptimisticLane) {
      // Per-lane suspension: only throw if in same lane as pending async
      // AND the node doesn't have an active override (overrides are the visible value,
      // downstream in the lane should read the override, not throw)
      const pendingLane = (asyncCompute as any)._optimisticLane;
      const lane = findLane(currentOptimisticLane);
      if (pendingLane && findLane(pendingLane) === lane && !hasActiveOverride(asyncCompute)) {
        if (!tracking) link(el, c as Computed<any>);
        throw asyncCompute._error;
      }
    } else {
      // Regular (non-optimistic) context: throw for pending async
      if (!tracking) link(el, c as Computed<any>);
      throw asyncCompute._error;
    }
  }
  if ((el as Computed<any>)._fn && (el as Computed<any>)._statusFlags & STATUS_ERROR) {
    if (el._time < clock) {
      // treat error reset like create
      recompute(el as Computed<unknown>, true);
      return read(el);
    } else throw (el as Computed<any>)._error;
  }

  // In lane context, always return _value (optimistic overrides and lane member values are there)
  // Outside lane context: return _pendingValue if set (transitioning value), otherwise _value
  return !c ||
    currentOptimisticLane !== null ||
    el._pendingValue === NOT_PENDING ||
    (stale && el._transition && activeTransition !== el._transition)
    ? el._value
    : (el._pendingValue as T);
}

export function setSignal<T>(el: Signal<T> | Computed<T>, v: T | ((prev: T) => T)): T {
  // Warn about writing to a signal in an owned scope in development mode.
  if (__DEV__ && !el._pureWrite && context && (el as FirewallSignal<any>)._firewall !== context)
    console.warn("A Signal was written to in an owned scope.");

  if (el._transition && activeTransition !== el._transition)
    globalQueue.initTransition(el._transition);

  // When projectionWriteActive is true, force non-optimistic behavior for projection writes
  const isOptimistic = el._optimistic && !projectionWriteActive;
  // Optimistic reads _value, regular reads pending or value
  const currentValue = isOptimistic
    ? el._value
    : el._pendingValue === NOT_PENDING
      ? el._value
      : (el._pendingValue as T);

  if (typeof v === "function") v = (v as (prev: T) => T)(currentValue);

  const valueChanged = !el._equals || !el._equals(currentValue, v);
  if (!valueChanged) {
    // For optimistic computeds with an active override from a previous action,
    // a correction may have updated _value to match the new override value.
    // Downstream nodes could have stale _inFlight based on old upstream data.
    // Re-propagate to invalidate those stale computations.
    if (isOptimistic && el._pendingValue !== NOT_PENDING && (el as Computed<T>)._fn) {
      insertSubs(el, true);
      schedule();
    }
    return v;
  }

  if (isOptimistic) {
    const alreadyTracked = globalQueue._optimisticNodes.includes(el);

    // Only entangle if there was a previous optimistic write (node already tracked)
    if (el._transition && alreadyTracked) {
      globalQueue.initTransition(el._transition);
    }

    // Save original only if not already saved
    if (el._pendingValue === NOT_PENDING) {
      el._pendingValue = el._value;
    }

    // Always ensure we're in the list for reversion
    if (!alreadyTracked) {
      globalQueue._optimisticNodes.push(el);
    }

    // Track override version for correction gating (must be before getOrCreateLane)
    (el as any)._overrideVersion = ((el as any)._overrideVersion || 0) + 1;

    // Create/get lane for this optimistic signal
    const lane = getOrCreateLane(el);
    el._optimisticLane = lane;

    el._value = v;
  } else {
    if (el._pendingValue === NOT_PENDING) globalQueue._pendingNodes.push(el);
    el._pendingValue = v;
  }

  // Update pending signal if it exists (for isPending reactivity)
  updatePendingSignal(el);

  // Also write to pending value computed if it exists (for pending())
  if (el._pendingValueComputed) {
    setSignal(el._pendingValueComputed, v);
  }

  el._time = clock;
  insertSubs(el, isOptimistic);
  schedule();
  return v;
}

export function runWithOwner<T>(owner: Owner | null, fn: () => T): T {
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

/**
 * Get or create the pending signal for a node (lazy).
 * Used by isPending() to track pending state reactively.
 */
function getPendingSignal(el: Signal<any> | Computed<any>): Signal<boolean> {
  if (!el._pendingSignal) {
    // Start false, write true if pending - ensures reversion returns to false
    el._pendingSignal = optimisticSignal(false, { pureWrite: true });
    // Propagate parent-child lane relationship for isPending(() => pending(x))
    if (el._parentSource) {
      el._pendingSignal._parentSource = el;
    }
    if (computePendingState(el)) setSignal(el._pendingSignal, true);
  }
  return el._pendingSignal;
}

/**
 * Compute whether a node is in "pending" state.
 * Pending means: has stale data while new data is loading.
 * Returns false for initial async loads (no stale data to show).
 */
function computePendingState(el: Signal<any> | Computed<any>): boolean {
  const comp = el as Computed<any>;
  // Optimistic nodes with active override:
  if (el._optimistic && el._pendingValue !== NOT_PENDING) {
    if (comp._statusFlags & STATUS_PENDING && !(comp._statusFlags & STATUS_UNINITIALIZED)) return true;
    // pendingValueComputed (has _parentSource): check lane for downstream async.
    // User-created optimistic: override existence means pending (bridges corrections).
    if (el._parentSource) {
      const lane = el._optimisticLane ? findLane(el._optimisticLane) : null;
      return !!(lane && lane._pendingAsync.size > 0);
    }
    return true;
  }
  // Upstream: value held in transition (not during initial load)
  if (el._pendingValue !== NOT_PENDING && !(comp._statusFlags & STATUS_UNINITIALIZED)) return true;
  // Downstream: async in flight with previous value (not initial load)
  // STATUS_UNINITIALIZED is cleared on first successful completion
  return !!(comp._statusFlags & STATUS_PENDING && !(comp._statusFlags & STATUS_UNINITIALIZED));
}

/**
 * Update _pendingSignal when pending state changes. When the override clears
 * (pending -> not pending), merge the sub-lane into the source's lane so
 * isPending effects are blocked until the full scope resolves.
 */
export function updatePendingSignal(el: Signal<any> | Computed<any>): void {
  if (el._pendingSignal) {
    const pending = computePendingState(el);
    const sig = el._pendingSignal;
    setSignal(sig, pending);
    // When override clears: merge sub-lane into source's lane
    if (!pending && sig._optimisticLane) {
      const sourceLane = resolveLane(el as any);
      if (sourceLane && sourceLane._pendingAsync.size > 0) {
        const sigLane = findLane(sig._optimisticLane);
        if (sigLane !== sourceLane) {
          mergeLanes(sourceLane, sigLane);
        }
      }
      // Clear so next write creates a fresh independent sub-lane
      signalLanes.delete(sig);
      sig._optimisticLane = undefined;
    }
  }
}

/**
 * Get or create the pending value computed for a node (lazy).
 * Used by pending() to read the in-flight value during a transition.
 */
function getPendingValueComputed<T>(el: Signal<T> | Computed<T>): Computed<T> {
  if (!el._pendingValueComputed) {
    // Save and restore context flags to prevent leaking isPending/pending
    // context into the computed's initial recompute.
    const prevPending = pendingReadActive;
    pendingReadActive = false;
    const prevCheck = pendingCheckActive;
    pendingCheckActive = false;
    const prevContext = context;
    context = null; // Detach from owner so it isn't disposed with effects
    el._pendingValueComputed = optimisticComputed(() => read(el));
    el._pendingValueComputed._parentSource = el; // Parent-child lane relationship
    context = prevContext;
    pendingCheckActive = prevCheck;
    pendingReadActive = prevPending;
  }
  return el._pendingValueComputed;
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

export function pending<T>(fn: () => T): T {
  const prevPending = pendingReadActive;
  pendingReadActive = true;
  try {
    return fn();
  } finally {
    pendingReadActive = prevPending;
  }
}

export function isPending(fn: () => any): boolean {
  const prevPendingCheck = pendingCheckActive;
  const prevFoundPending = foundPending;
  pendingCheckActive = true;
  foundPending = false;
  try {
    fn();
    return foundPending;
  } catch {
    // When a thunk throws during pending check (e.g., accessing undefined values
    // from uninitialized async memos), return foundPending. The error indicates
    // we're reading from something not yet ready.
    return foundPending;
  } finally {
    pendingCheckActive = prevPendingCheck;
    foundPending = prevFoundPending;
  }
}

export function refresh<T>(fn: (() => T) | (T & { [$REFRESH]: any })): T {
  let prevRefreshing = refreshing;
  refreshing = true;
  try {
    if (typeof fn !== "function") {
      recompute((fn as any)[$REFRESH] as Computed<any>);
      return fn;
    }
    return untrack(fn);
  } finally {
    refreshing = prevRefreshing;
    if (!prevRefreshing) {
      schedule();
    }
  }
}

export function isRefreshing(): boolean {
  return refreshing;
}
