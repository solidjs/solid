import type { JSX } from "../jsx.js";

export const equalFn = <T>(a: T, b: T) => a === b;
export const $PROXY = Symbol("solid-proxy");
export const $TRACK = Symbol("solid-track");
export const $DEVCOMP = Symbol("solid-dev-component");
export const DEV = undefined;

export type Accessor<T> = () => T;
export type Setter<T> = undefined extends T
  ? <U extends T>(value?: (U extends Function ? never : U) | ((prev?: T) => U)) => U
  : <U extends T>(value: (U extends Function ? never : U) | ((prev: T) => U)) => U;
export type Signal<T> = [get: Accessor<T>, set: Setter<T>];

const ERROR = Symbol("error");
export const BRANCH = Symbol("branch");
export function castError(err: any) {
  if (err instanceof Error || typeof err === "string") return err;
  return new Error("Unknown error");
}

function handleError(err: any) {
  err = castError(err);
  const fns = lookup(Owner, ERROR);
  if (!fns) throw err;
  for (const f of fns) f(err);
}

const UNOWNED: Owner = { context: null, owner: null };
export let Owner: Owner | null = null;

interface Owner {
  owner: Owner | null;
  context: any | null;
}

export function createRoot<T>(fn: (dispose: () => void) => T, detachedOwner?: typeof Owner): T {
  const owner = Owner,
    root =
      fn.length === 0
        ? UNOWNED
        : {
            context: null,
            owner: detachedOwner === undefined ? owner : detachedOwner
          };
  Owner = root;
  let result: T;
  try {
    result = fn(() => {});
  } catch (err) {
    handleError(err);
  } finally {
    Owner = owner;
  }
  return result!;
}

export function createSignal<T>(
  value: T,
  options?: { equals?: false | ((prev: T, next: T) => boolean); name?: string }
): [get: () => T, set: (v: (T extends Function ? never : T) | ((prev: T) => T)) => T] {
  return [
    () => value as T,
    v => {
      return (value = typeof v === "function" ? (v as (prev: T) => T)(value) : v);
    }
  ];
}

export function createComputed<T>(fn: (v?: T) => T, value?: T): void {
  Owner = { owner: Owner, context: null };
  try {
    fn(value);
  } catch (err) {
    handleError(err);
  } finally {
    Owner = Owner.owner;
  }
}

export const createRenderEffect = createComputed;

export function createEffect<T>(fn: (v?: T) => T, value?: T): void {}

export function createReaction(fn: () => void) {
  return (fn: () => void) => {
    fn();
  };
}

export function createMemo<T>(fn: (v?: T) => T, value?: T): () => T {
  Owner = { owner: Owner, context: null };
  let v: T;
  try {
    v = fn(value);
  } catch (err) {
    handleError(err);
  } finally {
    Owner = Owner.owner;
  }
  return () => v;
}

export function createDeferred<T>(source: () => T) {
  return source;
}

export function createSelector<T>(source: () => T, fn: (k: T, value: T) => boolean = equalFn) {
  return (k: T) => fn(k, source());
}

export function batch<T>(fn: () => T): T {
  return fn();
}

export const untrack = batch;

export function on<T, U>(
  deps: Array<() => T> | (() => T),
  fn: (value: Array<T> | T, prev?: Array<T> | T, prevResults?: U) => U,
  options: { defer?: boolean } = {}
): (prev?: U) => U | undefined {
  const isArray = Array.isArray(deps);
  const defer = options.defer;
  return () => {
    if (defer) return undefined;
    let value: Array<T> | T;
    if (isArray) {
      value = [];
      for (let i = 0; i < deps.length; i++) value.push((deps as Array<() => T>)[i]());
    } else value = (deps as () => T)();
    return fn!(value);
  };
}

export function onMount(fn: () => void) {}

export function onCleanup(fn: () => void) {
  let node;
  if (Owner && (node = lookup(Owner, BRANCH))) {
    if (!node.cleanups) node.cleanups = [fn];
    else node.cleanups.push(fn);
  }
  return fn;
}

export function cleanNode(node: { cleanups?: Function[] | null }) {
  if (node.cleanups) {
    for (let i = 0; i < node.cleanups.length; i++) node.cleanups[i]();
    node.cleanups = undefined;
  }
}

export function onError(fn: (err: any) => void): void {
  if (Owner) {
    if (Owner.context === null) Owner.context = { [ERROR]: [fn] };
    else if (!Owner.context[ERROR]) Owner.context[ERROR] = [fn];
    else Owner.context[ERROR].push(fn);
  }
}

export function getListener() {
  return null;
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
  let ctx;
  return (ctx = lookup(Owner, context.id)) !== undefined ? ctx : context.defaultValue;
}

export function getOwner() {
  return Owner;
}

type ChildrenReturn = Accessor<any> & { toArray: () => any[] };
export function children(fn: () => any): ChildrenReturn {
  const memo = createMemo(() => resolveChildren(fn()));
  (memo as ChildrenReturn).toArray = () => {
    const c = memo();
    return Array.isArray(c) ? c : c != null ? [c] : [];
  };
  return memo as ChildrenReturn;
}

export function runWithOwner<T>(o: typeof Owner, fn: () => T): T | undefined {
  const prev = Owner;
  Owner = o;
  try {
    return fn();
  } catch (err) {
    handleError(err);
  } finally {
    Owner = prev;
  }
}

export function lookup(owner: Owner | null, key: symbol | string): any {
  return owner
    ? owner.context && owner.context[key] !== undefined
      ? owner.context[key]
      : lookup(owner.owner, key)
    : undefined;
}

function resolveChildren(children: any): unknown {
  if (typeof children === "function" && !children.length) return resolveChildren(children());
  if (Array.isArray(children)) {
    const results: any[] = [];
    for (let i = 0; i < children.length; i++) {
      const result = resolveChildren(children[i]);
      Array.isArray(result) ? results.push.apply(results, result) : results.push(result);
    }
    return results;
  }
  return children;
}

function createProvider(id: symbol) {
  return function provider(props: { value: unknown; children: any }) {
    return createMemo<JSX.Element>(() => {
      Owner!.context = { [id]: props.value };
      return children(() => props.children);
    });
  };
}

export interface Task {
  id: number;
  fn: ((didTimeout: boolean) => void) | null;
  startTime: number;
  expirationTime: number;
}
export function requestCallback(fn: () => void, options?: { timeout: number }): Task {
  return { id: 0, fn: () => {}, startTime: 0, expirationTime: 0 };
}
export function cancelCallback(task: Task) {}

export function mapArray<T, U>(
  list: () => T[],
  mapFn: (v: T, i: () => number) => U,
  options: { fallback?: () => any } = {}
): () => U[] {
  const items = list();
  let s: U[] = [];
  if (items.length) {
    for (let i = 0, len = items.length; i < len; i++) s.push(mapFn(items[i], () => i));
  } else if (options.fallback) s = [options.fallback()];
  return () => s;
}

function getSymbol() {
  const SymbolCopy = Symbol as any;
  return SymbolCopy.observable || "@@observable";
}

export type ObservableObserver<T> =
  | ((v: T) => void)
  | {
      next: (v: T) => void;
      error?: (v: any) => void;
      complete?: (v: boolean) => void;
    };
export function observable<T>(input: Accessor<T>) {
  return {
    subscribe(observer: ObservableObserver<T>) {
      if (!(observer instanceof Object) || observer == null) {
        throw new TypeError("Expected the observer to be an object.");
      }

      const handler =
        typeof observer === "function" ? observer : observer.next && observer.next.bind(observer);

      if (!handler) {
        return { unsubscribe() {} };
      }

      const dispose = createRoot(disposer => {
        createEffect(() => {
          const v = input();
          untrack(() => handler(v));
        });

        return disposer;
      });

      if (getOwner()) onCleanup(dispose);

      return {
        unsubscribe() {
          dispose();
        }
      };
    },
    [Symbol.observable || "@@observable"]() {
      return this;
    }
  };
}

export function from<T>(
  producer:
    | ((setter: Setter<T>) => () => void)
    | {
        subscribe: (fn: (v: T) => void) => (() => void) | { unsubscribe: () => void };
      }
): Accessor<T> {
  const [s, set] = createSignal<T | undefined>(undefined, { equals: false }) as [
    Accessor<T>,
    Setter<T>
  ];
  if ("subscribe" in producer) {
    const unsub = producer.subscribe(v => set(() => v));
    onCleanup(() => ("unsubscribe" in unsub ? unsub.unsubscribe() : unsub()));
  } else {
    const clean = producer(set);
    onCleanup(clean);
  }
  return s;
}

export function enableExternalSource(factory: any) {}
