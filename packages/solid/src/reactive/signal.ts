// Inspired by S.js[https://github.com/adamhaile/S] by Adam Haile
import { requestCallback, Task } from "./scheduler";

export const equalFn = <T>(a: T, b: T) => a === b;
let ERROR: symbol | null = null;

const NOTPENDING = {};
const STALE = 1;
const PENDING = 2;
const UNOWNED: Owner = {
  owned: null,
  cleanups: null,
  context: null,
  owner: null
};
const [transPending, setTransPending] = createSignal(false, true);
let Owner: Owner | null = null;
let Listener: Computation<any> | null = null;
let Pending: Signal<any>[] | null = null;
let Updates: Computation<any>[] | null = null;
let Effects: Computation<any>[] | null = null;
let Transition: Transition | null = null;
let ExecCount = 0;

interface Signal<T> {
  value?: T;
  observers: Computation<any>[] | null;
  observerSlots: number[] | null;
  pending: T | {};
  comparator?: (prev: T, next: T) => boolean;
}

interface Owner {
  owned: Computation<any>[] | null;
  cleanups: (() => void)[] | null;
  owner?: Owner | null;
  context: any | null;
}

interface Computation<T> extends Owner {
  fn: (v?: T) => T;
  state: number;
  sources: Signal<T>[] | null;
  sourceSlots: number[] | null;
  value?: T;
  updatedAt: number | null;
  pure: boolean;
}

interface Memo<T> extends Signal<T>, Computation<T> {}

interface Transition {
  sources: Map<Signal<any>, any>;
  effects: Computation<any>[];
  promises: Set<Promise<any>>;
  running: boolean;
  timeout: NodeJS.Timeout | null;
}

export function createRoot<T>(fn: (dispose: () => void) => T, detachedOwner?: Owner): T {
  detachedOwner && (Owner = detachedOwner);
  const listener = Listener,
    owner = Owner,
    root: Owner = fn.length === 0 ? UNOWNED : { owned: null, cleanups: null, context: null, owner };
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

export function createSignal<T>(): [() => T | undefined, (v: T) => T];
export function createSignal<T>(
  value: T,
  areEqual?: boolean | ((prev: T, next: T) => boolean)
): [() => T, (v: T) => T];
export function createSignal<T>(
  value?: T,
  areEqual?: boolean | ((prev: T, next: T) => boolean)
): [() => T, (v: T) => T] {
  const s: Signal<T> = {
    value,
    observers: null,
    observerSlots: null,
    pending: NOTPENDING,
    comparator: areEqual ? (typeof areEqual === "function" ? areEqual : equalFn) : undefined
  };
  return [readSignal.bind(s), writeSignal.bind(s)];
}

export function createComputed<T>(fn: (v?: T) => T, value?: T): void {
  updateComputation(createComputation(fn, value, true));
}

export function createRenderEffect<T>(fn: (v?: T) => T, value?: T): void {
  updateComputation(createComputation(fn, value, false));
}

export function createEffect<T>(fn: (v?: T) => T, value?: T): void {
  Effects!.push(createComputation(fn, value, false));
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

export function createDeferred<T>(fn: () => T, options?: { timeoutMs: number }) {
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
      return fn();
    },
    undefined,
    true
  );
  updateComputation(node);
  setDeferred(node.value);
  return deferred;
}

export function batch<T>(fn: () => T): T {
  let pending = Pending,
    q: Signal<any>[] = (Pending = []);
  const result = fn();
  Pending = pending;
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

export function useTransition(
  config: { timeoutMs?: number } = {}
): [() => boolean, (fn: () => void) => void] {
  return [transPending, createTransition(config)];
}

export function untrack<T>(fn: () => T): T {
  let result: T,
    listener = Listener;

  Listener = null;
  result = fn();
  Listener = listener;

  return result;
}

export function onCleanup(fn: () => void) {
  if (Owner === null)
    console.warn("cleanups created outside a `createRoot` or `render` will never be run");
  else if (Owner.cleanups === null) Owner.cleanups = [fn];
  else Owner.cleanups.push(fn);
  return fn;
}

export function onError(fn: (err: any) => void): void {
  ERROR || (ERROR = Symbol("error"));
  if (Owner === null)
    console.warn("error handlers created outside a `createRoot` or `render` will never be run");
  else if (Owner.context === null) Owner.context = { [ERROR]: [fn] };
  else if (!Owner.context[ERROR]) Owner.context[ERROR] = [fn];
  else Owner.context[ERROR].push(fn);
}

export function getListener() {
  return Listener;
}

// Context API
export interface Context<T> {
  id: symbol;
  Provider: (props: { value: T; children: any }) => any;
  defaultValue?: T;
}

export function createContext<T>(defaultValue?: T): Context<T> {
  const id = Symbol("context");
  return { id, Provider: createProvider(id), defaultValue };
}

export function useContext<T>(context: Context<T>): T {
  return lookup(Owner, context.id) || context.defaultValue;
}

export function getContextOwner() {
  return Owner;
}

// Resource API
type SuspenseState = "running" | "suspended" | "fallback";
type SuspenseContextType = {
  increment?: () => void;
  decrement?: () => void;
  state?: () => SuspenseState;
  initializing?: boolean;
};

export const SuspenseContext: Context<SuspenseContextType> & {
  active?(): boolean;
  increment?(): void;
  decrement?(): void;
} = createContext<SuspenseContextType>({});

export interface Resource<T> {
  (): T | undefined;
  loading: boolean;
}
export function createResource<T>(
  init?: T,
  options: { name?: string; notStreamed?: boolean } = {}
): [Resource<T>, (fn: () => Promise<T> | T) => Promise<T> | T] {
  const [s, set] = createSignal(init),
    [loading, setLoading] = createSignal<boolean>(false, true),
    contexts = new Set<SuspenseContextType>(),
    h = globalThis._$HYDRATION || {};
  let err: any = null,
    pr: Promise<T> | null = null;
  function loadEnd(p: Promise<T>, v: T, e?: any) {
    if (Transition && Transition.promises.has(p)) {
      Transition.promises.delete(p);
      if (pr === p || !Transition.promises.size) {
        err = e;
        runUpdates(() => {
          Transition!.running = true;
          pr = null;
          !Transition!.promises.size && (Effects = Transition!.effects);
          completeLoad(v);
        }, false);
      }
      return v;
    }
    if (pr === p) {
      err = e;
      pr = null;
      completeLoad(v);
    }
    return v;
  }
  function completeLoad(v: T) {
    batch(() => {
      set(v);
      if (h.asyncSSR && options.name) h.resources![options.name] = v;
      setLoading(false);
      for (let c of contexts.keys()) c.decrement!();
      contexts.clear();
    });
  }

  function read() {
    const c = useContext(SuspenseContext),
      v = s();
    if (err) throw err;
    if (pr && c.increment && !contexts.has(c)) {
      c.increment!();
      contexts.add(c);
    }
    return v;
  }
  function load(fn: () => Promise<T> | T) {
    err = null;
    let p: Promise<T> | T;
    const hydrating = h.context && !!h.context.registry;
    if (hydrating) {
      if (h.loadResource && !options.notStreamed) {
        fn = h.loadResource;
      } else if (options.name && h.resources && options.name in h.resources) {
        fn = () => {
          const data = h.resources![options.name!];
          delete h.resources![options.name!];
          return data;
        };
      }
    }
    p = fn();
    if (typeof p !== "object" || !("then" in p)) {
      Transition && pr && Transition.promises.delete(pr);
      pr = null;
      completeLoad(p);
      return p;
    }
    pr = p;
    if (Transition) Transition.promises.add(p);
    batch(() => {
      setLoading(true);
      set(untrack(s));
    });
    return p.then(
      v => loadEnd(p as Promise<T>, v),
      e => loadEnd(p as Promise<T>, s()!, e)
    );
  }
  Object.defineProperty(read, "loading", {
    get() {
      return loading();
    }
  });
  return [read as Resource<T>, load];
}

function readSignal(this: Signal<any> | Memo<any>) {
  if ((this as Memo<any>).state && (this as Memo<any>).sources) {
    const updates = Updates,
      effects = Effects;
    Updates = Effects = null;
    (this as Memo<any>).state === STALE
      ? updateComputation(this as Memo<any>)
      : lookDownstream(this as Memo<any>);
    Updates = updates;
    Effects = effects;
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
  if (Transition && Transition.running && Transition.sources.has(this))
    return Transition.sources.get(this);
  return this.value;
}

function writeSignal(this: Signal<any> | Memo<any>, value: any, isMemo?: boolean) {
  if (this.comparator) {
    if (Transition && Transition.running && Transition.sources.has(this)) {
      if (this.comparator(Transition.sources.get(this), value)) return value;
    } else if (this.comparator(this.value, value)) return value;
  }
  if (Pending) {
    if (this.pending === NOTPENDING) Pending.push(this);
    this.pending = value;
    return value;
  }
  if (Transition) {
    if (Transition.running || (!isMemo && Transition.sources.has(this)))
      Transition.sources.set(this, value);
    if (!Transition.running) this.value = value;
  } else this.value = value;
  if (this.observers && (!Updates || this.observers.length)) {
    runUpdates(() => {
      for (let i = 0; i < this.observers!.length; i += 1) {
        const o = this.observers![i];
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
    runComputation(node, Transition.sources.get(node as Memo<any>), time);
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
    console.warn("computations created outside a `createRoot` or `render` will never be disposed");
  else if (Owner !== UNOWNED) {
    if (!Owner.owned) Owner.owned = [c];
    else Owner.owned.push(c);
  }
  return c;
}

function runTop(node: Computation<any> | null) {
  let top = node!.state === STALE && node,
    pending;
  while (node!.fn && (node = node!.owner as Computation<any>)) {
    if (node.state === PENDING) pending = node;
    else if (node.state === STALE) {
      top = node;
      pending = undefined;
    }
  }
  if (pending) {
    const updates = Updates,
      effects = Effects;
    Updates = Effects = null;
    lookDownstream(pending);
    Updates = updates;
    Effects = effects;
    if (!top || top.state !== STALE) return;
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
    do {
      if (Updates) {
        runQueue(Updates);
        Updates = [];
      }
      if (!wait) {
        if (Transition && Transition.running && Transition.promises.size) {
          Transition.effects.push(...Effects);
        } else runQueue(Effects);
        Effects = [];
      }
    } while (Updates && Updates.length);
    Updates = null;
    if (!wait) Effects = null;
    if (Transition) {
      if (!Transition.promises.size) {
        Transition.sources.forEach((v, s) => (s.value = v));
        if (Transition.timeout) clearTimeout(Transition.timeout);
        Transition = null;
        setTransPending(false);
      } else Transition.running = false;
    }
  }
}

function runQueue(queue: Computation<any>[]) {
  for (let i = 0; i < queue!.length; i += 1) runTop(queue![i]);
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

  if (node.owned) {
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

function resolveChildren(children: any): any {
  if (typeof children === "function") return createMemo(() => resolveChildren(children()));
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
    let rendered;
    createRenderEffect(() => {
      Owner!.context = { [id]: props.value };
      rendered = untrack(() => resolveChildren(props.children));
    });
    return rendered;
  };
}

function createTransition(config: { timeoutMs?: number }) {
  return (fn: () => void) => {
    setTransPending(true);
    Transition ||
      (Transition = {
        sources: new Map(),
        effects: [],
        promises: new Set(),
        running: true,
        timeout: null
      });
    if (config.timeoutMs) {
      if (Transition.timeout) clearTimeout(Transition.timeout);
      Transition.timeout = setTimeout(() => {
        Transition!.promises.clear();
        runUpdates(() => {
          Transition!.running = true;
          Effects = Transition!.effects;
        }, false);
      }, config.timeoutMs);
    }
    Transition.running = true;
    runUpdates(fn, false);
  };
}
