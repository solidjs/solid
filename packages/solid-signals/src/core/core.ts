import { NOT_PENDING, ReactiveFlags, StatusFlags } from "./constants.js";
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
  pendingQueue,
  schedule,
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
}

export interface RawSignal<T> {
  _subs: Link | null;
  _subsTail: Link | null;
  _value: T;
  _error?: unknown;
  _statusFlags: StatusFlags;
  _id?: string;
  _name?: string;
  _equals: false | ((a: T, b: T) => boolean);
  _pureWrite?: boolean;
  _unobserved?: () => void;
  _time: number;
  _pendingValue: T | typeof NOT_PENDING;
  _pendingCheck?: Signal<boolean> & { _set: (v: boolean) => void };
  _pendingSignal?: Signal<T> & { _set: (v: T) => void };
  _transition?: Transition;
}

export interface FirewallSignal<T> extends RawSignal<T> {
  _owner: Computed<any>;
  _nextChild: FirewallSignal<unknown> | null;
}

export type Signal<T> = RawSignal<T> | FirewallSignal<T>;
export interface Owner {
  _id?: string;
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
  _flags: ReactiveFlags;
  _height: number;
  _nextHeap: Computed<any> | undefined;
  _prevHeap: Computed<any>;
  _fn: (prev?: T) => T;
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
let context: Owner | null = null;
const defaultContext = {};

export function recompute(el: Computed<any>, create: boolean = false): void {
  deleteFromHeap(el, el._flags & ReactiveFlags.Zombie ? pendingQueue : dirtyQueue);
  if (el._pendingValue !== NOT_PENDING || el._pendingFirstChild || el._pendingDisposal)
    disposeChildren(el);
  else {
    markDisposal(el);
    globalQueue._pendingNodes.push(el);
    el._pendingDisposal = el._disposal;
    el._pendingFirstChild = el._firstChild;
    el._disposal = null;
    el._firstChild = null;
  }

  const oldcontext = context;
  context = el;
  el._depsTail = null;
  el._flags = ReactiveFlags.RecomputingDeps;
  el._time = clock;
  let value = el._pendingValue === NOT_PENDING ? el._value : el._pendingValue;
  let oldHeight = el._height;
  let prevStatusFlags = el._statusFlags;
  let prevError = el._error;
  let prevTracking = tracking;
  clearStatusFlags(el);
  tracking = true;
  try {
    value = el._fn(value);
  } catch (e) {
    if (e instanceof NotReadyError) {
      if (e.cause !== el) link(e.cause, el);
      setStatusFlags(el, (prevStatusFlags & ~StatusFlags.Error) | StatusFlags.Pending, e);
    } else {
      setError(el, e as Error);
    }
  } finally {
    tracking = prevTracking;
  }
  el._flags = ReactiveFlags.None;
  context = oldcontext;

  const depsTail = el._depsTail as Link | null;
  let toRemove = depsTail !== null ? depsTail._nextDep : el._deps;
  if (toRemove !== null) {
    do {
      toRemove = unlinkSubs(toRemove);
    } while (toRemove !== null);
    if (depsTail !== null) {
      depsTail._nextDep = null;
    } else {
      el._deps = null;
    }
  }
  const valueChanged =
    !el._equals ||
    !el._equals(el._pendingValue === NOT_PENDING ? el._value : el._pendingValue, value);
  const statusFlagsChanged = el._statusFlags !== prevStatusFlags || el._error !== prevError;
  el._notifyQueue?.(statusFlagsChanged, prevStatusFlags);

  if (valueChanged || statusFlagsChanged) {
    if (valueChanged) {
      if (create || (el as any)._optimistic || (el as any)._type) el._value = value;
      else {
        if (el._pendingValue === NOT_PENDING) globalQueue._pendingNodes.push(el);
        el._pendingValue = value;
      }
      if (el._pendingSignal) el._pendingSignal._set(value);
    }

    for (let s = el._subs; s !== null; s = s._nextSub) {
      insertIntoHeap(s._sub, s._sub._flags & ReactiveFlags.Zombie ? pendingQueue : dirtyQueue);
    }
  } else if (el._height != oldHeight) {
    for (let s = el._subs; s !== null; s = s._nextSub) {
      insertIntoHeapHeight(
        s._sub,
        s._sub._flags & ReactiveFlags.Zombie ? pendingQueue : dirtyQueue
      );
    }
  }
}

function updateIfNecessary(el: Computed<unknown>): void {
  if (el._flags & ReactiveFlags.Check) {
    for (let d = el._deps; d; d = d._nextDep) {
      const dep1 = d._dep;
      const dep = ("_owner" in dep1 ? dep1._owner : dep1) as Computed<unknown>;
      if ("_fn" in dep) {
        updateIfNecessary(dep);
      }
      if (el._flags & ReactiveFlags.Dirty) {
        break;
      }
    }
  }

  if (el._flags & ReactiveFlags.Dirty) {
    recompute(el);
  }

  el._flags = ReactiveFlags.None;
}

// https://github.com/stackblitz/alien-signals/blob/v2.0.3/src/system.ts#L100
function unlinkSubs(link: Link): Link | null {
  const dep = link._dep;
  const nextDep = link._nextDep;
  const nextSub = link._nextSub;
  const prevSub = link._prevSub;
  if (nextSub !== null) {
    nextSub._prevSub = prevSub;
  } else {
    dep._subsTail = prevSub;
  }
  if (prevSub !== null) {
    prevSub._nextSub = nextSub;
  } else {
    dep._subs = nextSub;
  }
  return nextDep;
}

// https://github.com/stackblitz/alien-signals/blob/v2.0.3/src/system.ts#L52
function link(dep: Signal<any> | Computed<any>, sub: Computed<any>) {
  const prevDep = sub._depsTail;
  if (prevDep !== null && prevDep._dep === dep) {
    return;
  }
  let nextDep: Link | null = null;
  const isRecomputing = sub._flags & ReactiveFlags.RecomputingDeps;
  if (isRecomputing) {
    nextDep = prevDep !== null ? prevDep._nextDep : sub._deps;
    if (nextDep !== null && nextDep._dep === dep) {
      sub._depsTail = nextDep;
      return;
    }
  }

  const prevSub = dep._subsTail;
  if (prevSub !== null && prevSub._sub === sub && (!isRecomputing || isValidLink(prevSub, sub))) {
    return;
  }
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
  if (prevDep !== null) {
    prevDep._nextDep = newLink;
  } else {
    sub._deps = newLink;
  }
  if (prevSub !== null) {
    prevSub._nextSub = newLink;
  } else {
    dep._subs = newLink;
  }
}

// https://github.com/stackblitz/alien-signals/blob/v2.0.3/src/system.ts#L284
function isValidLink(checkLink: Link, sub: Computed<unknown>): boolean {
  const depsTail = sub._depsTail;
  if (depsTail !== null) {
    let link = sub._deps!;
    do {
      if (link === checkLink) {
        return true;
      }
      if (link === depsTail) {
        break;
      }
      link = link._nextDep!;
    } while (link !== null);
  }
  return false;
}

function setStatusFlags<T>(signal: Signal<T>, flags: StatusFlags, error: Error | null = null) {
  signal._statusFlags = flags;
  signal._error = error;
}

function setError<T>(signal: Signal<T>, error: Error) {
  setStatusFlags(signal, StatusFlags.Error | StatusFlags.Uninitialized, error);
}

function clearStatusFlags<T>(signal: Signal<T>) {
  setStatusFlags(signal, StatusFlags.None);
}

function markDisposal(el: Owner): void {
  let child = el._firstChild;
  while (child) {
    (child as Computed<unknown>)._flags |= ReactiveFlags.Zombie;
    const inHeap = (child as Computed<unknown>)._flags & ReactiveFlags.InHeap;
    if (inHeap) {
      deleteFromHeap(child as Computed<unknown>, dirtyQueue);
      insertIntoHeap(child as Computed<unknown>, pendingQueue);
    }
    markDisposal(child);
    child = child._nextSibling;
  }
}

function disposeChildren(node: Owner, self: boolean = false, zombie?: boolean): void {
  if ((node as any)._flags & ReactiveFlags.Disposed) return;
  if (self) (node as any)._flags = ReactiveFlags.Disposed;
  let child = zombie ? (node._pendingFirstChild as Owner) : node._firstChild;
  while (child) {
    const nextChild = child._nextSibling;
    if ((child as Computed<unknown>)._deps) {
      const n = child as Computed<unknown>;
      deleteFromHeap(n, n._flags & ReactiveFlags.Zombie ? pendingQueue : dirtyQueue);
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

function withOptions<T>(obj: T, options?: SignalOptions<any> & { _internal?: any }) {
  if (__DEV__)
    (obj as any)._name = options?.name ?? ((obj as Computed<any>)._fn ? "computed" : "signal");
  (obj as any)._id = options?.id ?? (context?._id != null ? getNextChildId(context) : undefined);
  (obj as any)._equals = options?.equals != null ? options.equals : isEqual;
  (obj as any)._pureWrite = !!options?.pureWrite;
  (obj as any)._unobserved = options?.unobserved;
  if (options?._internal) Object.assign(obj as any, options._internal);
  return obj as T & {
    _id?: string;
    _name?: string;
    _equals: false | ((a: any, b: any) => boolean);
    _pureWrite?: boolean;
    _unobserved?: () => void;
  };
}

export function getNextChildId(owner: Owner): string {
  if (owner._id != null) return formatId(owner._id, owner._childCount++);
  throw new Error("Cannot get child id from owner without an id");
}

function formatId(prefix: string, id: number) {
  const num = id.toString(36),
    len = num.length - 1;
  return prefix + (len ? String.fromCharCode(64 + len) : "") + num;
}

export function computed<T>(fn: (prev?: T) => T): Computed<T>;
export function computed<T>(
  fn: (prev: T) => T,
  initialValue?: T,
  options?: SignalOptions<T>
): Computed<T>;
export function computed<T>(
  fn: (prev?: T) => T,
  initialValue?: T,
  options?: SignalOptions<T>
): Computed<T> {
  const self: Computed<T> = withOptions(
    {
      _disposal: null,
      _queue: globalQueue,
      _context: defaultContext,
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
      _flags: ReactiveFlags.None,
      _statusFlags: StatusFlags.Uninitialized,
      _time: clock,
      _pendingValue: NOT_PENDING,
      _pendingDisposal: null,
      _pendingFirstChild: null
    },
    options
  );
  self._prevHeap = self;
  const parent = (context as Root)?._root
    ? (context as Root)._parentComputed
    : (context as Computed<any> | null);
  if (context) {
    context._queue && (self._queue = context._queue);
    context._context && (self._context = context._context);
    const lastChild = context._firstChild;
    if (lastChild === null) {
      context._firstChild = self;
    } else {
      self._nextSibling = lastChild;
      context._firstChild = self;
    }
  }
  if (parent) self._height = parent._height + 1;
  recompute(self, true);

  return self;
}

export function asyncComputed<T>(
  asyncFn: (prev?: T, refreshing?: boolean) => T | Promise<T> | AsyncIterable<T>
): Computed<T> & { _refresh: () => void };
export function asyncComputed<T>(
  asyncFn: (prev: T, refreshing?: boolean) => T | Promise<T> | AsyncIterable<T>,
  initialValue: T,
  options?: SignalOptions<T>
): Computed<T> & { _refresh: () => void };
export function asyncComputed<T>(
  asyncFn: (prev?: T, refreshing?: boolean) => T | Promise<T> | AsyncIterable<T>,
  initialValue?: T,
  options?: SignalOptions<T>
): Computed<T> & { _refresh: () => void } {
  let lastResult = undefined as T | undefined;
  let refreshing = false;
  const fn = (prev?: T) => {
    const result = asyncFn(prev, refreshing);
    refreshing = false;
    lastResult = result as T;
    const isPromise = result instanceof Promise;
    const iterator = result[Symbol.asyncIterator];
    if (!isPromise && !iterator) {
      return result as T;
    }
    if (isPromise) {
      result
        .then(v => {
          if (lastResult !== result) return;
          globalQueue.initTransition(self);
          setSignal(self, v);
          flush();
        })
        .catch(e => {
          if (lastResult !== result) return;
          globalQueue.initTransition(self);
          setError(self, e as Error);
          flush();
        });
    } else {
      (async () => {
        try {
          for await (let value of result as AsyncIterable<T>) {
            if (lastResult !== result) return;
            globalQueue.initTransition(self);
            setSignal(self, value);
            flush();
          }
        } catch (error) {
          if (lastResult !== result) return;
          globalQueue.initTransition(self);
          setError(self, error as Error);
          flush();
        }
      })();
    }
    globalQueue.initTransition(context as any);
    throw new NotReadyError(context!);
  };
  const self = computed<T>(fn, initialValue as T, options);
  (self as any)._refresh = () => {
    refreshing = true;
    recompute(self);
    flush();
  };
  return self as Computed<T> & { _refresh: () => void };
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
  if (firewall !== null) {
    return (firewall._child = withOptions(
      {
        _value: v,
        _subs: null,
        _subsTail: null,
        _owner: firewall,
        _nextChild: firewall._child,
        _statusFlags: StatusFlags.None,
        _time: clock,
        _pendingValue: NOT_PENDING
      },
      options
    )) as FirewallSignal<T>;
  } else {
    return withOptions(
      {
        _value: v,
        _subs: null,
        _subsTail: null,
        _statusFlags: StatusFlags.None,
        _time: clock,
        _pendingValue: NOT_PENDING
      },
      options
    ) as Signal<T>;
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
  let c = context;
  if ((c as Root)?._root) c = (c as Root)._parentComputed;
  if (c && tracking) {
    link(el, c as Computed<any>);

    const owner = ("_owner" in el ? el._owner : el) as Computed<any>;
    if ("_fn" in owner) {
      const isZombie = (el as Computed<unknown>)._flags & ReactiveFlags.Zombie;
      if (owner._height >= (isZombie ? pendingQueue._min : dirtyQueue._min)) {
        markNode(c as Computed<any>);
        markHeap(isZombie ? pendingQueue : dirtyQueue);
        updateIfNecessary(owner);
      }
      const height = owner._height;
      if (height >= (c as Computed<any>)._height) {
        (c as Computed<any>)._height = height + 1;
      }
    }
  }
  if (pendingCheck) {
    const pendingResult =
      (el._statusFlags & StatusFlags.Pending) !== 0 || !!el._transition || false;
    if (!el._pendingCheck) {
      el._pendingCheck = signal<boolean>(pendingResult) as Signal<boolean> & {
        _set: (v: boolean) => void;
      };
      (el._pendingCheck as any)._optimistic = true;
      el._pendingCheck._set = v => setSignal(el._pendingCheck!, v);
    }
    const prev = pendingCheck;
    pendingCheck = null;
    read(el._pendingCheck);
    pendingCheck = prev;
    prev._value = pendingResult || prev._value;
  }
  if (pendingValueCheck) {
    if (!el._pendingSignal) {
      el._pendingSignal = signal<T>(
        el._pendingValue === NOT_PENDING ? el._value : (el._pendingValue as T)
      ) as Signal<T> & { _set: (v: T) => void };
      (el._pendingSignal as any)._optimistic = true;
      el._pendingSignal._set = v =>
        queueMicrotask(() => queueMicrotask(() => setSignal(el._pendingSignal!, v)));
    }
    pendingValueCheck = false;
    try {
      return read(el._pendingSignal);
    } finally {
      pendingValueCheck = true;
    }
  }
  if (el._statusFlags & StatusFlags.Pending) {
    if ((c && !stale) || el._statusFlags & StatusFlags.Uninitialized) throw el._error;
    else if (c && stale && !pendingCheck) {
      setStatusFlags(
        c as Computed<any>,
        (c as Computed<any>)._statusFlags | 1 /* Pending */,
        el._error as Error
      );
    }
  }
  if (el._statusFlags & StatusFlags.Error) {
    if (el._time < clock) {
      // treat error reset like create
      recompute(el as Computed<unknown>, true);
      return read(el);
    } else {
      throw el._error;
    }
  }
  return !c ||
    el._pendingValue === NOT_PENDING ||
    (stale && !pendingCheck && el._transition && activeTransition !== el._transition)
    ? el._value
    : (el._pendingValue as T);
}

export function setSignal<T>(el: Signal<T> | Computed<T>, v: T | ((prev: T) => T)): void {
  // Warn about writing to a signal in an owned scope in development mode.
  if (__DEV__ && !el._pureWrite && context && !(context as any).firewall)
    console.warn("A Signal was written to in an owned scope.");

  if (typeof v === "function") {
    v = (v as (prev: T) => T)(
      el._pendingValue === NOT_PENDING ? el._value : (el._pendingValue as T)
    );
  }
  const valueChanged =
    !el._equals ||
    !el._equals(el._pendingValue === NOT_PENDING ? el._value : (el._pendingValue as T), v);
  if (!valueChanged && !el._statusFlags) return;
  if (valueChanged) {
    if ((el as any)._optimistic) el._value = v;
    else {
      if (el._pendingValue === NOT_PENDING) globalQueue._pendingNodes.push(el);
      el._pendingValue = v;
    }
    if (el._pendingSignal) el._pendingSignal._set(v);
  }
  clearStatusFlags(el);
  el._time = clock;

  for (let link = el._subs; link !== null; link = link._nextSub) {
    insertIntoHeap(link._sub, link._sub._flags & ReactiveFlags.Zombie ? pendingQueue : dirtyQueue);
  }
  schedule();
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
    _id: options?.id ?? (parent?._id != null ? getNextChildId(parent) : undefined),
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
  context = owner;
  try {
    return fn();
  } finally {
    context = oldContext;
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

export function isPending(fn: () => any): boolean;
export function isPending(fn: () => any, loadingValue: boolean): boolean;
export function isPending(fn: () => any, loadingValue?: boolean): boolean {
  const current = pendingCheck;
  pendingCheck = { _value: false };
  try {
    staleValues(fn);
    return pendingCheck._value;
  } catch (err) {
    if (!(err instanceof NotReadyError)) return false;
    if (loadingValue !== undefined) return loadingValue!;
    throw err;
  } finally {
    pendingCheck = current;
  }
}
