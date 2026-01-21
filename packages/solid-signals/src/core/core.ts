import {
  $REFRESH,
  defaultContext,
  NOT_PENDING,
  REACTIVE_CHECK,
  REACTIVE_DIRTY,
  REACTIVE_DISPOSED,
  REACTIVE_IN_HEAP,
  REACTIVE_NONE,
  REACTIVE_RECOMPUTING_DEPS,
  REACTIVE_ZOMBIE,
  STATUS_ERROR,
  STATUS_NONE,
  STATUS_PENDING,
  STATUS_UNINITIALIZED
} from "./constants.js";
import { NotReadyError } from "./error.js";
import {
  deleteFromHeap,
  insertIntoHeap,
  insertIntoHeapHeight,
  markHeap,
  markNode
} from "./heap.js";
import {
  activeTransition,
  clock,
  dirtyQueue,
  flush,
  globalQueue,
  GlobalQueue,
  notifySubs,
  optimisticRun,
  runInTransition,
  schedule,
  zombieQueue,
  type IQueue,
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
  id?: string;
  _subs: Link | null;
  _subsTail: Link | null;
  _value: T;
  _error?: unknown;
  _statusFlags: number;
  _name?: string;
  _equals: false | ((a: T, b: T) => boolean);
  _pureWrite?: boolean;
  _unobserved?: () => void;
  _time: number;
  _transition: Transition | null;
  _pendingValue: T | typeof NOT_PENDING;
  _pendingCheck?: Signal<boolean> & { _set: (v: boolean) => void };
  _pendingSignal?: Signal<T> & { _set: (v: T) => void };
  _optimistic?: boolean;
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
  _height: number;
  _nextHeap: Computed<any> | undefined;
  _prevHeap: Computed<any>;
  _fn: (prev?: T) => T;
  _inFlight: Promise<T> | AsyncIterable<T> | null;
  _child: FirewallSignal<any> | null;
  _notifyQueue?: (statusFlagsChanged: boolean, prevStatusFlags: number) => void;
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
let pendingValueCheck = false;
let pendingCheck: null | { _value: boolean } = null;
let refreshing = false;
export let context: Owner | null = null;

export function recompute(el: Computed<any>, create: boolean = false): void {
  const honoraryOptimistic = (el as any)._type && el._transition != activeTransition;
  if (!create) {
    if (el._transition && activeTransition !== el._transition && !honoraryOptimistic)
      globalQueue.initTransition(el._transition);
    deleteFromHeap(el, el._flags & REACTIVE_ZOMBIE ? zombieQueue : dirtyQueue);
    if (el._transition) disposeChildren(el);
    else {
      markDisposal(el);
      el._pendingDisposal = el._disposal;
      el._pendingFirstChild = el._firstChild;
      el._disposal = null;
      el._firstChild = null;
    }
  }
  const oldcontext = context;
  context = el;
  el._depsTail = null;
  el._flags = REACTIVE_RECOMPUTING_DEPS;
  el._time = clock;
  let value =
    el._pendingValue === NOT_PENDING || (el._optimistic && el._transition)
      ? el._value
      : el._pendingValue;
  let oldHeight = el._height;
  let prevStatusFlags = el._statusFlags;
  let prevError = el._error;
  let prevTracking = tracking;
  setStatusFlags(el, STATUS_NONE | (prevStatusFlags & STATUS_UNINITIALIZED));
  tracking = true;
  try {
    value = handleAsync(el, el._fn(value));
    el._statusFlags &= ~STATUS_UNINITIALIZED;
  } catch (e) {
    if (e instanceof NotReadyError) {
      if (e.cause !== el) link(e.cause, el);
      setStatusFlags(el, (prevStatusFlags & ~STATUS_ERROR) | STATUS_PENDING, e);
    } else setStatusFlags(el, STATUS_ERROR, e as Error);
  } finally {
    tracking = prevTracking;
  }
  el._flags = REACTIVE_NONE;
  context = oldcontext;

  // TODO: more optimal way to handle async unlinking
  if (!(el._statusFlags & STATUS_PENDING)) {
    const depsTail = el._depsTail as Link | null;
    let toRemove = depsTail !== null ? depsTail._nextDep : el._deps;
    if (toRemove !== null) {
      do {
        toRemove = unlinkSubs(toRemove);
      } while (toRemove !== null);
      if (depsTail !== null) depsTail._nextDep = null;
      else el._deps = null;
    }
  }
  const valueChanged =
    !el._equals ||
    !el._equals(
      el._pendingValue === NOT_PENDING || (el._optimistic && el._transition) || honoraryOptimistic
        ? el._value
        : el._pendingValue,
      value
    );
  const statusFlagsChanged = el._statusFlags !== prevStatusFlags || el._error !== prevError;
  if (el._child && el._statusFlags & STATUS_PENDING && activeTransition)
    activeTransition.asyncNodes.push(el);
  el._notifyQueue?.(statusFlagsChanged, prevStatusFlags);

  if (valueChanged || statusFlagsChanged) {
    if (valueChanged) {
      if (create || el._optimistic || honoraryOptimistic) el._value = value;
      else el._pendingValue = value;
      if (el._pendingSignal) setSignal(el._pendingSignal, value);
    }
    (!el._optimistic || optimisticRun) && notifySubs(el);
  } else if (el._height != oldHeight) {
    for (let s = el._subs; s !== null; s = s._nextSub) {
      insertIntoHeapHeight(s._sub, s._sub._flags & REACTIVE_ZOMBIE ? zombieQueue : dirtyQueue);
    }
  }
  el._optimistic && !optimisticRun && globalQueue._optimisticNodes.push(el);
  (!create || el._statusFlags & STATUS_PENDING) &&
    !el._transition &&
    globalQueue._pendingNodes.push(el);
  el._transition && honoraryOptimistic && runInTransition(el._transition, () => recompute(el));
}

export function handleAsync<T>(
  el: Computed<T>,
  result: T | Promise<T> | AsyncIterable<T>,
  setter?: (value: T) => void
): T {
  const isObject = typeof result === "object" && result !== null;
  const isPromise = isObject && result instanceof Promise;
  const iterator = isObject && untrack(() => result[Symbol.asyncIterator]);
  if (!isPromise && !iterator) {
    el._inFlight = null;
    return result as T;
  }
  el._inFlight = result as Promise<T> | AsyncIterable<T>;
  if (isPromise) {
    result
      .then(value => {
        if (el._inFlight !== result) return;
        globalQueue.initTransition(el._transition);
        setter ? setter(value) : setSignal(el, () => value);
        flush();
      })
      .catch(e => {
        if (el._inFlight !== result) return;
        globalQueue.initTransition(el._transition);
        setStatusFlags(el, STATUS_ERROR, e as Error);
        el._time = clock;
        notifySubs(el);
        schedule();
        flush();
      });
  } else {
    (async () => {
      try {
        for await (let value of result as AsyncIterable<T>) {
          if (el._inFlight !== result) return;
          globalQueue.initTransition(el._transition);
          setter ? setter(value) : setSignal(el, () => value);
          flush();
        }
      } catch (error) {
        if (el._inFlight !== result) return;
        globalQueue.initTransition(el._transition);
        setStatusFlags(el, STATUS_ERROR, error as Error);
        el._time = clock;
        notifySubs(el);
        schedule();
        flush();
      }
    })();
  }
  globalQueue.initTransition(el._transition);
  throw new NotReadyError(context!);
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

  if (el._flags & REACTIVE_DIRTY) {
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

function setStatusFlags<T>(signal: Signal<T>, flags: number, error: Error | null = null) {
  signal._statusFlags = flags;
  signal._error = error;
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

export function computed<T>(fn: (prev?: T) => T | Promise<T> | AsyncIterable<T>): Computed<T>;
export function computed<T>(
  fn: (prev: T) => T | Promise<T> | AsyncIterable<T>,
  initialValue?: T,
  options?: SignalOptions<T>
): Computed<T>;
export function computed<T>(
  fn: (prev?: T) => T | Promise<T> | AsyncIterable<T>,
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

  if ((options as any)?._internal) Object.assign(self, (options as any)._internal);
  if (__DEV__) (self as any)._name = options?.name ?? "computed";
  self._prevHeap = self;
  const parent = (context as Root)?._root
    ? (context as Root)._parentComputed
    : (context as Computed<any> | null);
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
    id: options?.id ?? (context?.id != null ? getNextChildId(context) : undefined),
    _equals: options?.equals != null ? options.equals : isEqual,
    _pureWrite: !!options?.pureWrite,
    _unobserved: options?.unobserved,
    _value: v,
    _subs: null,
    _subsTail: null,
    _statusFlags: STATUS_NONE,
    _time: clock,
    _firewall: firewall,
    _nextChild: firewall?._child || null,
    _pendingValue: NOT_PENDING
  };
  if (__DEV__) (s as any)._name = options?.name ?? "signal";
  firewall && (firewall._child = s as FirewallSignal<unknown>);
  return s as Signal<T>;
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
  let c = context;
  if ((c as Root)?._root) c = (c as Root)._parentComputed;
  if (refreshing && (el as Computed<unknown>)._fn) recompute(el as Computed<unknown>);
  if (c && tracking && !pendingCheck && !pendingValueCheck) {
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
  if (pendingValueCheck) {
    if (!el._pendingSignal) {
      el._pendingSignal = signal<T>(el._value) as Signal<T> & { _set: (v: T) => void };
      el._pendingSignal._optimistic = true;
    }
    pendingValueCheck = false;
    try {
      return read(el._pendingSignal);
    } finally {
      pendingValueCheck = true;
    }
  }
  const asyncCompute = (el as FirewallSignal<any>)._firewall || el;
  if (pendingCheck) {
    if (!asyncCompute._pendingCheck) {
      asyncCompute._pendingCheck = signal<boolean>(false) as Signal<boolean> & {
        _set: (v: boolean) => void;
      };
      (asyncCompute._pendingCheck as any)._optimistic = true;
      asyncCompute._pendingCheck._set = v => setSignal(asyncCompute._pendingCheck!, v);
    }
    const prev = pendingCheck;
    pendingCheck = null;
    prev._value = read(asyncCompute._pendingCheck) || prev._value;
    pendingCheck = prev;
  }
  if (!pendingCheck && asyncCompute._statusFlags & STATUS_PENDING) {
    if (
      (c && !stale) ||
      asyncCompute._statusFlags & STATUS_UNINITIALIZED ||
      (el as FirewallSignal<any>)._firewall
    )
      throw asyncCompute._error;
    else if (c && stale) {
      setStatusFlags(
        c as Computed<any>,
        (c as Computed<any>)._statusFlags | STATUS_PENDING,
        asyncCompute._error as Error
      );
    }
  }
  if (el._statusFlags & STATUS_ERROR) {
    if (el._time < clock) {
      // treat error reset like create
      recompute(el as Computed<unknown>, true);
      return read(el);
    } else {
      throw el._error;
    }
  }
  return !c ||
    el._optimistic ||
    el._pendingValue === NOT_PENDING ||
    (stale &&
      !pendingCheck &&
      ((c as Computed<unknown>)._optimistic ||
        (el._transition && activeTransition !== el._transition)))
    ? el._value
    : (el._pendingValue as T);
}

export function setSignal<T>(el: Signal<T> | Computed<T>, v: T | ((prev: T) => T)): T {
  // Warn about writing to a signal in an owned scope in development mode.
  if (__DEV__ && !el._pureWrite && context && (el as FirewallSignal<any>)._firewall !== context)
    console.warn("A Signal was written to in an owned scope.");

  if (el._transition && activeTransition !== el._transition)
    globalQueue.initTransition(el._transition);

  if (typeof v === "function") {
    v = (v as (prev: T) => T)(
      el._pendingValue === NOT_PENDING || (el._optimistic && el._transition)
        ? el._value
        : (el._pendingValue as T)
    );
  }
  const valueChanged =
    !el._equals ||
    !el._equals(
      el._pendingValue === NOT_PENDING || (el._optimistic && el._transition)
        ? el._value
        : (el._pendingValue as T),
      v
    );
  if (!valueChanged && !el._statusFlags) return v;
  if (valueChanged) {
    if (el._optimistic) el._value = v;
    else {
      if (el._pendingValue === NOT_PENDING) globalQueue._pendingNodes.push(el);
      el._pendingValue = v;
    }
    if (el._pendingSignal) setSignal(el._pendingSignal, v);
  }
  setStatusFlags(el, STATUS_NONE);
  el._time = clock;
  el._optimistic && !optimisticRun ? globalQueue._optimisticNodes.push(el) : notifySubs(el);
  schedule();
  return v;
}

export function getObserver(): Owner | null {
  return tracking ? context : null;
}

export function getOwner(): Owner | null {
  return context;
}

export function onCleanup(fn: Disposable): Disposable {
  if (!context) return fn;

  const node = context;

  if (!node._disposal) {
    node._disposal = fn;
  } else if (Array.isArray(node._disposal)) {
    node._disposal.push(fn);
  } else {
    node._disposal = [node._disposal, fn];
  }
  return fn;
}

export function createOwner(options?: { id: string }) {
  const parent = context;
  const owner = {
    _root: true,
    _parentComputed: (parent as Root)?._root ? (parent as Root)._parentComputed : parent,
    _firstChild: null,
    _nextSibling: null,
    _disposal: null,
    id: options?.id ?? (parent?.id != null ? getNextChildId(parent) : undefined),
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
  const prevLatest = pendingValueCheck;
  pendingValueCheck = true;
  try {
    return staleValues(fn, false);
  } finally {
    pendingValueCheck = prevLatest;
  }
}

export function isPending(fn: () => any): boolean {
  const current = pendingCheck;
  pendingCheck = { _value: false };
  try {
    staleValues(fn);
    return pendingCheck._value;
  } catch (err) {
    if (!(err instanceof NotReadyError)) return false;
    throw err;
  } finally {
    pendingCheck = current;
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
      flush();
    }
  }
}

export function isRefreshing(): boolean {
  return refreshing;
}
