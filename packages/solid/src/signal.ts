// Inspired by S.js[https://github.com/adamhaile/S] by Adam Haile
import { requestCallback, Task } from "./scheduler";

export const equalFn = <T>(a: T, b: T) => a === b;
const ERROR = Symbol("error");

const NOTPENDING = {};
const STALE = 1;
const PENDING = 2;
const UNOWNED: Owner = { owned: null, cleanups: null, context: null, owner: null };
let Owner: Owner | null = null;
let Listener: Computation<any> | null = null;
let Pending: Signal<any>[] | null = null;
let Updates: Computation<any>[] | null = null;
let Afters: (() => void)[] = [];
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
}

interface Memo<T> extends Signal<T>, Computation<T> {}

export function createRoot<T>(fn: (dispose: () => void) => T, detachedOwner?: Owner): T {
  detachedOwner && (Owner = detachedOwner);
  const listener = Listener,
    owner = Owner,
    root: Owner = fn.length === 0 ? UNOWNED : { owned: null, cleanups: null, context: null, owner };
  Owner = root;
  Listener = null;
  let result: T;
  try {
    result = fn(() => cleanNode(root));
  } catch (err) {
    const fns = lookup(Owner, ERROR);
    if (!fns) throw err;
    fns.forEach((f: (err: any) => void) => f(err));
  } finally {
    while (Afters.length) Afters.shift()!();
    Listener = listener;
    Owner = owner;
  }
  return result!;
}

export function createSignal<T>(
  value?: T,
  areEqual?: (prev: T, next: T) => boolean
): [() => T, (v: T) => void] {
  const s: Signal<T> = {
    value,
    observers: null,
    observerSlots: null,
    pending: NOTPENDING,
    comparator: areEqual
  };
  return [readSignal.bind(s), writeSignal.bind(s)];
}

export function createEffect<T>(fn: (v?: T) => T, value?: T): void {
  updateComputation(createComputation(fn, value));
}

export function createDependentEffect<T>(
  fn: (v?: T) => T,
  deps: (() => any) | (() => any)[],
  defer?: boolean
) {
  const resolved = Array.isArray(deps) ? callAll(deps) : deps;
  defer = !!defer;
  createEffect<T>(value => {
    const listener = Listener;
    resolved();
    if (defer) defer = false;
    else {
      Listener = null;
      value = fn(value);
      Listener = listener;
    }
    return value!;
  });
}

export function createMemo<T>(
  fn: (v?: T) => T,
  value?: T,
  areEqual?: (prev: T, next: T) => boolean
): () => T {
  const c: Partial<Memo<T>> = createComputation<T>(fn, value);
  c.pending = NOTPENDING;
  c.observers = null;
  c.observerSlots = null;
  c.comparator = areEqual;
  updateComputation(c as Computation<T>);
  return readSignal.bind(c as Memo<T>);
}

export function createDeferred<T>(fn: () => T, options?: { timeoutMs: number }) {
  let t: Task,
    timeout = options ? options.timeoutMs : undefined;
  const [deferred, setDeferred] = createSignal(fn());
  createEffect(() => {
    fn();
    if (!t || !t.fn)
      t = requestCallback(() => setDeferred(fn()), timeout !== undefined ? { timeout } : undefined);
  });
  return deferred;
}

export function freeze<T>(fn: () => T): T {
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
  });
  return result;
}

export function sample<T>(fn: () => T): T {
  let result: T,
    listener = Listener;

  Listener = null;
  result = fn();
  Listener = listener;

  return result;
}

export function afterEffects(fn: () => void): void {
  Afters.push(fn);
}

export function onCleanup(fn: () => void) {
  if (Owner === null)
    console.warn("cleanups created outside a `createRoot` or `render` will never be run");
  else if (Owner.cleanups === null) Owner.cleanups = [fn];
  else Owner.cleanups.push(fn);
  return fn;
}

export function onError(fn: (err: any) => void): void {
  if (Owner === null)
    console.warn("error handlers created outside a `createRoot` or `render` will never be run");
  else if (Owner.context === null) Owner.context = { [ERROR]: [fn] };
  else if (!Owner.context[ERROR]) Owner.context[ERROR] = [fn];
  else Owner.context[ERROR].push(fn);
}

export function isListening() {
  return Listener !== null;
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
  return this.value;
}

function writeSignal(this: Signal<any> | Memo<any>, value: any) {
  if (this.comparator && this.comparator(this.value, value)) return;
  if (Pending) {
    if (this.pending === NOTPENDING) Pending.push(this);
    this.pending = value;
    return;
  }
  this.value = value;
  if (this.observers && (!Updates || this.observers.length)) {
    runUpdates(() => {
      for (let i = 0; i < this.observers!.length; i += 1) {
        const o = this.observers![i];
        if ((o as Memo<any>).observers && o.state !== PENDING) markUpstream(o as Memo<any>);
        o.state = STALE;
        if (Updates!.length > 10e5) throw new Error("Potential Infinite Loop Detected.");
        Updates!.push(o);
      }
    });
  }
}

function updateComputation(node: Computation<any>) {
  if (!node.fn) return;
  cleanNode(node);
  const owner = Owner,
    listener = Listener,
    time = ExecCount;
  Listener = Owner = node;
  const nextValue = node.fn(node.value);
  if (!node.updatedAt || node.updatedAt <= time) {
    if ((node as Memo<any>).observers && (node as Memo<any>).observers!.length) {
      writeSignal.call(node as Memo<any>, nextValue);
    } else node.value = nextValue;
    node.updatedAt = time;
  }
  Listener = listener;
  Owner = owner;
}

function createComputation<T>(fn: (v?: T) => T, init?: T) {
  const c: Computation<T> = {
    fn,
    state: 0,
    updatedAt: null,
    owned: null,
    sources: null,
    sourceSlots: null,
    cleanups: null,
    value: init,
    owner: Owner,
    context: null
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
  let top = node!.state === STALE && node;
  while ((node = node!.owner as Computation<any>)) node.state === STALE && (top = node);
  top && updateComputation(top);
}

function runUpdates(fn: () => void) {
  if (Updates) return fn();
  Updates = [];
  ExecCount++;
  try {
    fn();
    for (let i = 0; i < Updates!.length; i += 1) {
      try {
        runTop(Updates![i]);
      } catch (err) {
        const fns = lookup(Owner, ERROR);
        if (!fns) throw err;
        fns.forEach((f: (err: any) => void) => f(err));
      }
    }
  } finally {
    Updates = null;
    while (Afters.length) Afters.shift()!();
  }
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
        index = (node as Computation<any>).sourceSlots!.pop()!;
      if (source.observers && source.observers.length) {
        const n = source.observers.pop()!,
          s = source.observerSlots!.pop()!;
        if (n !== node) {
          n.sourceSlots![s] = index;
          source.observers[index] = n;
          source.observerSlots![index] = s;
        }
      }
    }
    (node as Computation<any>).state = 0;
  }

  if (node.owned) {
    for (i = 0; i < node.owned.length; i++) cleanNode(node.owned[i]);
    node.owned = null;
  }

  if (node.cleanups) {
    for (i = 0; i < node.cleanups.length; i++) node.cleanups[i]();
    node.cleanups = null;
  }
}

function callAll(ss: (() => any)[]) {
  return () => {
    for (let i = 0; i < ss.length; i++) ss[i]();
  };
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
    createEffect(() => {
      Owner!.context = { [id]: props.value };
      rendered = sample(() => resolveChildren(props.children));
    });
    return rendered;
  };
}
