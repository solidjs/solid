// Inspired by S.js[https://github.com/adamhaile/S] by Adam Haile
import { requestCallback, Task } from "./scheduler";
import { sharedConfig } from "../render/hydration";
import type { JSX } from "../jsx";

export type Accessor<T> = () => T;
export type Setter<T> = undefined extends T
  ? <U extends T>(v?: (U extends Function ? never : U) | ((prev?: T) => U)) => U
  : <U extends T>(v: (U extends Function ? never : U) | ((prev: T) => U)) => U;
export const equalFn = <T>(a: T, b: T) => a === b;
export const $PROXY = Symbol("solid-proxy");
const signalOptions = { equals: equalFn };
let ERROR: symbol | null = null;
let runEffects = runQueue;
export const NOTPENDING = {};
const STALE = 1;
const PENDING = 2;
const UNOWNED: Owner = {
  owned: null,
  cleanups: null,
  context: null,
  owner: null
};
const [transPending, setTransPending] = /*@__PURE__*/ createSignal(false);
export var Owner: Owner | null = null;
export let Transition: Transition | null = null;
let Scheduler: ((fn: () => void) => any) | null = null;
let Listener: Computation<any> | null = null;
let Pending: Signal<any>[] | null = null;
let Updates: Computation<any>[] | null = null;
let Effects: Computation<any>[] | null = null;
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
  sourceMap?: Record<string, { value: unknown }>;
  name?: string;
  componentName?: string;
}

interface Computation<T> extends Owner {
  fn: (v?: T) => T;
  state: number;
  tState?: number;
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
  queue: Set<Computation<any>>;
  scheduler?: (fn: () => void) => unknown;
  running: boolean;
  cb: (() => void)[];
}

/**
 * Creates a new non-tracked reactive context that doesn't auto-dispose
 *
 * @param fn a function in which the reactive state is scoped
 * @param detachedOwner optional reactive context to bind the root to
 * @returns the output of `fn`.
 *
 * @description https://www.solidjs.com/docs/latest/api#createroot
 */
export function createRoot<T>(fn: (dispose: () => void) => T, detachedOwner?: Owner): T {
  detachedOwner && (Owner = detachedOwner);
  const listener = Listener,
    owner = Owner,
    root: Owner =
      fn.length === 0 && !"_SOLID_DEV_"
        ? UNOWNED
        : { owned: null, cleanups: null, context: null, owner };

  if ("_SOLID_DEV_" && owner) root.name = `${(owner as Computation<any>).name}-r${rootCount++}`;
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

export type SignalOptions<T> = { name?: string; equals?: false | ((prev: T, next: T) => boolean) };

/**
 * Creates a simple reactive state with a getter and setter
 * ```typescript
 * const [state: Accessor<T>, setState: Setter<T>] = createSignal<T>(
 *  value: T,
 *  options?: { name?: string, equals?: false | ((prev: T, next: T) => boolean) }
 * )
 * ```
 * @param value initial value of the state; if empty, the state's type will automatically extended with undefined; otherwise you need to extend the type manually if you want setting to undefined not be an error
 * @param options optional object with a name for debugging purposes and equals, a comparator function for the previous and next value to allow fine-grained control over the reactivity
 *
 * @returns ```typescript
 * [state: Accessor<T>, setState: Setter<T>]
 * ```
 * * the Accessor is merely a function that returns the current value and registers each call to the reactive root
 * * the Setter is a function that allows directly setting or mutating the value:
 * ```typescript
 * const [count, setCount] = createSignal(0);
 * setCount(count => count + 1);
 * ```
 *
 * @description https://www.solidjs.com/docs/latest/api#createsignal
 */
export function createSignal<T>(): [get: Accessor<T | undefined>, set: Setter<T | undefined>];
export function createSignal<T>(
  value: T,
  options?: { equals?: false | ((prev: T, next: T) => boolean); name?: string; internal?: boolean }
): [get: Accessor<T>, set: Setter<T>];
export function createSignal<T>(
  value?: T,
  options?: { equals?: false | ((prev: T, next: T) => boolean); name?: string; internal?: boolean }
): [get: Accessor<T>, set: Setter<T>] {
  options = options ? Object.assign({}, signalOptions, options) : signalOptions;
  const s: Signal<T> = {
    value,
    observers: null,
    observerSlots: null,
    pending: NOTPENDING,
    comparator: options.equals || undefined
  };
  if ("_SOLID_DEV_" && !options.internal)
    s.name = registerGraph(options.name || hashValue(value), s as { value: unknown });

  return [
    readSignal.bind(s),
    ((value: T extends Function ? never : T | ((p?: T) => T)) => {
      if (typeof value === "function") {
        if (Transition && Transition.running && Transition.sources.has(s))
          value = value(s.pending !== NOTPENDING ? s.pending : s.tValue);
        else value = value(s.pending !== NOTPENDING ? s.pending : s.value);
      }
      return writeSignal(s, value);
    }) as Setter<T>
  ];
}

/**
 * Creates a reactive computation that runs immediately before render, mainly used to write to other reactive primitives
 * ```typescript
 * export function createComputed<T>(
 *   fn: (v: T) => T,
 *   value?: T,
 *   options?: { name?: string }
 * ): void;
 * ```
 * @param fn a function that receives its previous or the initial value, if set, and returns a new value used to react on a computation
 * @param value an optional initial value for the computation; if set, fn will never receive undefined as first argument
 * @param options allows to set a name in dev mode for debugging purposes
 *
 * @description https://www.solidjs.com/docs/latest/api#createcomputed
 */
export function createComputed<T>(fn: (v?: T) => T | undefined): void;
export function createComputed<T>(fn: (v: T) => T, value: T, options?: { name?: string }): void;
export function createComputed<T>(fn: (v?: T) => T, value?: T, options?: { name?: string }): void {
  updateComputation(createComputation(fn, value, true, STALE, "_SOLID_DEV_" ? options : undefined));
}

/**
 * Creates a reactive computation that runs during the render phase as DOM elements are created and updated but not necessarily connected
 * ```typescript
 * export function createRenderEffect<T>(
 *   fn: (v: T) => T,
 *   value?: T,
 *   options?: { name?: string }
 * ): void;
 * ```
 * @param fn a function that receives its previous or the initial value, if set, and returns a new value used to react on a computation
 * @param value an optional initial value for the computation; if set, fn will never receive undefined as first argument
 * @param options allows to set a name in dev mode for debugging purposes
 *
 * @description https://www.solidjs.com/docs/latest/api#createrendereffect
 */
export function createRenderEffect<T>(fn: (v?: T) => T | undefined): void;
export function createRenderEffect<T>(fn: (v: T) => T, value: T, options?: { name?: string }): void;
export function createRenderEffect<T>(
  fn: (v?: T) => T,
  value?: T,
  options?: { name?: string }
): void {
  updateComputation(
    createComputation(fn, value, false, STALE, "_SOLID_DEV_" ? options : undefined)
  );
}

/**
 * Creates a reactive computation that runs after the render phase
 * ```typescript
 * export function createEffect<T>(
 *   fn: (v: T) => T,
 *   value?: T,
 *   options?: { name?: string }
 * ): void;
 * ```
 * @param fn a function that receives its previous or the initial value, if set, and returns a new value used to react on a computation
 * @param value an optional initial value for the computation; if set, fn will never receive undefined as first argument
 * @param options allows to set a name in dev mode for debugging purposes
 *
 * @description https://www.solidjs.com/docs/latest/api#createeffect
 */
export function createEffect<T>(fn: (v?: T) => T | undefined): void;
export function createEffect<T>(fn: (v: T) => T, value: T, options?: { name?: string }): void;
export function createEffect<T>(fn: (v?: T) => T, value?: T, options?: { name?: string }): void {
  runEffects = runUserEffects;
  const c = createComputation(fn, value, false, STALE, "_SOLID_DEV_" ? options : undefined),
    s = SuspenseContext && lookup(Owner, SuspenseContext.id);
  if (s) c.suspense = s;
  c.user = true;
  Effects && Effects.push(c);
}

/**
 * Creates a readonly derived reactive memoized signal
 * ```typescript
 * export function createMemo<T>(
 *   fn: (v: T) => T,
 *   value?: T,
 *   options?: { name?: string, equals?: false | ((prev: T, next: T) => boolean) }
 * ): T;
 * ```
 * @param fn a function that receives its previous or the initial value, if set, and returns a new value used to react on a computation
 * @param value an optional initial value for the computation; if set, fn will never receive undefined as first argument
 * @param options allows to set a name in dev mode for debugging purposes and use a custom comparison function in equals
 *
 * @description https://www.solidjs.com/docs/latest/api#creatememo
 */
export function createMemo<T>(
  fn: (v?: T) => T,
  value?: undefined,
  options?: { equals?: false | ((prev: T, next: T) => boolean); name?: string }
): Accessor<T>;
export function createMemo<T>(
  fn: (v: T) => T,
  value: T,
  options?: { equals?: false | ((prev: T, next: T) => boolean); name?: string }
): Accessor<T>;
export function createMemo<T>(
  fn: (v?: T) => T,
  value?: T,
  options?: { equals?: false | ((prev: T, next: T) => boolean); name?: string }
): Accessor<T> {
  options = options ? Object.assign({}, signalOptions, options) : signalOptions;
  const c: Partial<Memo<T>> = createComputation<T>(
    fn,
    value,
    true,
    0,
    "_SOLID_DEV_" ? options : undefined
  );
  c.pending = NOTPENDING;
  c.observers = null;
  c.observerSlots = null;
  c.comparator = options.equals || undefined;
  updateComputation(c as Memo<T>);
  return readSignal.bind(c as Memo<T>);
}

export interface Resource<T> extends Accessor<T> {
  loading: boolean;
  error: any;
}

export type ResourceActions<T> = { mutate: Setter<T>; refetch: () => void };

export type ResourceReturn<T> = [Resource<T>, ResourceActions<T>];

export type ResourceSource<S> = S | false | null | (() => S | false | null);

export type ResourceFetcher<S, T> = (k: S, getPrev: Accessor<T>) => T | Promise<T>;

export type ResourceOptions<T> = T extends undefined
  ? { initialValue?: T; name?: string }
  : { initialValue: T; name?: string };

/**
 * Creates a resource that wraps a repeated promise in a reactive pattern:
 * ```typescript
 * const [resource, { mutate, refetch }] = crateResource(source, fetcher, options);
 * ```
 * @param source - reactive data function to toggle the request, optional
 * @param fetcher - function that receives the source (or true) and an accessor for the last or initial value and returns a value or a Promise with the value:
 * ```typescript
 * const fetcher: ResourceFetcher<S, T, > = (
 *   sourceOutput: ReturnValue<typeof source>,
 *   getPrev: Accessor<T>
 * ) => T | Promise<T>;
 * ```
 * @param options - an optional object with the initialValue and the name (for debugging purposes)
 *
 * @returns ```typescript
 * [Resource<T>, { mutate: Setter<T>, refetch: () => void }]
 * ```
 *
 * * Setting an `initialValue` in the options will mean that both the prev() accessor and the resource should never return undefined (if that is wanted, you need to extend the type with undefined)
 * * `mutate` allows to manually overwrite the resource without calling the fetcher
 * * `refetch` will re-run the fetcher without changing the source
 *
 * @description https://www.solidjs.com/docs/latest/api#createresource
 */
export function createResource<T extends any, S = true>(
  fetcher: ResourceFetcher<S, T>,
  options?: ResourceOptions<undefined>
): [Resource<T | undefined>, ResourceActions<T | undefined>];
export function createResource<T, S = true>(
  fetcher: ResourceFetcher<S, T>,
  options: ResourceOptions<T>
): [Resource<T>, ResourceActions<T>];
export function createResource<T, S>(
  source: ResourceSource<S>,
  fetcher: ResourceFetcher<S, T>,
  options?: ResourceOptions<undefined>
): [Resource<T | undefined>, ResourceActions<T | undefined>];
export function createResource<T, S>(
  source: ResourceSource<S>,
  fetcher: ResourceFetcher<S, T>,
  options: ResourceOptions<T>
): [Resource<T>, ResourceActions<T>];
export function createResource<T, S>(
  source: ResourceSource<S> | ResourceFetcher<S, T>,
  fetcher?: ResourceFetcher<S, T> | ResourceOptions<T> | ResourceOptions<undefined>,
  options?: ResourceOptions<T> | ResourceOptions<undefined>
): [Resource<T>, ResourceActions<T>] | [Resource<T | undefined>, ResourceActions<T | undefined>] {
  if (arguments.length === 2) {
    if (typeof fetcher === "object") {
      options = fetcher as ResourceOptions<T> | ResourceOptions<T | undefined>;
      fetcher = source as ResourceFetcher<S, T>;
      source = true as ResourceSource<S>;
    }
  } else if (arguments.length === 1) {
    fetcher = source as ResourceFetcher<S, T>;
    source = true as ResourceSource<S>;
  }
  const contexts = new Set<SuspenseContextType>(),
    [s, set] = createSignal<T | undefined>((options || {}).initialValue),
    [track, trigger] = createSignal<void>(undefined, { equals: false }),
    [loading, setLoading] = createSignal<boolean>(false),
    [error, setError] = createSignal<any>();

  let err: any = undefined,
    pr: Promise<T> | null = null,
    initP: Promise<T> | null = null,
    id: string | null = null,
    loadedUnderTransition = false,
    dynamic = typeof source === "function";

  if (sharedConfig.context) {
    id = `${sharedConfig.context!.id}${sharedConfig.context!.count++}`;
    if (sharedConfig.context.loadResource) {
      initP = sharedConfig.context.loadResource!(id!);
    } else if (sharedConfig.resources && id && id in sharedConfig.resources) {
      initP = sharedConfig.resources![id];
      delete sharedConfig.resources![id];
    }
  }
  function loadEnd(p: Promise<T> | null, v: T | undefined, e?: any) {
    if (pr === p) {
      setError((err = e));
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
          completeLoad(v as T);
        }, false);
      } else completeLoad(v as T);
    }
    return v;
  }
  function completeLoad(v: T) {
    batch(() => {
      set(() => v);
      setLoading(false);
      for (const c of contexts.keys()) c.decrement!();
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
    setError((err = undefined));
    const lookup = dynamic ? (source as () => S)() : (source as S);
    loadedUnderTransition = (Transition && Transition.running) as boolean;
    if (lookup == null || (lookup as any) === false) {
      loadEnd(pr, untrack(s)!);
      return;
    }
    if (Transition && pr) Transition.promises.delete(pr);
    const p = initP || untrack(() => (fetcher as ResourceFetcher<S, T>)(lookup, s as Accessor<T>));
    initP = null;
    if (typeof p !== "object" || !("then" in p)) {
      loadEnd(pr, p as unknown as T | undefined);
      return;
    }
    pr = p as Promise<T>;
    batch(() => {
      setLoading(true);
      trigger();
    });
    p.then(
      v => loadEnd(p as Promise<T>, v),
      e => loadEnd(p as Promise<T>, e, e)
    );
  }
  Object.defineProperties(read, {
    loading: {
      get() {
        return loading();
      }
    },
    error: {
      get() {
        return error();
      }
    }
  });
  if (dynamic) createComputed(load);
  else load();
  return [read as Resource<T>, { refetch: load, mutate: set } as ResourceActions<T>];
}

/**
 * Creates a reactive computation that only runs and notifies the reactive context when the browser is idle
 * ```typescript
 * export function createDeferred<T>(
 *   fn: (v: T) => T,
 *   value?: T,
 *   options?: { timeoutMs?: number, name?: string, equals?: false | ((prev: T, next: T) => boolean) }
 * ): () => T);
 * ```
 * @param fn a function that receives its previous or the initial value, if set, and returns a new value used to react on a computation
 * @param value an optional initial value for the computation; if set, fn will never receive undefined as first argument
 * @param options allows to set the timeout in milliseconds, use a custom comparison function and set a name in dev mode for debugging purposes
 *
 * @description https://www.solidjs.com/docs/latest/api#createdeferred
 */
export function createDeferred<T>(
  source: Accessor<T>,
  options?: { equals?: false | ((prev: T, next: T) => boolean); name?: string; timeoutMs?: number }
) {
  let t: Task,
    timeout = options ? options.timeoutMs : undefined;
  const node = createComputation(
    () => {
      if (!t || !t.fn)
        t = requestCallback(
          () => setDeferred(() => node.value as T),
          timeout !== undefined ? { timeout } : undefined
        );
      return source();
    },
    undefined,
    true
  );
  const [deferred, setDeferred] = createSignal(node.value as T, options);
  updateComputation(node);
  setDeferred(() => node.value as T);
  return deferred;
}

/**
 * Creates a conditional signal that only notifies subscribers when entering or exiting their key matching the value
 * ```typescript
 * export function createSelector<T, U>(
 *   source: () => T
 *   fn: (a: U, b: T) => boolean,
 *   options?: { name?: string }
 * ): (k: U) => boolean;
 * ```
 * @param source
 * @param fn a function that receives its previous or the initial value, if set, and returns a new value used to react on a computation
 * @param options allows to set a name in dev mode for debugging purposes, optional
 *
 * ```typescript
 * const isSelected = createSelector(selectedId);
 * <For each={list()}>
 *   {(item) => <li classList={{ active: isSelected(item.id) }}>{item.name}</li>}
 * </For>
 * ```
 *
 * This makes the operation O(2) instead of O(n).
 *
 * @description https://www.solidjs.com/docs/latest/api#createselector
 */
export function createSelector<T, U>(
  source: Accessor<T>,
  fn: (a: U, b: T) => boolean = equalFn as any,
  options?: { name?: string }
): (key: U) => boolean {
  const subs = new Map<U, Set<Computation<any>>>();
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
    true,
    STALE,
    "_SOLID_DEV_" ? options : undefined
  ) as Memo<any>;
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
    return fn(
      key,
      Transition && Transition.running && Transition.sources.has(node) ? node.tValue : node.value!
    );
  };
}

/**
 * Holds changes inside the block before the reactive context is updated
 * @param fn wraps the reactive updates that should be batched
 * @returns the return value from `fn`
 *
 * @description https://www.solidjs.com/docs/latest/api#batch
 */
export function batch<T>(fn: () => T): T {
  if (Pending) return fn();
  let result;
  const q: Signal<any>[] = (Pending = []);
  try {
    result = fn();
  } finally {
    Pending = null;
  }

  runUpdates(() => {
    for (let i = 0; i < q.length; i += 1) {
      const data = q[i];
      if (data.pending !== NOTPENDING) {
        const pending = data.pending;
        data.pending = NOTPENDING;
        writeSignal(data, pending);
      }
    }
  }, false);

  return result;
}

/**
 * Ignores tracking context inside its scope
 * @param fn the scope that is out of the tracking context
 * @returns the return value of `fn`
 *
 * @description https://www.solidjs.com/docs/latest/api#untrack
 */
export function untrack<T>(fn: Accessor<T>): T {
  let result: T,
    listener = Listener;

  Listener = null;
  result = fn();
  Listener = listener;

  return result;
}

export type ReturnTypes<T> = T extends (() => any)[]
  ? { [I in keyof T]: ReturnTypes<T[I]> }
  : T extends () => any
  ? ReturnType<T>
  : never;

/**
 * on - make dependencies of a computation explicit
 * ```typescript
 * export function on<T extends Array<() => any> | (() => any), U>(
 *   deps: T | T[],
 *   fn: (input: T, prevInput: T, prevValue?: U) => U,
 *   options?: { defer?: boolean } = {}
 * ): (prevValue?: U) => U | undefined;
 * ```
 * @param deps list of reactive dependencies or a single reactive dependency
 * @param fn computation on input; the current previous content(s) of input and the previous value are given as arguments and it returns a new value
 * @param options optional, allows deferred computation until at the end of the next change
 * ```typescript
 * createEffect(on(a, (v) => console.log(v, b())));
 *
 * // is equivalent to:
 * createEffect(() => {
 *   const v = a();
 *   untrack(() => console.log(v, b()));
 * });
 * ```
 *
 * @description https://www.solidjs.com/docs/latest/api#on
 */
export function on<T extends (() => any)[], U>(
  deps: [...T],
  fn: (input: ReturnTypes<T>, prevInput: ReturnTypes<T>, prevValue?: U) => U,
  options?: { defer?: boolean }
): (prevValue?: U) => U;
export function on<T extends () => any, U>(
  deps: T,
  fn: (input: ReturnType<T>, prevInput: ReturnType<T>, prevValue?: U) => U,
  options?: { defer?: boolean }
): (prevValue?: U) => U;
export function on<T extends (() => any) | (() => any)[], U>(
  deps: T,
  fn: (input: ReturnTypes<T>, prevInput: ReturnTypes<T>, prevValue?: U) => U,
  options?: { defer?: boolean }
): (prevValue?: U) => U {
  const isArray = Array.isArray(deps);
  let prevInput: ReturnTypes<T>;
  let defer = options && options.defer;
  return prevValue => {
    let input: ReturnTypes<T>;
    if (isArray) {
      input = [] as any;
      for (let i = 0; i < deps.length; i++) input.push((deps as Array<() => T>)[i]());
    } else input = (deps as () => T)() as any;
    if (defer) {
      defer = false;
      // this aspect of first run on deferred is hidden from end user and should not affect types
      return undefined as unknown as U;
    }
    const result = untrack<U>(() => fn!(input, prevInput, prevValue));
    prevInput = input;
    return result;
  };
}

/**
 * onMount - run an effect only after initial render on mount
 * @param fn an effect that should run only once on mount
 *
 * @description https://www.solidjs.com/docs/latest/api#onmount
 */
export function onMount(fn: () => void) {
  createEffect(() => untrack(fn));
}

/**
 * onCleanup - run an effect once before the reactive scope is disposed
 * @param fn an effect that should run only once on cleanup
 *
 * @description https://www.solidjs.com/docs/latest/api#oncleanup
 */
export function onCleanup(fn: () => void) {
  if (Owner === null)
    "_SOLID_DEV_" &&
      console.warn("cleanups created outside a `createRoot` or `render` will never be run");
  else if (Owner.cleanups === null) Owner.cleanups = [fn];
  else Owner.cleanups.push(fn);
  return fn;
}

/**
 * onError - run an effect whenever an error is thrown within the context of the child scopes
 * @param fn an error handler that receives the error
 *
 * * If the error is thrown again inside the error handler, it will trigger the next available parent handler
 *
 * @description https://www.solidjs.com/docs/latest/api#onerror
 */
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

// Transitions
export function enableScheduling(scheduler = requestCallback) {
  Scheduler = scheduler;
}

export function startTransition(fn: () => void, cb?: () => void) {
  queueMicrotask(() => {
    if (Scheduler || SuspenseContext) {
      Transition ||
        (Transition = {
          sources: new Set(),
          effects: [],
          promises: new Set(),
          disposed: new Set(),
          queue: new Set(),
          running: true,
          cb: []
        });
      cb && Transition.cb.push(cb);
      Transition.running = true;
    }
    batch(fn);
    if (!Scheduler && !SuspenseContext && cb) cb();
  });
}

/**
 * ```typescript
 * export function useTransition(): [
 *   () => boolean,
 *   (fn: () => void, cb?: () => void) => void
 * ];
 * @returns a tuple; first value is an accessor if the transition is pending and a callback to start the transition
 *
 * @description https://www.solidjs.com/docs/latest/api#usetransition
 */
export function useTransition(): [Accessor<boolean>, (fn: () => void, cb?: () => void) => void] {
  return [transPending, startTransition];
}

export function resumeEffects(e: Computation<any>[]) {
  Effects!.push.apply(Effects, e);
  e.length = 0;
}

// Dev
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
  return c.tValue !== undefined ? c.tValue : c.value;
}

export function hashValue(v: any): string {
  const s = new Set();
  return `s${
    typeof v === "string"
      ? hash(v)
      : hash(
          JSON.stringify(v, (k, v) => {
            if (typeof v === "object" && v != null) {
              if (s.has(v)) return;
              s.add(v);
              const keys = Object.keys(v);
              const desc = Object.getOwnPropertyDescriptors(v);
              const newDesc = keys.reduce((memo, key) => {
                const value = desc[key];
                // skip getters
                if (!value.get) memo[key] = value;
                return memo;
              }, {} as any);
              v = Object.create({}, newDesc);
            }
            if (typeof v === "bigint") {
              return `${v.toString()}n`;
            }
            return v;
          }) || ""
        )
  }`;
}

export function registerGraph(name: string, value: { value: unknown }): string {
  let tryName = name;
  if (Owner) {
    let i = 0;
    Owner.sourceMap || (Owner.sourceMap = {});
    while (Owner.sourceMap[tryName]) tryName = `${name}-${++i}`;
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

/**
 * Creates a Context to handle a state scoped for the children of a component
 * ```typescript
 * interface Context<T> {
 *   id: symbol;
 *   Provider: (props: { value: T; children: any }) => any;
 *   defaultValue: T;
 * }
 * export function createContext<T>(defaultValue?: T): Context<T | undefined>;
 * ```
 * @param defaultValue optional default to inject into context
 * @returns The context that contains the Provider Component and that can be used with `useContext`
 *
 * @description https://www.solidjs.com/docs/latest/api#createcontext
 */
export function createContext<T>(): Context<T | undefined>;
export function createContext<T>(defaultValue: T): Context<T>;
export function createContext<T>(defaultValue?: T): Context<T | undefined> {
  const id = Symbol("context");
  return { id, Provider: createProvider(id), defaultValue };
}

/**
 * use a context to receive a scoped state from a parent's Context.Provider
 *
 * @param context Context object made by `createContext`
 * @returns the current or `defaultValue`, if present
 *
 * @description https://www.solidjs.com/docs/latest/api#usecontext
 */
export function useContext<T>(context: Context<T>): T {
  return lookup(Owner, context.id) || context.defaultValue;
}

/**
 * Resolves child elements to help interact with children
 *
 * @param fn an accessor for the children
 * @returns a accessor of the same children, but resolved
 *
 * @description https://www.solidjs.com/docs/latest/api#children
 */
export function children(fn: Accessor<JSX.Element>): Accessor<JSX.Element> {
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

// Internal
export function readSignal(this: Signal<any> | Memo<any>) {
  if ((this as Memo<any>).state && (this as Memo<any>).sources) {
    const updates = Updates;
    Updates = null;
    (this as Memo<any>).state === STALE ||
    (Transition && Transition.running && (this as Memo<any>).tState)
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

export function writeSignal(node: Signal<any> | Memo<any>, value: any, isComp?: boolean) {
  if (node.comparator) {
    if (Transition && Transition.running && Transition.sources.has(node)) {
      if (node.comparator(node.tValue, value)) return value;
    } else if (node.comparator(node.value, value)) return value;
  }
  if (Pending) {
    if (node.pending === NOTPENDING) Pending.push(node);
    node.pending = value;
    return value;
  }
  let TransitionRunning = false;
  if (Transition) {
    TransitionRunning = Transition.running;
    if (TransitionRunning || (!isComp && Transition.sources.has(node))) {
      Transition.sources.add(node);
      node.tValue = value;
    }
    if (!TransitionRunning) node.value = value;
  } else node.value = value;
  if (node.observers && node.observers.length) {
    runUpdates(() => {
      for (let i = 0; i < node.observers!.length; i += 1) {
        const o = node.observers![i];
        if (TransitionRunning && Transition!.disposed.has(o)) continue;
        if (o.pure) Updates!.push(o);
        else Effects!.push(o);
        if (
          (o as Memo<any>).observers &&
          ((TransitionRunning && !o.tState) || (!TransitionRunning && !o.state))
        )
          markUpstream(o as Memo<any>);
        if (TransitionRunning) o.tState = STALE;
        else o.state = STALE;
      }
      if (Updates!.length > 10e5) {
        Updates = [];
        if ("_SOLID_DEV_") throw new Error("Potential Infinite Loop Detected.");
        throw new Error();
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
    queueMicrotask(() => {
      runUpdates(() => {
        Transition && (Transition.running = true);
        runComputation(node, (node as Memo<any>).tValue, time);
      }, false);
    });
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
      writeSignal(node as Memo<any>, nextValue, true);
    } else if (Transition && Transition.running && node.pure) {
      Transition.sources.add(node as Memo<any>);
      (node as Memo<any>).tValue = nextValue;
    } else node.value = nextValue;
    node.updatedAt = time;
  }
}

function createComputation<T>(
  fn: (v?: T) => T,
  init: T | undefined,
  pure: boolean,
  state: number = STALE,
  options?: { name?: string }
) {
  const c: Computation<T> = {
    fn,
    state: state,
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
  if (Transition && Transition.running) {
    c.state = 0;
    c.tState = state;
  }
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
        (options && options.name) ||
        `${(Owner as Computation<any>).name || "c"}-${
          (Owner.owned || (Owner as Memo<T>).tOwned!).length
        }`;
  }
  return c;
}

function runTop(node: Computation<any>) {
  const runningTransition = Transition && Transition.running;
  if (!runningTransition && node.state !== STALE) return (node.state = 0);
  if (runningTransition && node.tState !== STALE) return (node.tState = 0);
  if (node.suspense && untrack(node.suspense.inFallback!))
    return node!.suspense.effects!.push(node!);
  const ancestors = [node];
  while (
    (node = node.owner as Computation<any>) &&
    (!node.updatedAt || node.updatedAt < ExecCount)
  ) {
    if (runningTransition && Transition!.disposed.has(node)) return;
    if (node.state || (runningTransition && node.tState)) ancestors.push(node);
  }
  for (let i = ancestors.length - 1; i >= 0; i--) {
    node = ancestors[i];
    if (runningTransition) {
      let top = node,
        prev = ancestors[i + 1];
      while ((top = top.owner as Computation<any>) && top !== prev) {
        if (Transition!.disposed.has(top)) return;
      }
    }
    if (node.state === STALE || (runningTransition && node.tState === STALE)) {
      updateComputation(node);
    } else if (node.state === PENDING || (runningTransition && node.tState === PENDING)) {
      const updates = Updates;
      Updates = null;
      lookDownstream(node);
      Updates = updates;
    }
  }
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
    if (Scheduler && Transition && Transition.running) scheduleQueue(Updates);
    else runQueue(Updates);
    Updates = null;
  }
  if (wait) return;
  let cbs;
  if (Transition && Transition.running) {
    if (Transition.promises.size || Transition.queue.size) {
      Transition.running = false;
      Transition.effects.push.apply(Transition.effects, Effects!);
      Effects = null;
      setTransPending(true);
      return;
    }
    // finish transition
    const sources = Transition.sources;
    cbs = Transition.cb;
    Effects!.forEach(e => {
      "tState" in e && (e.state = e.tState!);
      delete e.tState;
    });
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
        (v as Memo<any>).tState = 0;
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

function scheduleQueue(queue: Computation<any>[]) {
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    const tasks = Transition!.queue;
    if (!tasks.has(item)) {
      tasks.add(item);
      Scheduler!(() => {
        tasks.delete(item);
        runUpdates(() => {
          Transition!.running = true;
          runTop(item);
          if (!tasks.size) {
            Effects!.push.apply(Effects, Transition!.effects);
            Transition!.effects = [];
          }
        }, false);
        Transition && (Transition.running = false);
      });
    }
  }
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
      if (source.state === STALE || (Transition && Transition.running && source.tState))
        runTop(source);
      else if (source.state === PENDING) lookDownstream(source);
    }
  }
}

function markUpstream(node: Memo<any>) {
  const runningTransition = Transition && Transition.running;
  for (let i = 0; i < node.observers!.length; i += 1) {
    const o = node.observers![i];
    if (!o.state || (runningTransition && !o.tState)) {
      if (runningTransition) o.tState = PENDING;
      else o.state = PENDING;
      if (o.pure) Updates!.push(o);
      else Effects!.push(o);
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
  if (Transition && Transition.running) (node as Computation<any>).tState = 0;
  else (node as Computation<any>).state = 0;
  node.context = null;
}

function reset(node: Computation<any>, top?: boolean) {
  if (!top) {
    node.tState = 0;
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

function resolveChildren(children: JSX.Element): JSX.Element {
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
  return function provider(props: { value: unknown; children: JSX.Element }) {
    let res;
    createComputed(
      () =>
        (res = untrack(() => {
          Owner!.context = { [id]: props.value };
          return children(() => props.children);
        }))
    );
    return res as JSX.Element;
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
