import {
  $REFRESH,
  defaultContext,
  EFFECT_TRACKED,
  NOT_PENDING,
  REACTIVE_CHECK,
  REACTIVE_DIRTY,
  REACTIVE_DISPOSED,
  REACTIVE_IN_HEAP,
  REACTIVE_NONE,
  REACTIVE_OPTIMISTIC_DIRTY,
  REACTIVE_RECOMPUTING_DEPS,
  REACTIVE_ZOMBIE,
  STATUS_ERROR,
  STATUS_NONE,
  STATUS_PENDING,
  STATUS_UNINITIALIZED
} from "./constants.js";
import { NotReadyError, StatusError } from "./error.js";
import {
  deleteFromHeap,
  insertIntoHeap,
  insertIntoHeapHeight,
  markHeap,
  markNode
} from "./heap.js";
import {
  activeTransition,
  assignOrMergeLane,
  clearLaneEntry,
  clock,
  currentOptimisticLane,
  dirtyQueue,
  findLane,
  flush,
  getOrCreateLane,
  globalQueue,
  GlobalQueue,
  hasActiveOverride,
  insertSubs,
  mergeLanes,
  projectionWriteActive,
  resolveLane,
  runInTransition,
  schedule,
  setCurrentOptimisticLane,
  zombieQueue,
  type IQueue,
  type OptimisticLane,
  type Transition
} from "./scheduler.js";

export interface Disposable {
  (): void;
}
export interface Link {
  _dep: Signal<unknown> | Computed<unknown>;
  _sub: Computed<unknown>;
  _nextDep: Link | null;
  _prevSub: Link | null;
  _nextSub: Link | null;
}

export interface SignalOptions<T> {
  id?: string;
  name?: string;
  equals?: ((prev: T, next: T) => boolean) | false;
  pureWrite?: boolean;
  unobserved?: () => void;
  lazy?: boolean;
}

export interface RawSignal<T> {
  _subs: Link | null;
  _subsTail: Link | null;
  _value: T;
  _name?: string;
  _equals: false | ((a: T, b: T) => boolean);
  _pureWrite?: boolean;
  _unobserved?: () => void;
  _time: number;
  _transition: Transition | null;
  _pendingValue: T | typeof NOT_PENDING;
  _optimistic?: boolean;
  _optimisticLane?: OptimisticLane; // Lane this node is associated with (for optimistic propagation)
  _pendingSignal?: Signal<boolean>; // Lazy signal for isPending()
  _pendingValueComputed?: Computed<T>; // Lazy computed for pending()
}

export interface FirewallSignal<T> extends RawSignal<T> {
  _firewall: Computed<any>;
  _nextChild: FirewallSignal<unknown> | null;
}

export type Signal<T> = RawSignal<T> | FirewallSignal<T>;
export interface Owner {
  id?: string;
  _disposal: Disposable | Disposable[] | null;
  _parent: Owner | null;
  _context: Record<symbol | string, unknown>;
  _childCount: number;
  _queue: IQueue;
  _firstChild: Owner | null;
  _nextSibling: Owner | null;
  _pendingDisposal: Disposable | Disposable[] | null;
  _pendingFirstChild: Owner | null;
}

export interface Computed<T> extends RawSignal<T>, Owner {
  _deps: Link | null;
  _depsTail: Link | null;
  _flags: number;
  _error?: unknown;
  _statusFlags: number;
  _height: number;
  _nextHeap: Computed<any> | undefined;
  _prevHeap: Computed<any>;
  _fn: (prev?: T) => T;
  _inFlight: PromiseLike<T> | AsyncIterable<T> | null;
  _child: FirewallSignal<any> | null;
  _notifyStatus?: (status?: number, error?: any) => void;
}

export interface Root extends Owner {
  _root: true;
  _parentComputed: Computed<any> | null;
  dispose(self?: boolean): void;
}

GlobalQueue._update = recompute;
GlobalQueue._dispose = disposeChildren;
let tracking = false;
let stale = false;
let refreshing = false;
let pendingCheckActive = false;
let foundPending = false;
let pendingReadActive = false;
export let context: Owner | null = null;
let leafEffectActive = false;
export function setLeafEffectActive(v: boolean) {
  leafEffectActive = v;
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
    if (lane) setCurrentOptimisticLane(lane);
  }
  try {
    value = handleAsync(el, el._fn(value));
    clearStatus(el);
    const resolvedLane = resolveLane(el);
    if (resolvedLane) resolvedLane._pendingAsync.delete(el);
  } catch (e) {
    // Track pending async in the current lane, but NOT the lane's source node
    // The source creates the lane but doesn't belong to it - only downstream nodes do
    // Set lane BEFORE notifyStatus so it can propagate it downstream
    if (e instanceof NotReadyError && currentOptimisticLane) {
      const lane = findLane(currentOptimisticLane);
      if (lane._source !== el) {
        lane._pendingAsync.add(el);
        el._optimisticLane = lane;
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
      : (el._pendingValue === NOT_PENDING ? el._value : el._pendingValue);
    const valueChanged = !el._equals || !el._equals(compareValue, value);

    if (valueChanged) {
      // Write to _value if: creating, effect outside transition, or optimistic-dirty
      if (create || (isEffect && activeTransition !== el._transition) || isOptimisticDirty)
        el._value = value;
      else el._pendingValue = value;

      // For optimistic nodes: correct the override if the computed value differs
      // BUT only if the override hasn't been refreshed by a newer action
      // (compare current version against the version when the lane was created)
      if (hasOverride && !isOptimisticDirty && wasPending) {
        const ov = (el as any)._overrideVersion || 0;
        const lv = (el as any)._laneVersion || 0;
        if (ov <= lv) {
          el._value = value;
        }
      }

      // Route to optimistic queue if optimistic-dirty OR has an active optimistic override
      insertSubs(el, isOptimisticDirty || hasOverride);
    } else if (hasOverride) {
      // Even when value didn't change (override matches), update _pendingValue
      el._pendingValue = value;
    } else if (el._height != oldHeight) {
      for (let s = el._subs; s !== null; s = s._nextSub) {
        insertIntoHeapHeight(s._sub, s._sub._flags & REACTIVE_ZOMBIE ? zombieQueue : dirtyQueue);
      }
    }
  }
  setCurrentOptimisticLane(prevLane);
  (!create || el._statusFlags & STATUS_PENDING) &&
    !el._transition &&
    !(activeTransition && el._optimistic) &&
    globalQueue._pendingNodes.push(el);
  el._transition &&
    isEffect &&
    activeTransition !== el._transition &&
    runInTransition(el._transition, () => recompute(el));
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
    globalQueue.initTransition(el._transition);
    // NotReadyError from rejected promises should be treated as pending, not error
    notifyStatus(el, error instanceof NotReadyError ? STATUS_PENDING : STATUS_ERROR, error);
    el._time = clock;
  };

  const asyncWrite = (value: T, then?: () => void) => {
    if (el._inFlight !== result) return;
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

function clearStatus(el: Computed<any>): void {
  el._statusFlags = STATUS_NONE;
  el._error = null;
  // Update pending signal for isPending() reactivity
  updatePendingSignal(el);
  el._notifyStatus?.();
}

function notifyStatus(
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

  const isSource = error instanceof NotReadyError && (error as NotReadyError)._source === el;
  const isOptimisticBoundary = status === STATUS_PENDING && el._optimistic && !isSource;
  const startsBlocking = isOptimisticBoundary && hasActiveOverride(el);

  if (!blockStatus) {
    el._statusFlags = status | (status !== STATUS_ERROR ? el._statusFlags & STATUS_UNINITIALIZED : 0);
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
    const source = (error as NotReadyError)._source;
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

  if (el._flags & REACTIVE_DIRTY || el._error && el._time < clock) {
    recompute(el);
  }

  el._flags = REACTIVE_NONE;
}

// https://github.com/stackblitz/alien-signals/blob/v2.0.3/src/system.ts#L100
function unlinkSubs(link: Link): Link | null {
  const dep = link._dep;
  const nextDep = link._nextDep;
  const nextSub = link._nextSub;
  const prevSub = link._prevSub;
  if (nextSub !== null) nextSub._prevSub = prevSub;
  else dep._subsTail = prevSub;

  if (prevSub !== null) prevSub._nextSub = nextSub;
  else {
    dep._subs = nextSub;
    if (nextSub === null) {
      dep._unobserved?.();
      // No more subscribers, unwatch if computed
      (dep as Computed<any>)._fn &&
        !(dep as any)._preventAutoDisposal &&
        unobserved(dep as Computed<any>);
    }
  }
  return nextDep;
}

function unobserved(el: Computed<unknown>) {
  deleteFromHeap(el, el._flags & REACTIVE_ZOMBIE ? zombieQueue : dirtyQueue);
  let dep = el._deps;
  while (dep !== null) {
    dep = unlinkSubs(dep);
  }
  el._deps = null;
  disposeChildren(el, true);
}

// https://github.com/stackblitz/alien-signals/blob/v2.0.3/src/system.ts#L52
function link(dep: Signal<any> | Computed<any>, sub: Computed<any>) {
  const prevDep = sub._depsTail;
  if (prevDep !== null && prevDep._dep === dep) return;

  let nextDep: Link | null = null;
  const isRecomputing = sub._flags & REACTIVE_RECOMPUTING_DEPS;
  if (isRecomputing) {
    nextDep = prevDep !== null ? prevDep._nextDep : sub._deps;
    if (nextDep !== null && nextDep._dep === dep) {
      sub._depsTail = nextDep;
      return;
    }
  }

  const prevSub = dep._subsTail;
  if (prevSub !== null && prevSub._sub === sub && (!isRecomputing || isValidLink(prevSub, sub)))
    return;

  const newLink =
    (sub._depsTail =
    dep._subsTail =
      {
        _dep: dep,
        _sub: sub,
        _nextDep: nextDep,
        _prevSub: prevSub,
        _nextSub: null
      });
  if (prevDep !== null) prevDep._nextDep = newLink;
  else sub._deps = newLink;

  if (prevSub !== null) prevSub._nextSub = newLink;
  else dep._subs = newLink;
}

// https://github.com/stackblitz/alien-signals/blob/v2.0.3/src/system.ts#L284
function isValidLink(checkLink: Link, sub: Computed<unknown>): boolean {
  const depsTail = sub._depsTail;
  if (depsTail !== null) {
    let link = sub._deps!;
    do {
      if (link === checkLink) return true;
      if (link === depsTail) break;
      link = link._nextDep!;
    } while (link !== null);
  }
  return false;
}

function markDisposal(el: Owner): void {
  let child = el._firstChild;
  while (child) {
    (child as Computed<unknown>)._flags |= REACTIVE_ZOMBIE;
    if ((child as Computed<unknown>)._flags & REACTIVE_IN_HEAP) {
      deleteFromHeap(child as Computed<unknown>, dirtyQueue);
      insertIntoHeap(child as Computed<unknown>, zombieQueue);
    }
    markDisposal(child);
    child = child._nextSibling;
  }
}

export function dispose(node: Computed<unknown>): void {
  let toRemove = node._deps || null;
  do {
    toRemove = unlinkSubs(toRemove!);
  } while (toRemove !== null);
  node._deps = null;
  node._depsTail = null;
  disposeChildren(node, true);
}

function disposeChildren(node: Owner, self: boolean = false, zombie?: boolean): void {
  if ((node as any)._flags & REACTIVE_DISPOSED) return;
  if (self) (node as any)._flags = REACTIVE_DISPOSED;
  let child = zombie ? (node._pendingFirstChild as Owner) : node._firstChild;
  while (child) {
    const nextChild = child._nextSibling;
    if ((child as Computed<unknown>)._deps) {
      const n = child as Computed<unknown>;
      deleteFromHeap(n, n._flags & REACTIVE_ZOMBIE ? zombieQueue : dirtyQueue);
      let toRemove = n._deps;
      do {
        toRemove = unlinkSubs(toRemove!);
      } while (toRemove !== null);
      n._deps = null;
      n._depsTail = null;
    }
    disposeChildren(child, true);
    child = nextChild;
  }
  if (zombie) {
    node._pendingFirstChild = null;
  } else {
    node._firstChild = null;
    node._nextSibling = null;
  }
  runDisposal(node, zombie);
}

function runDisposal(node: Owner, zombie?: boolean): void {
  let disposal = zombie ? node._pendingDisposal : node._disposal;
  if (!disposal) return;

  if (Array.isArray(disposal)) {
    for (let i = 0; i < disposal.length; i++) {
      const callable = disposal[i];
      callable.call(callable);
    }
  } else {
    (disposal as Disposable).call(disposal);
  }
  zombie ? (node._pendingDisposal = null) : (node._disposal = null);
}

export function getNextChildId(owner: Owner): string {
  if (owner.id != null) return formatId(owner.id, owner._childCount++);
  throw new Error("Cannot get child id from owner without an id");
}

function formatId(prefix: string, id: number) {
  const num = id.toString(36),
    len = num.length - 1;
  return prefix + (len ? String.fromCharCode(64 + len) : "") + num;
}

export function computed<T>(fn: (prev?: T) => T | PromiseLike<T> | AsyncIterable<T>): Computed<T>;
export function computed<T>(
  fn: (prev: T) => T | PromiseLike<T> | AsyncIterable<T>,
  initialValue?: T,
  options?: SignalOptions<T>
): Computed<T>;
export function computed<T>(
  fn: (prev?: T) => T | PromiseLike<T> | AsyncIterable<T>,
  initialValue?: T,
  options?: SignalOptions<T>
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

export function signal<T>(v: T, options?: SignalOptions<T>): Signal<T>;
export function signal<T>(
  v: T,
  options?: SignalOptions<T>,
  firewall?: Computed<any>
): FirewallSignal<T>;
export function signal<T>(
  v: T,
  options?: SignalOptions<T>,
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

export function optimisticSignal<T>(v: T, options?: SignalOptions<T>): Signal<T> {
  const s = signal(v, options);
  s._optimistic = true;
  return s;
}

export function optimisticComputed<T>(
  fn: (prev?: T) => T | PromiseLike<T> | AsyncIterable<T>,
  initialValue?: T,
  options?: SignalOptions<T>
): Computed<T> {
  const c = computed(fn, initialValue, options);
  c._optimistic = true;
  return c;
}

/**
 * Get or create the pending signal for a node (lazy).
 * Used by isPending() to track pending state reactively.
 */
function getPendingSignal(el: Signal<any> | Computed<any>): Signal<boolean> {
  if (!el._pendingSignal) {
    // Start false, write true if pending - ensures reversion returns to false
    el._pendingSignal = optimisticSignal(false, { pureWrite: true });
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
  // Upstream: value held in transition
  if (el._pendingValue !== NOT_PENDING) return true;
  // Downstream: async in flight with previous value (not initial load)
  // STATUS_UNINITIALIZED is cleared on first successful completion
  const comp = el as Computed<any>;
  return !!(comp._statusFlags & STATUS_PENDING && !(comp._statusFlags & STATUS_UNINITIALIZED));
}

/**
 * Get or create the pending value computed for a node (lazy).
 * Used by pending() to read the in-flight value during a transition.
 */
function getPendingValueComputed<T>(el: Signal<T> | Computed<T>): Computed<T> {
  if (!el._pendingValueComputed) {
    // Disable pendingReadActive to avoid recursion during creation
    const prevPending = pendingReadActive;
    pendingReadActive = false;
    // Create outside of any owner context so it doesn't get disposed when effects re-run
    const prevContext = context;
    context = null;
    el._pendingValueComputed = optimisticComputed(() => read(el));
    context = prevContext;
    pendingReadActive = prevPending;
  }
  return el._pendingValueComputed;
}

/**
 * Update _pendingSignal when pending state changes. When the override clears
 * (pending -> not pending), merge the sub-lane into the source's lane so
 * isPending effects are blocked until the full scope resolves.
 */
function updatePendingSignal(el: Signal<any> | Computed<any>): void {
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
      clearLaneEntry(sig);
      sig._optimisticLane = undefined;
    }
  }
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

  // Handle pending() mode: read from _pendingValueComputed
  if (pendingReadActive) {
    const pendingComputed = getPendingValueComputed(el);
    const prevPending = pendingReadActive;
    pendingReadActive = false;
    const value = read(pendingComputed);
    pendingReadActive = prevPending;
    // If _pendingValueComputed is pending (source was pending), fallback to el._value
    if (pendingComputed._statusFlags & STATUS_PENDING) return el._value as T;
    return value as T;
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
    // Per-lane suspension: only throw if in same lane as pending async
    if (currentOptimisticLane) {
      const pendingLane = (asyncCompute as any)._optimisticLane;
      const lane = findLane(currentOptimisticLane);
      const isSourceWithOverride = lane._source === asyncCompute && hasActiveOverride(asyncCompute);
      if (pendingLane && findLane(pendingLane) === lane && !isSourceWithOverride) {
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
  if (!valueChanged) return v;

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

const PENDING_OWNER = {} as Owner; // Dummy owner to trigger store's read() path

export function getObserver(): Owner | null {
  if (pendingCheckActive || pendingReadActive) return PENDING_OWNER;
  return tracking ? context : null;
}

export function getOwner(): Owner | null {
  return context;
}

export function onCleanup(fn: Disposable): Disposable {
  if (!context) return fn;
  if (!context._disposal) context._disposal = fn;
  else if (Array.isArray(context._disposal)) context._disposal.push(fn);
  else context._disposal = [context._disposal, fn];
  return fn;
}

export function createOwner(options?: { id: string }) {
  const parent = context;
  const owner = {
    id: options?.id ?? (parent?.id != null ? getNextChildId(parent) : undefined),
    _root: true,
    _parentComputed: (parent as Root)?._root ? (parent as Root)._parentComputed : parent,
    _firstChild: null,
    _nextSibling: null,
    _disposal: null,
    _queue: parent?._queue ?? globalQueue,
    _context: parent?._context || defaultContext,
    _childCount: 0,
    _pendingDisposal: null,
    _pendingFirstChild: null,
    _parent: parent,
    dispose(self: boolean = true) {
      disposeChildren(owner, self);
    }
  } as Root;

  if (__DEV__ && leafEffectActive && parent) {
    throw new Error("Cannot create reactive primitives inside createTrackedEffect");
  }
  if (parent) {
    const lastChild = parent._firstChild;
    if (lastChild === null) {
      parent._firstChild = owner;
    } else {
      owner._nextSibling = lastChild;
      parent._firstChild = owner;
    }
  }
  return owner;
}

/**
 * Creates a new non-tracked reactive context with manual disposal
 *
 * @param fn a function in which the reactive state is scoped
 * @returns the output of `fn`.
 *
 * @description https://docs.solidjs.com/reference/reactive-utilities/create-root
 */
export function createRoot<T>(
  init: ((dispose: () => void) => T) | (() => T),
  options?: { id: string }
): T {
  const owner = createOwner(options);
  return runWithOwner(owner, () => init(owner.dispose));
}

/**
 * Runs the given function in the given owner to move ownership of nested primitives and cleanups.
 * This method untracks the current scope.
 *
 * Warning: Usually there are simpler ways of modeling a problem that avoid using this function
 */
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
