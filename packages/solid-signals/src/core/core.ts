import { clearStatus, handleAsync, notifyStatus } from "./async.js";
import {
  $REFRESH,
  defaultContext,
  EFFECT_TRACKED,
  NO_SNAPSHOT,
  NOT_PENDING,
  REACTIVE_CHECK,
  REACTIVE_DIRTY,
  REACTIVE_DISPOSED,
  REACTIVE_LAZY,
  REACTIVE_NONE,
  REACTIVE_OPTIMISTIC_DIRTY,
  REACTIVE_RECOMPUTING_DEPS,
  REACTIVE_SNAPSHOT_STALE,
  REACTIVE_ZOMBIE,
  STATUS_ERROR,
  STATUS_PENDING,
  STATUS_UNINITIALIZED,
  STORE_SNAPSHOT_PROPS
} from "./constants.js";
import { NotReadyError } from "./error.js";
import { externalSourceConfig } from "./external.js";
import { link, unlinkSubs } from "./graph.js";
import {
  deleteFromHeap,
  insertIntoHeap,
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
  resolveTransition,
  signalLanes,
  type OptimisticLane
} from "./lanes.js";
import { cleanup, disposeChildren, getNextChildId, markDisposal } from "./owner.js";
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
  shouldReadStashedOptimisticValue,
  zombieQueue
} from "./scheduler.js";
import type {
  Computed,
  Disposable,
  FirewallSignal,
  Link,
  NodeOptions,
  Owner,
  Root,
  Signal
} from "./types.js";

GlobalQueue._update = recompute;
GlobalQueue._dispose = disposeChildren;
export let tracking = false;
export let stale = false;
export let refreshing = false;
export let pendingCheckActive = false;
export let foundPending = false;
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
      comp._inSnapshotScope = false;
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
      delete source._snapshotValue;
      delete source[STORE_SNAPSHOT_PROPS];
    }
    snapshotSources = null;
  }
  snapshotCaptureActive = false;
}

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
      el._childCount = 0;
    }
  }

  const isOptimisticDirty = !!(el._flags & REACTIVE_OPTIMISTIC_DIRTY);
  const hasOverride = el._overrideValue !== undefined && el._overrideValue !== NOT_PENDING;
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
  let prevStrictRead: string | false = false;
  if (__DEV__) {
    prevStrictRead = strictRead;
    strictRead = false;
  }
  tracking = true;
  if (isOptimisticDirty) {
    const lane = resolveLane(el);
    if (lane) currentOptimisticLane = lane;
  }
  try {
    value = handleAsync(el, el._fn(value));
    clearStatus(el, create);
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
    if (e instanceof NotReadyError) el._blocked = true;
    notifyStatus(
      el,
      e instanceof NotReadyError ? STATUS_PENDING : STATUS_ERROR,
      e,
      undefined,
      e instanceof NotReadyError ? el._optimisticLane : undefined
    );
  } finally {
    tracking = prevTracking;
    if (__DEV__) strictRead = prevStrictRead;
    el._flags = REACTIVE_NONE | (create ? el._flags & REACTIVE_SNAPSHOT_STALE : 0);
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
    const compareValue = hasOverride
      ? el._overrideValue
      : el._pendingValue === NOT_PENDING
        ? el._value
        : el._pendingValue;
    const valueChanged = !el._equals || !el._equals(compareValue, value);

    if (valueChanged) {
      const prevVisible = hasOverride ? el._overrideValue : undefined;

      if (create || (isEffect && activeTransition !== el._transition) || isOptimisticDirty) {
        el._value = value;
        // Lane-propagated correction: upstream data is fresh, correct override unconditionally
        if (hasOverride && isOptimisticDirty) {
          el._overrideValue = value;
          el._pendingValue = value;
        }
      } else el._pendingValue = value;

      // Correct override for async resolution (non-lane path) unless user wrote since lane creation
      if (hasOverride && !isOptimisticDirty && wasPending && !(el as any)._overrideSinceLane)
        el._overrideValue = value;

      if (!hasOverride || isOptimisticDirty || el._overrideValue !== prevVisible)
        insertSubs(el, isOptimisticDirty || hasOverride);
    } else if (hasOverride) {
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
    !(activeTransition && hasOverride) &&
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

  if (
    el._flags & (REACTIVE_DIRTY | REACTIVE_OPTIMISTIC_DIRTY) ||
    (el._error && el._time < clock && !el._inFlight)
  ) {
    recompute(el);
  }

  el._flags = REACTIVE_NONE | (el._flags & REACTIVE_SNAPSHOT_STALE);
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
  const transparent = options?.transparent ?? false;
  const self: Computed<T> = {
    id:
      options?.id ??
      (transparent ? context?.id : context?.id != null ? getNextChildId(context) : undefined),
    _transparent: transparent || undefined,
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
    _flags: options?.lazy ? REACTIVE_LAZY : REACTIVE_NONE,
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
  if (__DEV__ && context?._childrenForbidden) {
    throw new Error(
      "Cannot create reactive primitives inside createTrackedEffect or owner-backed onSettled"
    );
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
  if (snapshotCaptureActive && ownerInSnapshotScope(context)) self._inSnapshotScope = true;
  if (externalSourceConfig) {
    const bridgeSignal = signal<undefined>(undefined, { equals: false, pureWrite: true });
    const source = externalSourceConfig.factory(self._fn as any, () => {
      setSignal(bridgeSignal, undefined);
    });
    cleanup(() => source.dispose());
    self._fn = ((prev: any) => {
      read(bridgeSignal);
      return source.track(prev);
    }) as any;
  }
  !options?.lazy && recompute(self, true);
  if (snapshotCaptureActive && !options?.lazy) {
    if (!(self._statusFlags & STATUS_PENDING)) {
      self._snapshotValue = self._value === undefined ? NO_SNAPSHOT : self._value;
      snapshotSources!.add(self);
    }
  }

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
    _noSnapshot: !!options?._noSnapshot,
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
  if (
    snapshotCaptureActive &&
    !s._noSnapshot &&
    !((firewall?._statusFlags ?? 0) & STATUS_PENDING)
  ) {
    (s as any)._snapshotValue = v === undefined ? NO_SNAPSHOT : v;
    snapshotSources!.add(s);
  }
  return s as Signal<T>;
}

export function optimisticSignal<T>(v: T, options?: NodeOptions<T>): Signal<T> {
  const s = signal(v, options);
  s._overrideValue = NOT_PENDING;
  return s;
}

export function optimisticComputed<T>(
  fn: (prev?: T) => T | PromiseLike<T> | AsyncIterable<T>,
  initialValue?: T,
  options?: NodeOptions<T>
): Computed<T> {
  const c = computed(fn, initialValue, options);
  c._overrideValue = NOT_PENDING;
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
 * Executes `fn` without tracking reactive dependencies.
 *
 * Pass a `strictReadLabel` string to enable strict-read warnings: any reactive read inside `fn`
 * that is not inside a nested tracking scope will log a warning in dev mode.
 */
export function untrack<T>(fn: () => T, strictReadLabel?: string | false): T {
  if (!externalSourceConfig && !tracking && (!__DEV__ || (!strictRead && !strictReadLabel)))
    return fn();
  const prevTracking = tracking;
  const prevStrictRead = strictRead;
  tracking = false;
  if (__DEV__) strictRead = strictReadLabel || false;
  try {
    if (externalSourceConfig) return externalSourceConfig.untrack(fn);
    return fn();
  } finally {
    tracking = prevTracking;
    if (__DEV__) strictRead = prevStrictRead;
  }
}

export function read<T>(el: Signal<T> | Computed<T>): T {
  // Handle latest() mode: read from _latestValueComputed
  // Checked before isPending so that isPending(() => latest(x)) checks
  // the _pendingSignal of _latestValueComputed (async in flight) rather
  // than the original node (which stays "pending" while held in a transition).
  if (latestReadActive) {
    const pendingComputed = getLatestValueComputed(el);
    const prevPending = latestReadActive;
    latestReadActive = false;
    const visibleValue = (
      el._overrideValue !== undefined && el._overrideValue !== NOT_PENDING
        ? el._overrideValue
        : el._value
    ) as T;
    let value: T;
    try {
      value = read(pendingComputed);
    } catch (e) {
      if (!context && e instanceof NotReadyError) return visibleValue;
      throw e;
    } finally {
      latestReadActive = prevPending;
    }
    if (pendingComputed._statusFlags & STATUS_PENDING) return visibleValue;
    // Cross-lane stale read: a child lane should keep seeing the parent's
    // committed value until the parent lane resolves.
    if (stale && currentOptimisticLane && pendingComputed._optimisticLane) {
      const pcLane = findLane(pendingComputed._optimisticLane);
      const curLane = findLane(currentOptimisticLane);
      if (pcLane !== curLane && pcLane._pendingAsync.size > 0) {
        return visibleValue;
      }
    }
    return value as T;
  }

  // Handle isPending() mode: read from _pendingSignal, set foundPending if true
  if (pendingCheckActive) {
    const firewall = (el as FirewallSignal<any>)._firewall;
    const prevCheck = pendingCheckActive;
    pendingCheckActive = false;
    if (firewall && el._overrideValue !== undefined) {
      if (
        el._overrideValue !== NOT_PENDING &&
        (firewall._inFlight || !!(firewall._statusFlags & STATUS_PENDING))
      ) {
        foundPending = true;
      }
    } else {
      if (read(getPendingSignal(el))) foundPending = true;
      if (firewall && read(getPendingSignal(firewall))) foundPending = true;
    }
    pendingCheckActive = prevCheck;
    return el._value as T;
  }

  let c = context;
  if ((c as Root)?._root) c = (c as Root)._parentComputed;
  if (refreshing && (el as Computed<unknown>)._fn) recompute(el as Computed<unknown>);
  if ((el as Computed<unknown>)._flags & REACTIVE_LAZY) {
    (el as Computed<unknown>)._flags &= ~REACTIVE_LAZY;
    recompute(el as Computed<any>, true);
  }
  const owner = (el as FirewallSignal<any>)._firewall || el;

  if (__DEV__ && strictRead && owner._statusFlags & STATUS_PENDING) {
    throw new Error(
      `Reading a pending async value directly in ${strictRead}. ` +
        `Async values must be read within a tracking scope (JSX, a memo, or an effect's compute function).`
    );
  }

  if (c && tracking) {
    if ((el as Computed<unknown>)._fn && (el as Computed<unknown>)._flags & REACTIVE_DISPOSED)
      recompute(el as Computed<any>);
    link(el, c as Computed<any>);

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

  if (owner._statusFlags & STATUS_PENDING) {
    if (c && !(stale && owner._transition && activeTransition !== owner._transition)) {
      if (__DEV__ && c?._childrenForbidden) {
        console.warn(
          "Reading a pending async value inside createTrackedEffect or onSettled will throw. " +
            "Use createEffect instead which supports async-aware reactivity."
        );
      }
      if (currentOptimisticLane) {
        // Per-lane suspension: only throw if in same lane as pending async
        // AND the node doesn't have an active override (overrides are the visible value,
        // downstream in the lane should read the override, not throw)
        const pendingLane = (owner as any)._optimisticLane;
        const lane = findLane(currentOptimisticLane);
        if (pendingLane && findLane(pendingLane) === lane && !hasActiveOverride(owner)) {
          if (!tracking && el !== c) link(el, c as Computed<any>);
          throw owner._error;
        }
      } else {
        if (!tracking && el !== c) link(el, c as Computed<any>);
        throw owner._error;
      }
    } else if (c && owner !== el && owner._statusFlags & STATUS_UNINITIALIZED) {
      if (!tracking && el !== c) link(el, c as Computed<any>);
      throw owner._error;
    } else if (!c && owner._statusFlags & STATUS_UNINITIALIZED) {
      throw owner._error;
    }
  }
  if ((el as Computed<any>)._fn && (el as Computed<any>)._statusFlags & STATUS_ERROR) {
    if (el._time < clock) {
      // treat error reset like create
      recompute(el as Computed<unknown>, true);
      return read(el);
    } else throw (el as Computed<any>)._error;
  }

  if (snapshotCaptureActive && c && (c as Computed<any>)._inSnapshotScope) {
    const sv = el._snapshotValue;
    if (sv !== undefined) {
      const snapshot = sv === NO_SNAPSHOT ? undefined : sv;
      const current = el._pendingValue !== NOT_PENDING ? el._pendingValue : el._value;
      if (current !== snapshot) (c as Computed<any>)._flags |= REACTIVE_SNAPSHOT_STALE;
      return snapshot as T;
    }
  }

  if (__DEV__ && strictRead)
    console.warn(
      `Reactive value read directly in ${strictRead} will not update. ` +
        `Move it into a tracking scope (JSX, a memo, or an effect's compute function).`
    );

  if (el._overrideValue !== undefined && el._overrideValue !== NOT_PENDING) {
    if (c && stale && shouldReadStashedOptimisticValue(el as Signal<any>)) return el._value as T;
    return el._overrideValue as T;
  }

  // In optimistic lane context, return _value for optimistic/lane-assigned signals
  // and for regular signals in stale mode (render effects). Non-stale readers (user
  // effects) see _pendingValue so that latest() and direct reads stay consistent.
  // Exception: resolved projection store properties (firewall, owner !== el) whose
  // STATUS_PENDING has been cleared always return _pendingValue.
  return !c ||
    (currentOptimisticLane !== null &&
      (el._overrideValue !== undefined ||
        (el as any)._optimisticLane ||
        (owner === el && stale) ||
        !!(owner._statusFlags & STATUS_PENDING))) ||
    el._pendingValue === NOT_PENDING ||
    (stale && el._transition && activeTransition !== el._transition)
    ? el._value
    : (el._pendingValue as T);
}

export function setSignal<T>(el: Signal<T> | Computed<T>, v: T | ((prev: T) => T)): T {
  // Warn about writing to a signal in an owned scope in development mode.
  if (
    __DEV__ &&
    !el._pureWrite &&
    !context?._childrenForbidden &&
    context &&
    (el as FirewallSignal<any>)._firewall !== context
  )
    console.warn("A Signal was written to in an owned scope.");

  if (el._transition && activeTransition !== el._transition)
    globalQueue.initTransition(el._transition);

  const isOptimistic = el._overrideValue !== undefined && !projectionWriteActive;
  const hasOverride = el._overrideValue !== undefined && el._overrideValue !== NOT_PENDING;
  const currentValue = isOptimistic
    ? hasOverride
      ? (el._overrideValue as T)
      : el._value
    : el._pendingValue === NOT_PENDING
      ? el._value
      : (el._pendingValue as T);

  if (typeof v === "function") v = (v as (prev: T) => T)(currentValue);

  const valueChanged =
    !el._equals ||
    !el._equals(currentValue, v) ||
    !!((el as Computed<T>)._statusFlags & STATUS_UNINITIALIZED);
  if (!valueChanged) {
    // Re-propagate for optimistic computeds with active override — downstream
    // nodes may have stale _inFlight based on old upstream data.
    if (isOptimistic && hasOverride && (el as Computed<T>)._fn) {
      insertSubs(el, true);
      schedule();
    }
    return v;
  }

  if (isOptimistic) {
    const firstOverride = el._overrideValue === NOT_PENDING;
    if (!firstOverride) globalQueue.initTransition(resolveTransition(el as any));
    if (firstOverride) {
      el._pendingValue = el._value;
      globalQueue._optimisticNodes.push(el);
    }

    (el as any)._overrideSinceLane = true;

    const lane = getOrCreateLane(el);
    el._optimisticLane = lane;

    el._overrideValue = v;
  } else {
    if (el._pendingValue === NOT_PENDING) globalQueue._pendingNodes.push(el);
    el._pendingValue = v;
  }

  // Update pending signal if it exists (for isPending reactivity)
  updatePendingSignal(el);

  // Also write to latest value computed if it exists (for latest())
  if (el._latestValueComputed) {
    setSignal(el._latestValueComputed, v);
  }

  el._time = clock;
  insertSubs(el, isOptimistic);
  schedule();
  return v;
}

export function runWithOwner<T>(owner: Owner | null, fn: () => T): T {
  if (__DEV__ && owner && (owner as any)._flags & REACTIVE_DISPOSED)
    console.warn(
      "runWithOwner called with a disposed owner. Children created inside will never be disposed."
    );
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
    // Propagate parent-child lane relationship for isPending(() => latest(x))
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
  const firewall = (el as FirewallSignal<any>)._firewall;
  if (firewall && el._pendingValue !== NOT_PENDING) {
    return !firewall._inFlight && !(firewall._statusFlags & STATUS_PENDING);
  }
  // Optimistic nodes with active override:
  if (el._overrideValue !== undefined && el._overrideValue !== NOT_PENDING) {
    if (comp._statusFlags & STATUS_PENDING && !(comp._statusFlags & STATUS_UNINITIALIZED))
      return true;
    // Internal pending/latest helpers carry `_parentSource`; user-created
    // optimistic nodes just stay pending while the override is active.
    if (el._parentSource) {
      const lane = el._optimisticLane ? findLane(el._optimisticLane) : null;
      return !!(lane && lane._pendingAsync.size > 0);
    }
    return true;
  }
  if (el._overrideValue !== undefined && el._overrideValue === NOT_PENDING && !el._parentSource) {
    return false;
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
 * Get or create the latest value computed for a node (lazy).
 * Used by latest() to read the in-flight value during a transition.
 */
function getLatestValueComputed<T>(el: Signal<T> | Computed<T>): Computed<T> {
  if (!el._latestValueComputed) {
    // Save and restore context flags to prevent leaking isPending/latest
    // context into the computed's initial recompute.
    const prevPending = latestReadActive;
    latestReadActive = false;
    const prevCheck = pendingCheckActive;
    pendingCheckActive = false;
    const prevContext = context;
    context = null; // Detach from owner so it isn't disposed with effects
    el._latestValueComputed = optimisticComputed(() => read(el));
    el._latestValueComputed._parentSource = el; // Parent-child lane relationship
    context = prevContext;
    pendingCheckActive = prevCheck;
    latestReadActive = prevPending;
  }
  return el._latestValueComputed;
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

export function latest<T>(fn: () => T): T {
  const prevLatest = latestReadActive;
  latestReadActive = true;
  try {
    return fn();
  } finally {
    latestReadActive = prevLatest;
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
