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

function handleError(err: unknown, owner = Owner): void {
  const fns = owner && owner.context && owner.context[ERROR];
  if (!fns) throw err;

  try {
    for (const f of fns) f(err);
  } catch (e) {
    handleError(e, (owner && owner.owner) || null);
  }
}

const UNOWNED: Owner = { context: null, owner: null, owned: null, cleanups: null };
export let Owner: Owner | null = null;

interface Owner {
  owner: Owner | null;
  context: any | null;
  owned: Owner[] | null;
  cleanups: (() => void)[] | null;
}

export function createOwner(): Owner {
  const o = { owner: Owner, context: Owner ? Owner.context : null, owned: null, cleanups: null };
  if (Owner) {
    if (!Owner.owned) Owner.owned = [o];
    else Owner.owned.push(o);
  }
  return o;
}

export function createRoot<T>(fn: (dispose: () => void) => T, detachedOwner?: typeof Owner): T {
  const owner = Owner,
    current = detachedOwner === undefined ? owner : detachedOwner,
    root =
      fn.length === 0
        ? UNOWNED
        : {
            context: current ? current.context : null,
            owner: current,
            owned: null,
            cleanups: null
          };
  Owner = root;
  let result: T;
  try {
    result = fn(fn.length === 0 ? () => {} : () => cleanNode(root));
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
  Owner = createOwner();
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
  Owner = createOwner();
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
  if (Owner) {
    if (!Owner.cleanups) Owner.cleanups = [fn];
    else Owner.cleanups.push(fn);
  }
  return fn;
}

export function cleanNode(node: Owner) {
  if (node.owned) {
    for (let i = 0; i < node.owned.length; i++) cleanNode(node.owned[i]);
    node.owned = null;
  }
  if (node.cleanups) {
    for (let i = 0; i < node.cleanups.length; i++) node.cleanups[i]();
    node.cleanups = null;
  }
}

export function catchError<T>(fn: () => T, handler: (err: Error) => void) {
  const owner = createOwner();
  owner.context = { ...owner.context, [ERROR]: [handler] };
  Owner = owner;
  try {
    return fn();
  } catch (err) {
    handleError(err);
  } finally {
    Owner = Owner!.owner;
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
  return Owner && Owner.context && Owner.context[context.id] !== undefined
    ? Owner.context[context.id]
    : context.defaultValue;
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

function resolveChildren(children: any): unknown {
  // `!children.length` avoids running functions that arent signals
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
      Owner!.context = { ...Owner!.context, [id]: props.value };
      return children(() => props.children) as unknown as JSX.Element;
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
  list: Accessor<readonly T[] | undefined | null | false>,
  mapFn: (v: T, i: Accessor<number>) => U,
  options: { fallback?: Accessor<any> } = {}
): () => U[] {
  const items = list();
  let s: U[] = [];
  if (items && items.length) {
    for (let i = 0, len = items.length; i < len; i++) s.push(mapFn(items[i], () => i));
  } else if (options.fallback) s = [options.fallback()];
  return () => s;
}

export function indexArray<T, U>(
  list: Accessor<readonly T[] | undefined | null | false>,
  mapFn: (v: Accessor<T>, i: number) => U,
  options: { fallback?: Accessor<any> } = {}
): () => U[] {
  const items = list();
  let s: U[] = [];
  if (items && items.length) {
    for (let i = 0, len = items.length; i < len; i++) s.push(mapFn(() => items[i], i));
  } else if (options.fallback) s = [options.fallback()];
  return () => s;
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

/**
 * @deprecated since version 1.7.0 and will be removed in next major - use catchError instead
 */
export function onError(fn: (err: Error) => void): void {
  if (Owner) {
    if (Owner.context === null || !Owner.context[ERROR]) {
      // terrible de-opt
      Owner.context = { ...Owner.context, [ERROR]: [fn] };
      mutateContext(Owner, ERROR, [fn]);
    } else Owner.context[ERROR].push(fn);
  }
}

function mutateContext(o: Owner, key: symbol, value: any) {
  if (o.owned) {
    for (let i = 0; i < o.owned.length; i++) {
      if (o.owned[i].context === o.context) mutateContext(o.owned[i], key, value);
      if (!o.owned[i].context) {
        o.owned[i].context = o.context;
        mutateContext(o.owned[i], key, value);
      } else if (!o.owned[i].context[key]) {
        o.owned[i].context[key] = value;
        mutateContext(o.owned[i], key, value);
      }
    }
  }
}
