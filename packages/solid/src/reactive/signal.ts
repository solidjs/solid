// Inspired by S.js[https://github.com/adamhaile/S] by Adam Haile
import { requestCallback, Task } from "./scheduler";
import { sharedConfig } from "../render/hydration";
import type { JSX } from "../jsx";

export const equalFn = <T>(a: T, b: T) => a === b;
let ERROR: symbol | null = null;
let runEffects = runQueue;

const NOTPENDING = {};
const STALE = 1;
const PENDING = 2;
const UNOWNED: Owner = {
  owned: null,
  cleanups: null,
  context: null,
  owner: null
};
const [transPending, setTransPending] = /*@__PURE__*/ createSignal(false, true);
export var Owner: Owner | null = null;
export var Listener: Computation<any> | null = null;
let Pending: Signal<any>[] | null = null;
let Updates: Computation<any>[] | null = null;
let Effects: Computation<any>[] | null = null;
let Transition: Transition | null = null;
let ExecCount = 0;
let rootCount = 0;

declare global {
  var _$afterUpdate: () => void;
}

interface Signal<T> {
  value?: T;
  observers: Computation<any>[] | null;
  observerSlots: number[] | null;
  pending: T | {};
  tValue?: T;
  comparator?: (prev: T, next: T) => boolean;
  name?: string;
}

interface Owner {
  owned: Computation<any>[] | null;
  cleanups: (() => void)[] | null;
  owner: Owner | null;
  context: any | null;
  attached?: boolean;
  sourceMap?: Record<string, { value: unknown }>;
  name?: string;
  componentName?: string;
}

interface Computation<T> extends Owner {
  fn: (v?: T) => T;
  state: number;
  sources: Signal<T>[] | null;
  sourceSlots: number[] | null;
  value?: T;
  updatedAt: number | null;
  pure: boolean;
  user?: boolean;
  suspense?: SuspenseContextType;
}

interface Memo<T> extends Signal<T>, Computation<T> {
  tOwned?: Computation<any>[];
}

interface Transition {
  sources: Set<Signal<any>>;
  effects: Computation<any>[];
  promises: Set<Promise<any>>;
  disposed: Set<Computation<any>>;
  running: boolean;
  cb: (() => void)[];
}

export function createRoot<T>(fn: (dispose: () => void) => T, detachedOwner?: Owner): T {
  detachedOwner && (Owner = detachedOwner);
  const listener = Listener,
    owner = Owner,
    root: Owner =
      fn.length === 0 && !"_SOLID_DEV_"
        ? UNOWNED
        : { owned: null, cleanups: null, context: null, owner, attached: !!detachedOwner };

  if ("_SOLID_DEV_" && owner) root.name = (owner as Computation<any>).name + "-r" + rootCount++;
  Owner = root;
  Listener = null;
  let result: T;

  try {
    runUpdates(() => (result = fn(() => cleanNode(root))), true);
  } finally {
    Listener = listener;
    Owner = owner;
  }
  return result!;
}

export function createSignal<T>(): [() => T | undefined, <U extends T | undefined>(v?: U) => U];
export function createSignal<T>(
  value: T,
  areEqual?: boolean | ((prev: T, next: T) => boolean),
  options?: { name?: string; internal?: boolean }
): [() => T, (v: T) => T];
export function createSignal<T>(
  value?: T,
  areEqual?: boolean | ((prev: T, next: T) => boolean),
  options?: { name?: string; internal?: boolean }
): [() => T, (v: T) => T] {
  const s: Signal<T> = {
    value,
    observers: null,
    observerSlots: null,
    pending: NOTPENDING,
    comparator: areEqual ? (typeof areEqual === "function" ? areEqual : equalFn) : undefined
  };
  if ("_SOLID_DEV_" && (!options || !options.internal))
    s.name = registerGraph((options && options.name) || hashValue(value), s as { value: unknown });

  return [readSignal.bind(s), writeSignal.bind(s)];
}

export function createComputed<T>(fn: (v: T) => T, value: T): void;
export function createComputed<T>(fn: (v?: T) => T | undefined): void;
export function createComputed<T>(fn: (v?: T) => T, value?: T): void {
  updateComputation(createComputation(fn, value, true));
}

export function createRenderEffect<T>(fn: (v: T) => T, value: T): void;
export function createRenderEffect<T>(fn: (v?: T) => T | undefined): void;
export function createRenderEffect<T>(fn: (v?: T) => T, value?: T): void {
  updateComputation(createComputation(fn, value, false));
}

export function createEffect<T>(fn: (v: T) => T, value: T): void;
export function createEffect<T>(fn: (v?: T) => T | undefined): void;
export function createEffect<T>(fn: (v?: T) => T, value?: T): void {
  runEffects = runUserEffects;
  const c = createComputation(fn, value, false),
    s = SuspenseContext && lookup(Owner, SuspenseContext.id);
  if (s) c.suspense = s;
  c.user = true;
  Effects && Effects.push(c);
}

export function resumeEffects(e: Computation<any>[]) {
  Transition && (Transition.running = true);
  Effects!.push.apply(Effects, e);
  e.length = 0;
}

export function createMemo<T>(
  fn: (v?: T) => T,
  value?: undefined,
  areEqual?: boolean | ((prev: T, next: T) => boolean)
): () => T;
export function createMemo<T>(
  fn: (v: T) => T,
  value: T,
  areEqual?: boolean | ((prev: T, next: T) => boolean)
): () => T;
export function createMemo<T>(
  fn: (v?: T) => T,
  value?: T,
  areEqual?: boolean | ((prev: T, next: T) => boolean)
): () => T {
  const c: Partial<Memo<T>> = createComputation<T>(fn, value, true);
  c.pending = NOTPENDING;
  c.observers = null;
  c.observerSlots = null;
  c.state = 0;
  c.comparator = areEqual ? (typeof areEqual === "function" ? areEqual : equalFn) : undefined;
  updateComputation(c as Memo<T>);
  return readSignal.bind(c as Memo<T>);
}

export function createDeferred<T>(source: () => T, options?: { timeoutMs: number }) {
  let t: Task,
    timeout = options ? options.timeoutMs : undefined;
  const [deferred, setDeferred] = createSignal();
  const node = createComputation(
    () => {
      if (!t || !t.fn)
        t = requestCallback(
          () => setDeferred(node.value),
          timeout !== undefined ? { timeout } : undefined
        );
      return source();
    },
    undefined,
    true
  );
  updateComputation(node);
  setDeferred(node.value);
  return deferred;
}

export function createSelector<T, U>(
  source: () => T,
  fn: (a: U, b: T) => boolean = equalFn as any
) {
  let subs = new Map<U, Set<Computation<any>>>();
  const node = createComputation(
    (p: T | undefined) => {
      const v = source();
      for (const key of subs.keys())
        if (fn(key, v) || (p !== undefined && fn(key, p))) {
          const l = subs.get(key)!;
          for (const c of l.values()) {
            c.state = STALE;
            if (c.pure) Updates!.push(c);
            else Effects!.push(c);
          }
        }
      return v;
    },
    undefined,
    true
  );
  updateComputation(node);
  return (key: U) => {
    let listener: Computation<any> | null;
    if ((listener = Listener)) {
      let l: Set<Computation<any>> | undefined;
      if ((l = subs.get(key))) l.add(listener);
      else subs.set(key, (l = new Set([listener])));
      onCleanup(() => {
        l!.size > 1 ? l!.delete(listener!) : subs.delete(key);
      });
    }
    return fn(key, node.value!);
  };
}

export function batch<T>(fn: () => T): T {
  if (Pending) return fn();
  const q: Signal<any>[] = (Pending = []),
    result = fn();
  Pending = null;
  runUpdates(() => {
    for (let i = 0; i < q.length; i += 1) {
      const data = q[i];
      if (data.pending !== NOTPENDING) {
        const pending = data.pending;
        data.pending = NOTPENDING;
        writeSignal.call(data, pending);
      }
    }
  }, false);
  return result;
}

export function useTransition(): [() => boolean, (fn: () => void, cb?: () => void) => void] {
  return [
    transPending,
    (fn: () => void, cb?: () => void) => {
      if (SuspenseContext) {
        Transition ||
          (Transition = {
            sources: new Set(),
            effects: [],
            promises: new Set(),
            disposed: new Set(),
            running: true,
            cb: []
          });
        cb && Transition.cb.push(cb);
        Transition.running = true;
      }
      batch(fn);
      if (!SuspenseContext && cb) cb();
    }
  ];
}

export function untrack<T>(fn: () => T): T {
  let result: T,
    listener = Listener;

  Listener = null;
  result = fn();
  Listener = listener;

  return result;
}

type ReturnTypeArray<T> = { [P in keyof T]: T[P] extends () => infer U ? U : never };
export function on<T, X extends Array<() => T>, U>(
  ...args: X["length"] extends 1
    ? [w: () => T, fn: (v: T, prev: T | undefined, prevResults?: U) => U]
    : [...w: X, fn: (v: ReturnTypeArray<X>, prev: ReturnTypeArray<X> | [], prevResults?: U) => U]
): (prev?: U) => U {
  const fn = args.pop() as (v: T | Array<T>, p?: T | Array<T>, r?: U) => U;
  let deps: (() => T) | Array<() => T>;
  let isArray = true;
  let prev: T | T[];
  if (args.length < 2) {
    deps = args[0] as () => T;
    isArray = false;
  } else deps = args as Array<() => T>;
  return prevResult => {
    let value: T | Array<T>;
    if (isArray) {
      value = [];
      if (!prev) prev = [];
      for (let i = 0; i < deps.length; i++) value.push((deps as Array<() => T>)[i]());
    } else value = (deps as () => T)();
    const result = untrack<U>(() => fn!(value, prev, prevResult));
    prev = value;
    return result;
  };
}

export function onMount(fn: () => void) {
  createEffect(() => untrack(fn));
}

export function onCleanup(fn: () => void) {
  if (Owner === null)
    "_SOLID_DEV_" &&
      console.warn("cleanups created outside a `createRoot` or `render` will never be run");
  else if (Owner.cleanups === null) Owner.cleanups = [fn];
  else Owner.cleanups.push(fn);
  return fn;
}

export function onError(fn: (err: any) => void): void {
  ERROR || (ERROR = Symbol("error"));
  if (Owner === null)
    "_SOLID_DEV_" &&
      console.warn("error handlers created outside a `createRoot` or `render` will never be run");
  else if (Owner.context === null) Owner.context = { [ERROR]: [fn] };
  else if (!Owner.context[ERROR]) Owner.context[ERROR] = [fn];
  else Owner.context[ERROR].push(fn);
}

export function getListener() {
  return Listener;
}

export function getOwner() {
  return Owner;
}

export function runWithOwner(o: Owner, fn: () => any) {
  const prev = Owner;
  Owner = o;
  try {
    return fn();
  } finally {
    Owner = prev;
  }
}

export function devComponent<T>(Comp: (props: T) => JSX.Element, props: T) {
  const c: Partial<Memo<JSX.Element>> = createComputation(
    () => untrack(() => Comp(props)),
    undefined,
    true
  );
  c.pending = NOTPENDING;
  c.observers = null;
  c.observerSlots = null;
  c.state = 0;
  c.componentName = Comp.name;
  updateComputation(c as Memo<JSX.Element>);
  return c.value;
}

export function hashValue(v: any) {
  return "s" + (typeof v === "string" ? hash(v) : hash(JSON.stringify(v) || ""));
}

export function registerGraph(name: string, value: { value: unknown }) {
  let tryName = name;
  if (Owner) {
    let i = 0;
    Owner.sourceMap || (Owner.sourceMap = {});
    while (Owner.sourceMap[tryName]) tryName = name + "-" + ++i;
    Owner.sourceMap[tryName] = value;
  }
  return tryName;
}
interface GraphRecord {
  [k: string]: GraphRecord | unknown;
}
export function serializeGraph(owner?: Owner | null): GraphRecord {
  owner || (owner = Owner);
  if (!"_SOLID_DEV_" || !owner) return {};
  return {
    ...serializeValues(owner.sourceMap),
    ...(owner.owned ? serializeChildren(owner) : {})
  };
}

// Context API
export interface Context<T> {
  id: symbol;
  Provider: (props: { value: T; children: any }) => any;
  defaultValue: T;
}

export function createContext<T>(): Context<T | undefined>;
export function createContext<T>(defaultValue: T): Context<T>;
export function createContext<T>(defaultValue?: T): Context<T | undefined> {
  const id = Symbol("context");
  return { id, Provider: createProvider(id), defaultValue };
}

export function useContext<T>(context: Context<T>): T {
  return lookup(Owner, context.id) || context.defaultValue;
}

export function children(fn: () => any) {
  const children = createMemo(fn);
  return createMemo(() => resolveChildren(children()));
}

// Resource API
type SuspenseContextType = {
  increment?: () => void;
  decrement?: () => void;
  inFallback?: () => boolean;
  effects?: Computation<any>[];
  resolved?: boolean;
};

let SuspenseContext: Context<SuspenseContextType> & {
  active?(): boolean;
  increment?(): void;
  decrement?(): void;
};

export function getSuspenseContext() {
  return SuspenseContext || (SuspenseContext = createContext<SuspenseContextType>({}));
}

export interface Resource<T> {
  (): T | undefined;
  loading: boolean;
}

type ResourceReturn<T> = [
  Resource<T>,
  {
    mutate: (v: T | undefined) => T | undefined;
    refetch: () => void;
  }
];

export function createResource<T, U = true>(
  fetcher: (k: U, getPrev: () => T | undefined) => T | Promise<T>,
  options?: { initialValue?: T }
): ResourceReturn<T>;
export function createResource<T, U>(
  fn: U | false | (() => U | false),
  fetcher: (k: U, getPrev: () => T | undefined) => T | Promise<T>,
  options?: { initialValue?: T }
): ResourceReturn<T>;
export function createResource<T, U>(
  fn:
    | U
    | true
    | false
    | (() => U | false)
    | ((k: U, getPrev: () => T | undefined) => T | Promise<T>),
  fetcher?: ((k: U, getPrev: () => T | undefined) => T | Promise<T>) | { initialValue?: T },
  options: { initialValue?: T } = {}
): ResourceReturn<T> {
  if (arguments.length === 2) {
    if (typeof fetcher === "object") {
      options = fetcher;
      fetcher = fn as (k: U, getPrev: () => T | undefined) => T | Promise<T>;
      fn = true;
    };
  } else if (arguments.length === 1) {
    fetcher = fn as (k: U, getPrev: () => T | undefined) => T | Promise<T>;
    fn = true;
  }
  const contexts = new Set<SuspenseContextType>(),
    [s, set] = createSignal(options!.initialValue, true),
    [track, trigger] = createSignal<void>(),
    [loading, setLoading] = createSignal<boolean>(false, true);

  let err: any = null,
    pr: Promise<T> | null = null,
    initP: Promise<T> | null = null,
    id: string | null = null,
    loadedUnderTransition = false,
    dynamic = typeof fn === "function";

  if (sharedConfig.context) {
    id = `${sharedConfig.context!.id}${sharedConfig.context!.count++}`;
    if (sharedConfig.context.loadResource) {
      initP = sharedConfig.context.loadResource!(id!);
    } else if (sharedConfig.resources && id && id in sharedConfig.resources) {
      initP = sharedConfig.resources![id];
      delete sharedConfig.resources![id];
    }
  }
  function loadEnd(p: Promise<T> | null, v: T, e?: any) {
    if (pr === p) {
      err = e;
      pr = null;
      if (Transition && p && loadedUnderTransition) {
        Transition.promises.delete(p);
        loadedUnderTransition = false;
        runUpdates(() => {
          Transition!.running = true;
          if (!Transition!.promises.size) {
            Effects!.push.apply(Effects, Transition!.effects);
            Transition!.effects = [];
          }
          completeLoad(v);
        }, false);
      } else completeLoad(v);
    }
    return v;
  }
  function completeLoad(v: T) {
    batch(() => {
      set(v);
      setLoading(false);
      for (let c of contexts.keys()) c.decrement!();
      contexts.clear();
    });
  }

  function read() {
    const c = SuspenseContext && lookup(Owner, SuspenseContext.id),
      v = s();
    if (err) throw err;
    if (Listener && !Listener.user && c) {
      createComputed(() => {
        track();
        if (pr) {
          if (c.resolved && Transition) Transition.promises.add(pr!);
          else if (!contexts.has(c)) {
            c.increment!();
            contexts.add(c);
          }
        }
      });
    }
    return v;
  }
  function load() {
    err = null;
    let lookup = dynamic ? (fn as () => U)() : (fn as U);
    loadedUnderTransition = (Transition && Transition.running) as boolean;
    if (lookup == null || (lookup as any) === false) {
      loadEnd(pr, untrack(s)!);
      return;
    }
    if (Transition && pr) Transition.promises.delete(pr);
    const p =
      initP || (fetcher as (k: U, getPrev: () => T | undefined) => T | Promise<T>)(lookup, s);
    initP = null;
    if (typeof p !== "object" || !("then" in p)) {
      loadEnd(pr, p);
      return;
    }
    pr = p;
    batch(() => {
      setLoading(true);
      trigger();
    });
    p.then(
      v => loadEnd(p as Promise<T>, v),
      e => loadEnd(p as Promise<T>, e, e)
    );
  }
  Object.defineProperty(read, "loading", {
    get() {
      return loading();
    }
  });
  if (dynamic) createComputed(load);
  else load();
  return [read as Resource<T>, { refetch: load, mutate: set }];
}

function readSignal(this: Signal<any> | Memo<any>) {
  if ((this as Memo<any>).state && (this as Memo<any>).sources) {
    const updates = Updates;
    Updates = null;
    (this as Memo<any>).state === STALE
      ? updateComputation(this as Memo<any>)
      : lookDownstream(this as Memo<any>);
    Updates = updates;
  }
  if (Listener) {
    const sSlot = this.observers ? this.observers.length : 0;
    if (!Listener.sources) {
      Listener.sources = [this];
      Listener.sourceSlots = [sSlot];
    } else {
      Listener.sources.push(this);
      Listener.sourceSlots!.push(sSlot);
    }
    if (!this.observers) {
      this.observers = [Listener];
      this.observerSlots = [Listener.sources.length - 1];
    } else {
      this.observers.push(Listener);
      this.observerSlots!.push(Listener.sources.length - 1);
    }
  }
  if (Transition && Transition.running && Transition.sources.has(this)) return this.tValue;
  return this.value;
}

function writeSignal(this: Signal<any> | Memo<any>, value: any, isComp?: boolean) {
  if (this.comparator) {
    if (Transition && Transition.running && Transition.sources.has(this)) {
      if (this.comparator(this.tValue, value)) return value;
    } else if (this.comparator(this.value, value)) return value;
  }
  if (Pending) {
    if (this.pending === NOTPENDING) Pending.push(this);
    this.pending = value;
    return value;
  }
  if (Transition) {
    if (Transition.running || (!isComp && Transition.sources.has(this))) {
      Transition.sources.add(this);
      this.tValue = value;
    }
    if (!Transition.running) this.value = value;
  } else this.value = value;
  if (this.observers && (!Updates || this.observers.length)) {
    runUpdates(() => {
      for (let i = 0; i < this.observers!.length; i += 1) {
        const o = this.observers![i];
        if (Transition && Transition.running && Transition.disposed.has(o)) continue;
        if ((o as Memo<any>).observers && o.state !== PENDING) markUpstream(o as Memo<any>);
        o.state = STALE;
        if (o.pure) Updates!.push(o);
        else Effects!.push(o);
      }
      if (Updates!.length > 10e5) {
        Updates = [];
        throw new Error("Potential Infinite Loop Detected.");
      }
    }, false);
  }
  return value;
}

function updateComputation(node: Computation<any>) {
  if (!node.fn) return;
  cleanNode(node);
  const owner = Owner,
    listener = Listener,
    time = ExecCount;
  Listener = Owner = node;
  runComputation(node, node.value, time);

  if (Transition && !Transition.running && Transition.sources.has(node as Memo<any>)) {
    Transition.running = true;
    runComputation(node, (node as Memo<any>).tValue, time);
    Transition.running = false;
  }
  Listener = listener;
  Owner = owner;
}

function runComputation(node: Computation<any>, value: any, time: number) {
  let nextValue;
  try {
    nextValue = node.fn(value);
  } catch (err) {
    handleError(err);
  }
  if (!node.updatedAt || node.updatedAt <= time) {
    if ((node as Memo<any>).observers && (node as Memo<any>).observers!.length) {
      writeSignal.call(node as Memo<any>, nextValue, true);
    } else if (Transition && Transition.running && node.pure) {
      Transition.sources.add(node as Memo<any>);
      (node as Memo<any>).tValue = nextValue;
    } else node.value = nextValue;
    node.updatedAt = time;
  }
}

function createComputation<T>(fn: (v?: T) => T, init: T | undefined, pure: boolean) {
  const c: Computation<T> = {
    fn,
    state: STALE,
    updatedAt: null,
    owned: null,
    sources: null,
    sourceSlots: null,
    cleanups: null,
    value: init,
    owner: Owner,
    context: null,
    pure
  };
  if (Owner === null)
    "_SOLID_DEV_" &&
      console.warn(
        "computations created outside a `createRoot` or `render` will never be disposed"
      );
  else if (Owner !== UNOWNED) {
    if (Transition && Transition.running && (Owner as Memo<T>).pure) {
      if (!(Owner as Memo<T>).tOwned) (Owner as Memo<T>).tOwned = [c];
      else (Owner as Memo<T>).tOwned!.push(c);
    } else {
      if (!Owner.owned) Owner.owned = [c];
      else Owner.owned.push(c);
    }
    if ("_SOLID_DEV_")
      c.name =
        ((Owner as Computation<any>).name || "c") +
        "-" +
        (Owner.owned || (Owner as Memo<T>).tOwned!).length;
  }
  return c;
}

function runTop(node: Computation<any>) {
  let top = node.state === STALE && node,
    pending;
  if (node.suspense && untrack(node.suspense.inFallback!))
    return node!.suspense.effects!.push(node!);
  const runningTransition = Transition && Transition.running;
  while (
    (node.fn || (runningTransition && node.attached)) &&
    (node = node.owner as Computation<any>)
  ) {
    if (runningTransition && Transition!.disposed.has(node)) return;
    if (node.state === PENDING) pending = node;
    else if (node.state === STALE) {
      top = node;
      pending = undefined;
    }
  }
  if (pending) {
    const updates = Updates;
    Updates = null;
    lookDownstream(pending);
    Updates = updates;
    if (!top || top.state !== STALE) return;
    if (runningTransition) {
      node = top;
      while ((node.fn || node.attached) && (node = node.owner as Computation<any>)) {
        if (Transition!.disposed.has(node)) return;
      }
    }
  }
  top && updateComputation(top);
}

function runUpdates(fn: () => void, init: boolean) {
  if (Updates) return fn();
  let wait = false;
  if (!init) Updates = [];
  if (Effects) wait = true;
  else Effects = [];
  ExecCount++;
  try {
    fn();
  } catch (err) {
    handleError(err);
  } finally {
    completeUpdates(wait);
  }
}

function completeUpdates(wait: boolean) {
  if (Updates) {
    runQueue(Updates);
    Updates = null;
  }
  if (wait) return;
  let cbs;
  if (Transition && Transition.running) {
    if (Transition.promises.size) {
      Transition.running = false;
      Transition.effects.push.apply(Transition.effects, Effects!);
      Effects = null;
      setTransPending(true);
      return;
    }
    // finish transition
    const sources = Transition.sources;
    cbs = Transition.cb;
    Transition = null;
    batch(() => {
      sources.forEach(v => {
        v.value = v.tValue;
        if ((v as Memo<any>).owned) {
          for (let i = 0, len = (v as Memo<any>).owned!.length; i < len; i++)
            cleanNode((v as Memo<any>).owned![i]);
        }
        if ((v as Memo<any>).tOwned) (v as Memo<any>).owned = (v as Memo<any>).tOwned!;
        delete v.tValue;
        delete (v as Memo<any>).tOwned;
      });
      setTransPending(false);
    });
  }
  if (Effects!.length)
    batch(() => {
      runEffects(Effects!);
      Effects = null;
    });
  else {
    Effects = null;
    if ("_SOLID_DEV_") globalThis._$afterUpdate && globalThis._$afterUpdate();
  }
  if (cbs) cbs.forEach(cb => cb());
}

function runQueue(queue: Computation<any>[]) {
  for (let i = 0; i < queue.length; i++) runTop(queue[i]);
}

function runUserEffects(queue: Computation<any>[]) {
  let i,
    userLength = 0;
  for (i = 0; i < queue.length; i++) {
    const e = queue[i];
    if (!e.user) runTop(e);
    else queue[userLength++] = e;
  }
  const resume = queue.length;
  for (i = 0; i < userLength; i++) runTop(queue[i]);
  for (i = resume; i < queue.length; i++) runTop(queue[i]);
}

function lookDownstream(node: Computation<any>) {
  node.state = 0;
  for (let i = 0; i < node.sources!.length; i += 1) {
    const source = node.sources![i] as Memo<any>;
    if (source.sources) {
      if (source.state === STALE) runTop(source);
      else if (source.state === PENDING) lookDownstream(source);
    }
  }
}

function markUpstream(node: Memo<any>) {
  for (let i = 0; i < node.observers!.length; i += 1) {
    const o = node.observers![i];
    if (!o.state) {
      o.state = PENDING;
      (o as Memo<any>).observers && markUpstream(o as Memo<any>);
    }
  }
}

function cleanNode(node: Owner) {
  let i;
  if ((node as Computation<any>).sources) {
    while ((node as Computation<any>).sources!.length) {
      const source = (node as Computation<any>).sources!.pop()!,
        index = (node as Computation<any>).sourceSlots!.pop()!,
        obs = source.observers;
      if (obs && obs.length) {
        const n = obs.pop()!,
          s = source.observerSlots!.pop()!;
        if (index < obs.length) {
          n.sourceSlots![s] = index;
          obs[index] = n;
          source.observerSlots![index] = s;
        }
      }
    }
  }

  if (Transition && Transition.running && (node as Memo<any>).pure) {
    if ((node as Memo<any>).tOwned) {
      for (i = 0; i < (node as Memo<any>).tOwned!.length; i++)
        cleanNode((node as Memo<any>).tOwned![i]);
      delete (node as Memo<any>).tOwned;
    }
    reset(node as Computation<any>, true);
  } else if (node.owned) {
    for (i = 0; i < node.owned.length; i++) cleanNode(node.owned[i]);
    node.owned = null;
  }

  if (node.cleanups) {
    for (i = 0; i < node.cleanups.length; i++) node.cleanups[i]();
    node.cleanups = null;
  }
  (node as Computation<any>).state = 0;
  node.context = null;
}

function reset(node: Computation<any>, top?: boolean) {
  if (!top) {
    node.state = 0;
    Transition!.disposed.add(node);
  }
  if (node.owned) {
    for (let i = 0; i < node.owned.length; i++) reset(node.owned[i]);
  }
}

function handleError(err: any) {
  const fns = ERROR && lookup(Owner, ERROR);
  if (!fns) throw err;
  fns.forEach((f: (err: any) => void) => f(err));
}

function lookup(owner: Owner | null, key: symbol | string): any {
  return (
    owner && ((owner.context && owner.context[key]) || (owner.owner && lookup(owner.owner, key)))
  );
}

function resolveChildren(children: any): unknown {
  if (typeof children === "function" && !children.length) return resolveChildren(children());
  if (Array.isArray(children)) {
    const results: any[] = [];
    for (let i = 0; i < children.length; i++) {
      let result = resolveChildren(children[i]);
      Array.isArray(result) ? results.push.apply(results, result) : results.push(result);
    }
    return results;
  }
  return children;
}

function createProvider(id: symbol) {
  return function provider(props: { value: unknown; children: any }) {
    return (createMemo(() => {
      Owner!.context = { [id]: props.value };
      return children(() => props.children);
    }) as unknown) as JSX.Element;
  };
}

function hash(s: string) {
  for (var i = 0, h = 9; i < s.length; ) h = Math.imul(h ^ s.charCodeAt(i++), 9 ** 9);
  return `${h ^ (h >>> 9)}`;
}

function serializeValues(sources: Record<string, { value: unknown }> = {}) {
  const k = Object.keys(sources);
  const result: Record<string, unknown> = {};
  for (let i = 0; i < k.length; i++) {
    const key = k[i];
    result[key] = sources[key].value;
  }
  return result;
}

function serializeChildren(root: Owner): GraphRecord {
  const result: GraphRecord = {};
  for (let i = 0, len = root.owned!.length; i < len; i++) {
    const node = root.owned![i];
    result[node.componentName ? `${node.componentName}:${node.name}` : node.name!] = {
      ...serializeValues(node.sourceMap),
      ...(node.owned ? serializeChildren(node) : {})
    };
  }
  return result;
}
