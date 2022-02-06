// Inspired by S.js by Adam Haile, https://github.com/adamhaile/S

import { requestCallback, Task } from "./scheduler";
import { sharedConfig } from "../render/hydration";
import type { JSX } from "../jsx";

export const equalFn = <T>(a: T, b: T) => a === b;
export const $PROXY = Symbol("solid-proxy");
export const $DEVCOMP = Symbol("solid-dev-component");
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
export let Transition: TransitionState | null = null;
let Scheduler: ((fn: () => void) => any) | null = null;
let ExternalSourceFactory: ExternalSourceFactory | null = null;
let Listener: Computation<any> | null = null;
let Pending: SignalState<any>[] | null = null;
let Updates: Computation<any>[] | null = null;
let Effects: Computation<any>[] | null = null;
let ExecCount = 0;
let rootCount = 0;

declare global {
  var _$afterUpdate: () => void;
}

export interface SignalState<T> {
  value?: T;
  observers: Computation<any>[] | null;
  observerSlots: number[] | null;
  pending: T | {};
  tValue?: T;
  comparator?: (prev: T, next: T) => boolean;
  name?: string;
}

export interface Owner {
  owned: Computation<any>[] | null;
  cleanups: (() => void)[] | null;
  owner: Owner | null;
  context: any | null;
  sourceMap?: Record<string, { value: unknown }>;
  name?: string;
  componentName?: string;
}

export interface Computation<Init, Next extends Init = Init> extends Owner {
  fn: EffectFunction<Init, Next>;
  state: number;
  tState?: number;
  sources: SignalState<Next>[] | null;
  sourceSlots: number[] | null;
  value?: Init;
  updatedAt: number | null;
  pure: boolean;
  user?: boolean;
  suspense?: SuspenseContextType;
}

export interface TransitionState {
  sources: Set<SignalState<any>>;
  effects: Computation<any>[];
  promises: Set<Promise<any>>;
  disposed: Set<Computation<any>>;
  queue: Set<Computation<any>>;
  scheduler?: (fn: () => void) => unknown;
  running: boolean;
  done?: Promise<void>;
  resolve?: () => void;
}

type ExternalSourceFactory = <Prev, Next extends Prev = Prev>(
  fn: EffectFunction<Prev, Next>,
  trigger: () => void
) => ExternalSource;

export interface ExternalSource {
  track: EffectFunction<any, any>;
  dispose: () => void;
}

export type RootFunction<T> = (dispose: () => void) => T;

/**
 * Creates a new non-tracked reactive context that doesn't auto-dispose
 *
 * @param fn a function in which the reactive state is scoped
 * @param detachedOwner optional reactive context to bind the root to
 * @returns the output of `fn`.
 *
 * @description https://www.solidjs.com/docs/latest/api#createroot
 */
export function createRoot<T>(fn: RootFunction<T>, detachedOwner?: Owner): T {
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

  try {
    return runUpdates(() => fn(() => cleanNode(root)), true)!;
  } finally {
    Listener = listener;
    Owner = owner;
  }
}

export type Accessor<T> = () => T;

export type Setter<T> = undefined extends T
  ? <U extends T>(value?: (U extends Function ? never : U) | ((prev?: T) => U)) => U
  : <U extends T>(value: (U extends Function ? never : U) | ((prev: T) => U)) => U;

export type Signal<T> = [get: Accessor<T>, set: Setter<T>];

export interface SignalOptions<T> extends MemoOptions<T> {
  internal?: boolean;
}

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
export function createSignal<T>(): Signal<T | undefined>;
export function createSignal<T>(value: T, options?: SignalOptions<T>): Signal<T>;
export function createSignal<T>(value?: T, options?: SignalOptions<T>): Signal<T | undefined> {
  options = options ? Object.assign({}, signalOptions, options) : signalOptions;

  const s: SignalState<T> = {
    value,
    observers: null,
    observerSlots: null,
    pending: NOTPENDING,
    comparator: options.equals || undefined
  };

  if ("_SOLID_DEV_" && !options.internal)
    s.name = registerGraph(options.name || hashValue(value), s as { value: unknown });

  const setter: Setter<T | undefined> = (value: unknown) => {
    if (typeof value === "function") {
      if (Transition && Transition.running && Transition.sources.has(s))
        value = value(s.pending !== NOTPENDING ? s.pending : s.tValue);
      else value = value(s.pending !== NOTPENDING ? s.pending : s.value);
    }
    return writeSignal(s, value);
  };

  return [readSignal.bind(s), setter];
}

export interface BaseOptions {
  name?: string;
}

// Magic type that when used at sites where generic types are inferred from, will prevent those sites from being involved in the inference.
// https://github.com/microsoft/TypeScript/issues/14829
// TypeScript Discord conversation: https://discord.com/channels/508357248330760243/508357248330760249/911266491024949328
export type NoInfer<T extends any> = [T][T extends any ? 0 : never];

export interface EffectOptions extends BaseOptions {}

// Also similar to OnEffectFunction
export type EffectFunction<Prev, Next extends Prev = Prev> = (v: Prev) => Next;

/**
 * Creates a reactive computation that runs immediately before render, mainly used to write to other reactive primitives
 * ```typescript
 * export function createComputed<Next, Init = Next>(
 *   fn: (v: Init | Next) => Next,
 *   value?: Init,
 *   options?: { name?: string }
 * ): void;
 * ```
 * @param fn a function that receives its previous or the initial value, if set, and returns a new value used to react on a computation
 * @param value an optional initial value for the computation; if set, fn will never receive undefined as first argument
 * @param options allows to set a name in dev mode for debugging purposes
 *
 * @description https://www.solidjs.com/docs/latest/api#createcomputed
 */
export function createComputed<Next, Init = Next>(
  fn: EffectFunction<Init | Next, Next>,
  value: Init,
  options?: EffectOptions
): void;
export function createComputed<Next, Init = undefined>(
  ..._: undefined extends Init
    ? [fn: EffectFunction<Init | Next, Next>, value?: Init, options?: EffectOptions]
    : [fn: EffectFunction<Init | Next, Next>, value: Init, options?: EffectOptions]
): void;
export function createComputed<Next, Init>(
  fn: EffectFunction<Init | Next, Next>,
  value: Init,
  options?: EffectOptions
): void {
  const c = createComputation(fn, value, true, STALE, "_SOLID_DEV_" ? options : undefined);
  if (Scheduler && Transition && Transition.running) Updates!.push(c);
  else updateComputation(c);
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
export function createRenderEffect<Next, Init = Next>(
  fn: EffectFunction<Init | Next, Next>,
  value: Init,
  options?: EffectOptions
): void;
export function createRenderEffect<Next, Init = undefined>(
  ..._: undefined extends Init
    ? [fn: EffectFunction<Init | Next, Next>, value?: Init, options?: EffectOptions]
    : [fn: EffectFunction<Init | Next, Next>, value: Init, options?: EffectOptions]
): void;
export function createRenderEffect<Next, Init>(
  fn: EffectFunction<Init | Next, Next>,
  value: Init,
  options?: EffectOptions
): void {
  const c = createComputation(fn, value, false, STALE, "_SOLID_DEV_" ? options : undefined);
  if (Scheduler && Transition && Transition.running) Updates!.push(c);
  else updateComputation(c);
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
export function createEffect<Next, Init = Next>(
  fn: EffectFunction<Init | Next, Next>,
  value: Init,
  options?: EffectOptions
): void;
export function createEffect<Next, Init = undefined>(
  ..._: undefined extends Init
    ? [fn: EffectFunction<Init | Next, Next>, value?: Init, options?: EffectOptions]
    : [fn: EffectFunction<Init | Next, Next>, value: Init, options?: EffectOptions]
): void;
export function createEffect<Next, Init = Next>(
  fn: EffectFunction<Init | Next, Next>,
  value: Init,
  options?: EffectOptions
): void {
  runEffects = runUserEffects;
  const c = createComputation(fn, value, false, STALE, "_SOLID_DEV_" ? options : undefined),
    s = SuspenseContext && lookup(Owner, SuspenseContext.id);
  if (s) c.suspense = s;
  c.user = true;
  Effects ? Effects.push(c) : queueMicrotask(() => updateComputation(c));
}

/**
 * Creates a reactive computation that runs after the render phase with flexible tracking
 * ```typescript
 * export function createReaction(
 *   onInvalidate: () => void,
 *   options?: { name?: string }
 * ): (fn: () => void) => void;
 * ```
 * @param invalidated a function that is called when tracked function is invalidated.
 * @param options allows to set a name in dev mode for debugging purposes
 *
 * @description https://www.solidjs.com/docs/latest/api#createreaction
 */
export function createReaction(onInvalidate: () => void, options?: EffectOptions) {
  let fn: (() => void) | undefined;
  const c = createComputation(
      () => {
        fn ? fn() : untrack(onInvalidate);
        fn = undefined;
      },
      undefined,
      false,
      0,
      "_SOLID_DEV_" ? options : undefined
    ),
    s = SuspenseContext && lookup(Owner, SuspenseContext.id);
  if (s) c.suspense = s;
  c.user = true;
  return (tracking: () => void) => {
    fn = tracking;
    updateComputation(c);
  };
}

interface Memo<Prev, Next = Prev> extends SignalState<Next>, Computation<Next> {
  tOwned?: Computation<Prev | Next, Next>[];
}

export interface MemoOptions<T> extends EffectOptions {
  equals?: false | ((prev: T, next: T) => boolean);
}

/**
 * Creates a readonly derived reactive memoized signal
 * ```typescript
 * export function createMemo<T>(
 *   fn: (v: T) => T,
 *   value?: T,
 *   options?: { name?: string, equals?: false | ((prev: T, next: T) => boolean) }
 * ): () => T;
 * ```
 * @param fn a function that receives its previous or the initial value, if set, and returns a new value used to react on a computation
 * @param value an optional initial value for the computation; if set, fn will never receive undefined as first argument
 * @param options allows to set a name in dev mode for debugging purposes and use a custom comparison function in equals
 *
 * @description https://www.solidjs.com/docs/latest/api#creatememo
 */
// The extra _Next generic parameter separates inference of the effect input
// parameter type from inference of the effect return type, so that the effect
// return type is always used as the memo Accessor's return type.
export function createMemo<Next extends _Next, Init = Next, _Next = Next>(
  fn: EffectFunction<Init | _Next, Next>,
  value: Init,
  options?: MemoOptions<Next>
): Accessor<Next>;
export function createMemo<Next extends _Next, Init = undefined, _Next = Next>(
  ..._: undefined extends Init
    ? [fn: EffectFunction<Init | _Next, Next>, value?: Init, options?: MemoOptions<Next>]
    : [fn: EffectFunction<Init | _Next, Next>, value: Init, options?: MemoOptions<Next>]
): Accessor<Next>;
export function createMemo<Next extends _Next, Init, _Next>(
  fn: EffectFunction<Init | _Next, Next>,
  value: Init,
  options?: MemoOptions<Next>
): Accessor<Next> {
  options = options ? Object.assign({}, signalOptions, options) : signalOptions;

  const c: Partial<Memo<Init, Next>> = createComputation(
    fn,
    value,
    true,
    0,
    "_SOLID_DEV_" ? options : undefined
  ) as Partial<Memo<Init, Next>>;

  c.pending = NOTPENDING;
  c.observers = null;
  c.observerSlots = null;
  c.comparator = options.equals || undefined;
  if (Scheduler && Transition && Transition.running) {
    c.tState = STALE;
    Updates!.push(c as Memo<Init, Next>);
  } else updateComputation(c as Memo<Init, Next>);
  return readSignal.bind(c as Memo<Init, Next>);
}

export interface Resource<T> extends Accessor<T> {
  loading: boolean;
  error: any;
}

export type ResourceActions<T> = { mutate: Setter<T>; refetch: (info?: unknown) => void };

export type ResourceReturn<T> = [Resource<T>, ResourceActions<T>];

export type ResourceSource<S> = S | false | null | undefined | (() => S | false | null | undefined);

export type ResourceFetcher<S, T> = (k: S, info: ResourceFetcherInfo<T>) => T | Promise<T>;

export type ResourceFetcherInfo<T> = { value: T | undefined; refetching?: unknown };

export type ResourceOptions<T> = undefined extends T
  ? {
      initialValue?: T;
      name?: string;
      globalRefetch?: boolean;
      onHydrated?: <S, T>(k: S, info: ResourceFetcherInfo<T>) => void;
    }
  : {
      initialValue: T;
      name?: string;
      globalRefetch?: boolean;
      onHydrated?: <S, T>(k: S, info: ResourceFetcherInfo<T>) => void;
    };

/**
 * Creates a resource that wraps a repeated promise in a reactive pattern:
 * ```typescript
 * const [resource, { mutate, refetch }] = createResource(source, fetcher, options);
 * ```
 * @param source - reactive data function to toggle the request, optional
 * @param fetcher - function that receives the source (or true) and an accessor for the last or initial value and returns a value or a Promise with the value:
 * ```typescript
 * const fetcher: ResourceFetcher<S, T, > = (
 *   sourceOutput: ReturnValue<typeof source>,
 *   info: ResourceFetcherInfo<T>
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
export function createResource<T, S = true>(
  fetcher: ResourceFetcher<S, T>,
  options?: ResourceOptions<undefined>
): ResourceReturn<T | undefined>;
export function createResource<T, S = true>(
  fetcher: ResourceFetcher<S, T>,
  options: ResourceOptions<T>
): ResourceReturn<T>;
export function createResource<T, S>(
  source: ResourceSource<S>,
  fetcher: ResourceFetcher<S, T>,
  options?: ResourceOptions<undefined>
): ResourceReturn<T | undefined>;
export function createResource<T, S>(
  source: ResourceSource<S>,
  fetcher: ResourceFetcher<S, T>,
  options: ResourceOptions<T>
): ResourceReturn<T>;
export function createResource<T, S>(
  source: ResourceSource<S> | ResourceFetcher<S, T>,
  fetcher?: ResourceFetcher<S, T> | ResourceOptions<T> | ResourceOptions<undefined>,
  options?: ResourceOptions<T> | ResourceOptions<undefined>
): ResourceReturn<T> | ResourceReturn<T | undefined> {
  if (arguments.length === 2) {
    if (typeof fetcher === "object") {
      options = fetcher as ResourceOptions<T> | ResourceOptions<undefined>;
      fetcher = source as ResourceFetcher<S, T>;
      source = true as ResourceSource<S>;
    }
  } else if (arguments.length === 1) {
    fetcher = source as ResourceFetcher<S, T>;
    source = true as ResourceSource<S>;
  }
  options || (options = {});
  if (options.globalRefetch !== false) {
    Resources || (Resources = new Set());
    Resources.add(load);
    Owner && onCleanup(() => Resources.delete(load));
  }

  const contexts = new Set<SuspenseContextType>(),
    [s, set] = createSignal<T | undefined>(options.initialValue),
    [track, trigger] = createSignal<void>(undefined, { equals: false }),
    [loading, setLoading] = createSignal<boolean>(false),
    [error, setError] = createSignal<any>();

  let err: any = undefined,
    pr: Promise<T> | null = null,
    initP: Promise<T> | null | undefined = null,
    id: string | null = null,
    loadedUnderTransition = false,
    scheduled = false,
    dynamic = typeof source === "function";

  if (sharedConfig.context) {
    id = `${sharedConfig.context!.id}${sharedConfig.context!.count++}`;
    if (sharedConfig.load) initP = sharedConfig.load!(id!);
  }
  function loadEnd(p: Promise<T> | null, v: T | undefined, e?: any, key?: S) {
    if (pr === p) {
      pr = null;
      if (initP && p === initP && options!.onHydrated)
        options!.onHydrated(key!, { value: v } as ResourceFetcherInfo<T>);
      initP = null;
      setError((err = e));
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
  function load(refetching: unknown = true) {
    if (refetching && scheduled) return;
    scheduled = false;
    setError((err = undefined));
    const lookup = dynamic ? (source as () => S)() : (source as S);
    loadedUnderTransition = (Transition && Transition.running) as boolean;
    if (lookup == null || (lookup as any) === false) {
      loadEnd(pr, untrack(s)!);
      return;
    }
    if (Transition && pr) Transition.promises.delete(pr);
    const p =
      initP ||
      untrack(() =>
        (fetcher as ResourceFetcher<S, T>)(lookup, {
          value: s(),
          refetching
        })
      );
    if (typeof p !== "object" || !("then" in p)) {
      loadEnd(pr, p as unknown as T | undefined);
      return p;
    }
    pr = p as Promise<T>;
    scheduled = true;
    queueMicrotask(() => (scheduled = false));
    batch(() => {
      setLoading(true);
      trigger();
    });
    return p.then(
      v => loadEnd(p as Promise<T>, v, undefined, lookup),
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
  if (dynamic) createComputed(() => load(false));
  else load(false);
  return [read as Resource<T>, { refetch: load, mutate: set } as ResourceActions<T>];
}

let Resources: Set<(info: unknown) => any>;
export function refetchResources(info?: unknown) {
  return Resources && Promise.all([...Resources].map(fn => fn(info)));
}

export interface DeferredOptions<T> {
  equals?: false | ((prev: T, next: T) => boolean);
  name?: string;
  timeoutMs?: number;
}

/**
 * Creates a reactive computation that only runs and notifies the reactive context when the browser is idle
 * ```typescript
 * export function createDeferred<T>(
 *   fn: (v: T) => T,
 *   options?: { timeoutMs?: number, name?: string, equals?: false | ((prev: T, next: T) => boolean) }
 * ): () => T);
 * ```
 * @param fn a function that receives its previous or the initial value, if set, and returns a new value used to react on a computation
 * @param options allows to set the timeout in milliseconds, use a custom comparison function and set a name in dev mode for debugging purposes
 *
 * @description https://www.solidjs.com/docs/latest/api#createdeferred
 */
export function createDeferred<T>(source: Accessor<T>, options?: DeferredOptions<T>) {
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

export type EqualityCheckerFunction<T, U> = (a: U, b: T) => boolean;

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
  fn: EqualityCheckerFunction<T, U> = equalFn as TODO,
  options?: BaseOptions
): (key: U) => boolean {
  const subs = new Map<U, Set<Computation<any>>>();
  const node = createComputation(
    (p: T | undefined) => {
      const v = source();
      for (const key of subs.keys())
        if (fn(key, v) !== (p !== undefined && fn(key, p))) {
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
export function batch<T>(fn: Accessor<T>): T {
  if (Pending) return fn();
  let result;
  const q: SignalState<any>[] = (Pending = []);
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

// Also similar to EffectFunction
export type OnEffectFunction<S, Prev, Next extends Prev = Prev> = (
  input: ReturnTypes<S>,
  prevInput: ReturnTypes<S>,
  v: Prev
) => Next;

export interface OnOptions {
  defer?: boolean;
}

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
 * @returns an effect function that is passed into createEffect. For example:
 *
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
export function on<S extends Accessor<unknown> | Accessor<unknown>[] | [], Next, Init = unknown>(
  deps: S,
  fn: OnEffectFunction<S, Init | Next, Next>,
  // value: Init,
  options?: OnOptions
): EffectFunction<NoInfer<Init> | NoInfer<Next>, NoInfer<Next>>;
export function on<S extends Accessor<unknown> | Accessor<unknown>[] | [], Next, Init = unknown>(
  deps: S,
  fn: OnEffectFunction<S, Init | Next, Next>,
  // value: Init,
  options?: OnOptions
): EffectFunction<NoInfer<Init> | NoInfer<Next>, NoInfer<Next>> {
  const isArray = Array.isArray(deps);
  let prevInput: ReturnTypes<S>;
  let defer = options && options.defer;
  return (prevValue: Init | Next) => {
    let input: ReturnTypes<S>;
    if (isArray) {
      input = [] as TODO;
      for (let i = 0; i < deps.length; i++) (input as TODO[]).push((deps as Array<() => S>)[i]());
    } else input = (deps as () => S)() as TODO;
    if (defer) {
      defer = false;
      // this aspect of first run on deferred is hidden from end user and should not affect types
      return undefined as unknown as Next;
    }
    const result = untrack<Next>(() => fn(input, prevInput, prevValue));
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

export function runWithOwner<T>(o: Owner, fn: () => T): T {
  const prev = Owner;
  Owner = o;
  try {
    return runUpdates(fn, true)!;
  } finally {
    Owner = prev;
  }
}

// Transitions
export function enableScheduling(scheduler = requestCallback) {
  Scheduler = scheduler;
}

/**
 * ```typescript
 * export function startTransition(fn: () => void) => Promise<void>
 *
 * @description https://www.solidjs.com/docs/latest/api#usetransition
 */
export function startTransition(fn: () => unknown): Promise<void> {
  if (Transition && Transition.running) {
    fn();
    return Transition.done!;
  }
  const l = Listener;
  const o = Owner;
  return Promise.resolve().then(() => {
    Listener = l;
    Owner = o;
    let t: TransitionState | undefined;
    if (Scheduler || SuspenseContext) {
      t =
        Transition ||
        (Transition = {
          sources: new Set(),
          effects: [],
          promises: new Set(),
          disposed: new Set(),
          queue: new Set(),
          running: true
        });
      t.done || (t.done = new Promise(res => (t!.resolve = res)));
      t.running = true;
    }
    batch(fn);
    return t ? t.done : undefined;
  });
}

export type Transition = [Accessor<boolean>, (fn: () => void) => Promise<void>];

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
export function useTransition(): Transition {
  return [transPending, startTransition];
}

export function resumeEffects(e: Computation<any>[]) {
  Effects!.push.apply(Effects, e);
  e.length = 0;
}

// Dev
export function devComponent<T>(Comp: (props: T) => JSX.Element, props: T) {
  const c: Partial<Memo<JSX.Element, JSX.Element>> = createComputation<JSX.Element, JSX.Element>(
    () =>
      untrack(() => {
        Object.assign(Comp, { [$DEVCOMP]: true });
        return Comp(props);
      }),
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

export type ContextProviderComponent<T> = (props: { value: T; children: any }) => any;

// Context API
export interface Context<T> {
  id: symbol;
  Provider: ContextProviderComponent<T>;
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
export type SuspenseContextType = {
  increment?: () => void;
  decrement?: () => void;
  inFallback?: () => boolean;
  effects?: Computation<any>[];
  resolved?: boolean;
};

type SuspenseContext = Context<SuspenseContextType> & {
  active?(): boolean;
  increment?(): void;
  decrement?(): void;
};

let SuspenseContext: SuspenseContext;

export function getSuspenseContext() {
  return SuspenseContext || (SuspenseContext = createContext<SuspenseContextType>({}));
}

// Interop
export function enableExternalSource(factory: ExternalSourceFactory) {
  if (ExternalSourceFactory) {
    const oldFactory = ExternalSourceFactory;
    ExternalSourceFactory = (fn, trigger) => {
      const oldSource = oldFactory(fn, trigger);
      const source = factory(x => oldSource.track(x), trigger);
      return {
        track: x => source.track(x),
        dispose() {
          source.dispose();
          oldSource.dispose();
        }
      };
    };
  } else {
    ExternalSourceFactory = factory;
  }
}

// Internal
export function readSignal(this: SignalState<any> | Memo<any>) {
  const runningTransition = Transition && Transition.running;
  if (
    (this as Memo<any>).sources &&
    ((!runningTransition && (this as Memo<any>).state) ||
      (runningTransition && (this as Memo<any>).tState))
  ) {
    const updates = Updates;
    Updates = null;
    (!runningTransition && (this as Memo<any>).state === STALE) ||
    (runningTransition && (this as Memo<any>).tState === STALE)
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
  if (runningTransition && Transition!.sources.has(this)) return this.tValue;
  return this.value;
}

export function writeSignal(node: SignalState<any> | Memo<any>, value: any, isComp?: boolean) {
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
  runComputation(
    node,
    Transition && Transition.running && Transition.sources.has(node as Memo<any>)
      ? (node as Memo<any>).tValue
      : node.value,
    time
  );

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

function createComputation<Next, Init = unknown>(
  fn: EffectFunction<Init | Next, Next>,
  init: Init,
  pure: boolean,
  state: number = STALE,
  options?: EffectOptions
): Computation<Init | Next, Next> {
  const c: Computation<Init | Next, Next> = {
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
    if (Transition && Transition.running && (Owner as Memo<Init, Next>).pure) {
      if (!(Owner as Memo<Init, Next>).tOwned) (Owner as Memo<Init, Next>).tOwned = [c];
      else (Owner as Memo<Init, Next>).tOwned!.push(c);
    } else {
      if (!Owner.owned) Owner.owned = [c];
      else Owner.owned.push(c);
    }
    if ("_SOLID_DEV_")
      c.name =
        (options && options.name) ||
        `${(Owner as Computation<any>).name || "c"}-${
          (Owner.owned || (Owner as Memo<Init, Next>).tOwned!).length
        }`;
  }

  if (ExternalSourceFactory) {
    const [track, trigger] = createSignal<void>(undefined, { equals: false });
    const ordinary = ExternalSourceFactory(c.fn, trigger);
    onCleanup(() => ordinary.dispose());
    const triggerInTransition: () => void = () =>
      startTransition(trigger).then(() => inTransition.dispose());
    const inTransition = ExternalSourceFactory(c.fn, triggerInTransition);
    c.fn = x => {
      track();
      return Transition && Transition.running ? inTransition.track(x) : ordinary.track(x);
    };
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
    if ((!runningTransition && node.state) || (runningTransition && node.tState))
      ancestors.push(node);
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
    if (
      (!runningTransition && node.state === STALE) ||
      (runningTransition && node.tState === STALE)
    ) {
      updateComputation(node);
    } else if (
      (!runningTransition && node.state === PENDING) ||
      (runningTransition && node.tState === PENDING)
    ) {
      const updates = Updates;
      Updates = null;
      lookDownstream(node, ancestors[0]);
      Updates = updates;
    }
  }
}

function runUpdates<T>(fn: () => T, init: boolean) {
  if (Updates) return fn();
  let wait = false;
  if (!init) Updates = [];
  if (Effects) wait = true;
  else Effects = [];
  ExecCount++;
  try {
    return fn();
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
  let res;
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
    res = Transition.resolve;
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
  if (res) res();
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

function lookDownstream(node: Computation<any>, ignore?: Computation<any>) {
  node.state = 0;
  const runningTransition = Transition && Transition.running;
  for (let i = 0; i < node.sources!.length; i += 1) {
    const source = node.sources![i] as Memo<any>;
    if (source.sources) {
      if (
        (!runningTransition && source.state === STALE) ||
        (runningTransition && source.tState === STALE)
      ) {
        if (source !== ignore) runTop(source);
      } else if (
        (!runningTransition && source.state === PENDING) ||
        (runningTransition && source.tState === PENDING)
      )
        lookDownstream(source, ignore);
    }
  }
}

function markUpstream(node: Memo<any>) {
  const runningTransition = Transition && Transition.running;
  for (let i = 0; i < node.observers!.length; i += 1) {
    const o = node.observers![i];
    if ((!runningTransition && !o.state) || (runningTransition && !o.tState)) {
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
    owner &&
    (owner.context && owner.context[key] !== undefined
      ? owner.context[key]
      : owner.owner && lookup(owner.owner, key))
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

type TODO = any;
