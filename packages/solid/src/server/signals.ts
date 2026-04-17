// Mock @solidjs/signals for server-side rendering
// Re-exports infrastructure from the real package, reimplements reactive primitives as pull-based.

// === Re-exports from @solidjs/signals (infrastructure — no reactive scheduling) ===

export {
  createRoot,
  createOwner,
  runWithOwner,
  getOwner,
  isDisposed,
  onCleanup,
  getNextChildId,
  createContext,
  setContext,
  getContext,
  NotReadyError,
  NoOwnerError,
  ContextNotFoundError,
  isEqual,
  isWrappable,
  SUPPORTS_PROXY,
  enableExternalSource,
  enforceLoadingBoundary
} from "@solidjs/signals";

export { flatten } from "@solidjs/signals";
export { snapshot, merge, omit, storePath, $PROXY, $REFRESH, $TRACK } from "@solidjs/signals";

// === Type re-exports ===

export type {
  Accessor,
  ComputeFunction,
  EffectFunction,
  EffectBundle,
  EffectOptions,
  ExternalSource,
  ExternalSourceConfig,
  ExternalSourceFactory,
  MemoOptions,
  NoInfer,
  SignalOptions,
  Setter,
  Signal,
  Owner,
  Maybe,
  Store,
  StoreSetter,
  StoreNode,
  NotWrappable,
  SolidStore,
  Merge,
  Omit,
  Context,
  ContextRecord,
  IQueue,
  StorePathRange,
  ArrayFilterFn,
  CustomPartial,
  Part,
  PathSetter
} from "@solidjs/signals";

// === Local imports ===

import {
  createOwner,
  getOwner,
  getNextChildId,
  setContext,
  getContext,
  isWrappable,
  NotReadyError,
  runWithOwner,
  onCleanup
} from "@solidjs/signals";

import type {
  Accessor,
  ComputeFunction,
  EffectFunction,
  EffectBundle,
  EffectOptions,
  MemoOptions,
  SignalOptions,
  Setter,
  Signal,
  Owner,
  Store,
  StoreSetter,
  Context
} from "@solidjs/signals";

import { sharedConfig, NoHydrateContext } from "./shared.js";

// === Observer tracking (for async memo) ===

interface ServerComputation<T = any> {
  owner: Owner;
  value: T;
  compute: ComputeFunction<any, T>;
  error: unknown;
  computed: boolean;
  disposed: boolean;
}

type SsrSourceMode = "server" | "hybrid" | "client";
type ServerSsrOptions = { deferStream?: boolean; ssrSource?: SsrSourceMode };
type ServerClientMemoOptions<T> = Omit<MemoOptions<T>, "ssrSource"> & { ssrSource: "client" };
type ServerMemoOptions<T> = Omit<MemoOptions<T>, "ssrSource"> & { ssrSource?: "server" | "hybrid" };
type ServerClientSignalOptions<T> = Omit<SignalOptions<T>, "ssrSource"> & { ssrSource: "client" };
type ServerSignalOptions<T> = Omit<SignalOptions<T>, "ssrSource"> & {
  ssrSource?: "server" | "hybrid";
};

let Observer: ServerComputation | null = null;

function runWithObserver<T>(comp: ServerComputation, fn: () => T): T {
  const prev = Observer;
  Observer = comp;
  try {
    return fn();
  } finally {
    Observer = prev;
  }
}

export function getObserver() {
  return Observer;
}

type DeferredPromise<T> = {
  promise: Promise<T> & { s?: 1 | 2; v?: any };
  resolve: (value: T) => void;
  reject: (error: any) => void;
};

function createDeferredPromise<T>(): DeferredPromise<T> {
  let settled = false;
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: any) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  }) as DeferredPromise<T>["promise"];

  return {
    promise,
    resolve(value: T) {
      if (settled) return;
      settled = true;
      promise.s = 1;
      promise.v = value;
      resolvePromise(value);
    },
    reject(error: any) {
      if (settled) return;
      settled = true;
      promise.s = 2;
      promise.v = error;
      rejectPromise(error);
    }
  };
}

function subscribePendingRetry(error: any, retry: () => void): boolean {
  if (!(error instanceof NotReadyError)) return false;
  (error as any).source?.then(
    () => retry(),
    () => retry()
  );
  return true;
}

function settleServerAsync<T, U>(
  initial: T | PromiseLike<T>,
  rerun: () => T | PromiseLike<T>,
  deferred: DeferredPromise<U>,
  onSuccess: (value: T) => U,
  onError: (error: any) => void,
  isDisposed: () => boolean
) {
  let first = true;

  const attempt = () => {
    if (isDisposed()) return;

    let current: T | PromiseLike<T>;
    try {
      current = first ? initial : rerun();
      first = false;
    } catch (error) {
      if (subscribePendingRetry(error, attempt)) return;
      onError(error);
      deferred.reject(error);
      return;
    }

    Promise.resolve(current).then(
      value => {
        if (isDisposed()) return;
        deferred.resolve(onSuccess(value));
      },
      error => {
        if (isDisposed()) return;
        if (subscribePendingRetry(error, attempt)) return;
        onError(error);
        deferred.reject(error);
      }
    );
  };

  attempt();
}

// === Reactive Primitives (pull-based) ===

export function createSignal<T>(): Signal<T | undefined>;
export function createSignal<T>(value: Exclude<T, Function>, options?: SignalOptions<T>): Signal<T>;
export function createSignal<T>(
  fn: ComputeFunction<undefined | NoInfer<T>, T>,
  options: ServerClientSignalOptions<T>
): Signal<T | undefined>;
export function createSignal<T>(
  fn: ComputeFunction<undefined | NoInfer<T>, T>,
  options?: ServerSignalOptions<T>
): Signal<T>;
export function createSignal<T>(
  first?: T | ComputeFunction<any, any>,
  second?: SignalOptions<any>
): Signal<T | undefined> {
  if (typeof first === "function") {
    const opts =
      second?.deferStream || second?.ssrSource
        ? { deferStream: second?.deferStream, ssrSource: second?.ssrSource }
        : undefined;
    const memo = createMemo<T>((prev?: T) => (first as (prev?: T) => T)(prev), opts as any);
    return [memo, (() => undefined) as Setter<T | undefined>];
  }
  // Plain value form — no ID allocation (IDs are only for owners/computations)
  return [
    () => first as T,
    v => {
      return ((first as any) = typeof v === "function" ? (v as (prev: T) => T)(first as T) : v);
    }
  ] as Signal<T | undefined>;
}

export function createMemo<T>(
  compute: ComputeFunction<undefined | NoInfer<T>, T>,
  options: ServerClientMemoOptions<T>
): Accessor<T | undefined>;
export function createMemo<T>(
  compute: ComputeFunction<undefined | NoInfer<T>, T>,
  options?: ServerMemoOptions<T>
): Accessor<T>;
export function createMemo<T>(
  compute: ComputeFunction<undefined | NoInfer<T>, T>,
  options?: ServerClientMemoOptions<T> | ServerMemoOptions<T>
): Accessor<T | undefined> {
  // Capture SSR context at creation time — async re-computations (via .then callbacks)
  // may run after a concurrent request has overwritten sharedConfig.context.
  const ctx = sharedConfig.context;
  const owner = createOwner();
  const comp: ServerComputation<T> = {
    owner,
    value: undefined as any,
    compute: compute as ComputeFunction<any, T>,
    error: undefined,
    computed: false,
    disposed: false
  };
  // When the owner is disposed (e.g., Loading boundary retries), mark the computation
  // so in-flight Promise chains don't produce stale serialization.
  runWithOwner(owner, () =>
    onCleanup(() => {
      comp.disposed = true;
    })
  );

  function update() {
    if (comp.disposed) return;
    const run = () =>
      runWithOwner(owner, () => runWithObserver(comp, () => comp.compute(comp.value)));
    try {
      comp.error = undefined;
      const result = run();
      comp.computed = true;
      processResult(comp, result, owner, ctx, options?.deferStream, options?.ssrSource, run);
    } catch (err) {
      if (err instanceof NotReadyError) {
        subscribePendingRetry(err, update);
      }
      comp.error = err;
      comp.computed = true;
    }
  }

  const ssrSource = options?.ssrSource;
  if (ssrSource === "client") {
    // Skip computation and keep the value uninitialized. Owner created for ID parity.
    comp.computed = true;
  } else if (!options?.lazy) {
    update();
  }

  return () => {
    // Lazy: compute on first read
    if (!comp.computed) {
      update();
    }
    if (comp.error) {
      throw comp.error;
    }
    return comp.value;
  };
}

// === Deep Proxy for Patch Tracking (projections with async iterables) ===

export type PatchOp =
  | [path: PropertyKey[]]
  | [path: PropertyKey[], value: any]
  | [path: PropertyKey[], value: any, insert: 1];

export function createDeepProxy<T extends object>(
  target: T,
  patches: PatchOp[],
  basePath: PropertyKey[] = []
): T {
  const childProxies = new Map<PropertyKey, any>();

  const handler: ProxyHandler<any> = {
    get(obj, key, receiver) {
      if (Array.isArray(obj)) {
        if (key === "shift") {
          return function () {
            if (obj.length === 0) return undefined;
            const removed = obj[0];
            Array.prototype.shift.call(obj);
            childProxies.clear();
            patches.push([[...basePath, 0]]);
            return removed;
          };
        }
        if (key === "unshift") {
          return function (...items: any[]) {
            const result = Array.prototype.unshift.apply(obj, items);
            childProxies.clear();
            for (let i = 0; i < items.length; i++) {
              patches.push([[...basePath, i], items[i], 1]);
            }
            return result;
          };
        }
        if (key === "splice") {
          return function (start: number, deleteCount?: number, ...items: any[]) {
            const len = obj.length;
            const s = start < 0 ? Math.max(len + start, 0) : Math.min(start, len);
            const d =
              deleteCount === undefined ? len - s : Math.min(Math.max(deleteCount, 0), len - s);
            const removed = Array.prototype.splice.apply(obj, [s, d, ...items]);
            childProxies.clear();
            for (let i = 0; i < d; i++) patches.push([[...basePath, s]]);
            for (let i = 0; i < items.length; i++)
              patches.push([[...basePath, s + i], items[i], 1]);
            return removed;
          };
        }
      }

      const value = Reflect.get(obj, key, receiver);
      if (value !== null && typeof value === "object" && typeof key !== "symbol") {
        if (!childProxies.has(key)) {
          childProxies.set(key, createDeepProxy(value, patches, [...basePath, key]));
        }
        return childProxies.get(key);
      }
      return value;
    },

    set(obj, key, value) {
      childProxies.delete(key);
      patches.push([[...basePath, key], value]);
      return Reflect.set(obj, key, value);
    },

    deleteProperty(obj, key) {
      childProxies.delete(key);
      patches.push([[...basePath, key]]);
      return Reflect.deleteProperty(obj, key);
    }
  };

  return new Proxy(target, handler);
}

/** Process async results from a computation (Promise / AsyncIterable) */
function processResult<T>(
  comp: ServerComputation<T>,
  result: any,
  owner: Owner,
  ctx: any,
  deferStream?: boolean,
  ssrSource?: SsrSourceMode,
  rerun?: () => any
) {
  if (comp.disposed) return;
  const id = owner.id;
  const noHydrate = getContext(NoHydrateContext, owner);

  if (result instanceof Promise) {
    if ((result as any).s === 1) {
      comp.value = (result as any).v;
      comp.error = undefined;
      return;
    }
    if ((result as any).s === 2) {
      comp.error = (result as any).v;
      return;
    }
    const deferred = createDeferredPromise<T>();
    if (ctx?.async && ctx.serialize && id && !noHydrate)
      ctx.serialize(id, deferred.promise, deferStream);
    settleServerAsync(
      result,
      () => (rerun ? rerun() : result),
      deferred,
      (value: T) => {
        (result as any).s = 1;
        (result as any).v = value;
        comp.value = value;
        comp.error = undefined;
        return value;
      },
      (error: any) => {
        (result as any).s = 2;
        (result as any).v = error;
        comp.error = error;
      },
      () => comp.disposed
    );
    comp.error = new NotReadyError(deferred.promise);
    return;
  }

  const iterator = result?.[Symbol.asyncIterator];
  if (typeof iterator === "function") {
    if (ssrSource === "hybrid") {
      let currentResult = result;
      let iter: AsyncIterator<T>;
      const deferred = createDeferredPromise<T>();
      const runFirst = () => {
        const source = currentResult ?? (rerun ? rerun() : result);
        currentResult = undefined;
        const nextIterator = source?.[Symbol.asyncIterator];
        if (typeof nextIterator !== "function") {
          throw new Error("Expected async iterator while retrying server createMemo");
        }
        iter = nextIterator.call(source);
        return iter.next().then((value: IteratorResult<T>) => {
          if (!value.done) closeAsyncIterator(iter);
          return value.value;
        });
      };
      settleServerAsync(
        runFirst(),
        runFirst,
        deferred,
        (value: T) => {
          comp.value = value;
          comp.error = undefined;
          return value;
        },
        (error: any) => {
          comp.error = error;
        },
        () => comp.disposed
      );
      if (ctx?.async && ctx.serialize && id && !noHydrate)
        ctx.serialize(id, deferred.promise, deferStream);
      comp.error = new NotReadyError(deferred.promise);
    } else {
      // Full streaming ("server" or default): eagerly start the first iteration.
      // Tapped wrapper replays first value, then delegates to iter for the rest.
      let currentResult = result;
      let iter: AsyncIterator<T>;
      let firstResult: IteratorResult<T> | undefined;
      const deferred = createDeferredPromise<void>();
      const runFirst = () => {
        const source = currentResult ?? (rerun ? rerun() : result);
        currentResult = undefined;
        const nextIterator = source?.[Symbol.asyncIterator];
        if (typeof nextIterator !== "function") {
          throw new Error("Expected async iterator while retrying server createMemo");
        }
        iter = nextIterator.call(source);
        return iter.next().then((value: IteratorResult<T>) => {
          firstResult = value;
          // Resolve nesting: delays outer promise settlement by 1 microtask,
          // giving seroval's push() time to call stream.next() before Loading completes.
          return Promise.resolve();
        });
      };

      settleServerAsync(
        runFirst(),
        runFirst,
        deferred,
        () => {
          const resolved = firstResult;
          if (resolved && !resolved.done) {
            comp.value = resolved.value;
          }
          comp.error = undefined;
          return undefined;
        },
        (error: any) => {
          comp.error = error;
        },
        () => comp.disposed
      );

      if (ctx?.async && ctx.serialize && id && !noHydrate) {
        let tappedFirst = true;
        const tapped = {
          [Symbol.asyncIterator]: () => ({
            next() {
              if (tappedFirst) {
                tappedFirst = false;
                return deferred.promise.then(() =>
                  firstResult?.done
                    ? ({ done: true as const, value: undefined } as IteratorResult<T>)
                    : (firstResult as IteratorResult<T>)
                );
              }
              return iter.next().then((r: IteratorResult<T>) => r);
            },
            return(value?: any) {
              return iter.return?.(value);
            }
          })
        };
        ctx.serialize(id, tapped, deferStream);
      }
      comp.error = new NotReadyError(deferred.promise);
    }
    return;
  }

  // Synchronous value
  comp.value = result;
}

function closeAsyncIterator(iter: any, value?: any) {
  const returned = iter.return?.(value);
  if (returned && typeof returned.then === "function") {
    returned.then(undefined, () => {});
  }
}

// === Effects ===

function serverEffect<T>(
  compute: ComputeFunction<undefined | NoInfer<T>, T>,
  effectFn: EffectFunction<T, T> | undefined,
  options: EffectOptions | undefined
): void {
  const ssrSource = options?.ssrSource;
  if (ssrSource === "client") {
    createOwner();
    return;
  }
  const ctx = sharedConfig.context;
  const owner = createOwner();
  const comp: ServerComputation<T> = {
    owner,
    value: undefined as any,
    compute: compute as ComputeFunction<any, T>,
    error: undefined,
    computed: true,
    disposed: false
  };
  if (ssrSource) {
    runWithOwner(owner, () =>
      onCleanup(() => {
        comp.disposed = true;
      })
    );
  }
  try {
    const result = runWithOwner(owner, () =>
      runWithObserver(comp, () => (compute as ComputeFunction<any, T>)(undefined))
    );
    if (ssrSource) {
      processResult(comp, result, owner, ctx, options?.deferStream, ssrSource);
    }
    effectFn?.((ssrSource ? (comp.value ?? result) : result) as any, undefined);
  } catch (err) {
    // Swallow errors from effects on server
  }
}

export function createEffect<T>(
  compute: ComputeFunction<undefined | NoInfer<T>, T>,
  effect: EffectFunction<NoInfer<T>, T> | EffectBundle<NoInfer<T>, T>,
  options?: EffectOptions
): void {
  serverEffect(compute, undefined, options);
}

export function createRenderEffect<T>(
  compute: ComputeFunction<undefined | NoInfer<T>, T>,
  effectFn: EffectFunction<NoInfer<T>, T>,
  options?: EffectOptions
): void {
  serverEffect(compute, effectFn, options);
}

export function createTrackedEffect(
  compute: () => void | (() => void),
  options?: EffectOptions
): void {
  // No-op on server, but allocate computation ID
  const o = getOwner();
  if (o?.id != null) getNextChildId(o);
}

export function createReaction(
  effectFn: EffectFunction<undefined> | EffectBundle<undefined>,
  options?: EffectOptions
) {
  return (tracking: () => void) => {
    tracking();
  };
}

// === Optimistic ===

export function createOptimistic<T>(): Signal<T | undefined>;
export function createOptimistic<T>(
  value: Exclude<T, Function>,
  options?: SignalOptions<T>
): Signal<T>;
export function createOptimistic<T>(
  fn: ComputeFunction<undefined | NoInfer<T>, T>,
  options: ServerClientSignalOptions<T>
): Signal<T | undefined>;
export function createOptimistic<T>(
  fn: ComputeFunction<undefined | NoInfer<T>, T>,
  options?: ServerSignalOptions<T>
): Signal<T>;
export function createOptimistic<T>(
  first?: T | ComputeFunction<any, any>,
  second?: SignalOptions<any>
): Signal<T | undefined> {
  // On server, optimistic is the same as regular signal
  return (createSignal as Function)(first, second);
}

// === Store (plain objects, no proxy) ===

function setProperty(state: any, property: PropertyKey, value: any) {
  if (state[property] === value) return;
  if (value === undefined) {
    delete state[property];
  } else state[property] = value;
}

export function createStore<T extends object>(
  store: T | Store<T>
): [get: Store<T>, set: StoreSetter<T>];
export function createStore<T extends object>(
  fn: (store: T) => void | T | Promise<void | T>,
  store: Partial<T> | Store<T>
): [get: Store<T>, set: StoreSetter<T>];
export function createStore<T extends object>(
  first: T | Store<T> | ((store: T) => void | T | Promise<void | T>),
  second?: T | Store<T>
): [get: Store<T>, set: StoreSetter<T>] {
  if (typeof first === "function") {
    const store = createProjection(first as any, second as T);
    return [store as Store<T>, ((fn: (state: T) => void) => fn(store as T)) as StoreSetter<T>];
  }
  const state = first as T;
  return [state as Store<T>, ((fn: (state: T) => void) => fn(state as T)) as StoreSetter<T>];
}

export const createOptimisticStore = createStore;

/**
 * Wraps a store in a Proxy that throws NotReadyError on property reads
 * while the async data is pending. Once markReady() is called, reads
 * pass through to the underlying state.
 */
function createPendingProxy<T extends object>(
  state: T,
  source: Promise<any>
): [proxy: Store<T>, markReady: (frozenState?: T) => void] {
  let pending = true;
  let readTarget: T = state;
  const proxy = new Proxy(state, {
    get(obj, key, receiver) {
      if (pending && typeof key !== "symbol") {
        throw new NotReadyError(source);
      }
      return Reflect.get(readTarget, key);
    }
  });
  return [
    proxy as Store<T>,
    (frozen?: T) => {
      if (frozen) readTarget = frozen;
      pending = false;
    }
  ];
}

export function createProjection<T extends object>(
  fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  initialValue: Partial<T>,
  options?: ServerSsrOptions
): Store<T> {
  const ctx = sharedConfig.context;
  const owner = createOwner();
  const [state] = createStore(initialValue as T);

  if (options?.ssrSource === "client") {
    return state;
  }

  let disposed = false;
  runWithOwner(owner, () =>
    onCleanup(() => {
      disposed = true;
    })
  );

  const ssrSource = options?.ssrSource;
  const useProxy = ssrSource !== "hybrid";
  const patches: PatchOp[] = [];
  const draft = useProxy ? createDeepProxy(state as any, patches) : (state as any as T);

  const runProjection = () => runWithOwner(owner, () => fn(draft));
  const result = runProjection();

  // Async iterable (generator)
  const iteratorFn = (result as any)?.[Symbol.asyncIterator];
  if (typeof iteratorFn === "function") {
    if (ssrSource === "hybrid") {
      let currentResult = result;
      let iter: AsyncIterator<void | T>;
      const deferred = createDeferredPromise<T>();
      const [pending, markReady] = createPendingProxy(state, deferred.promise);
      const runFirst = () => {
        const source = currentResult ?? runProjection();
        currentResult = undefined;
        const nextIterator = (source as any)?.[Symbol.asyncIterator];
        if (typeof nextIterator !== "function") {
          throw new Error("Expected async iterator while retrying server createProjection");
        }
        iter = nextIterator.call(source);
        return iter.next().then((r: IteratorResult<void | T>) => {
          if (!r.done) closeAsyncIterator(iter);
          return r.value as T;
        });
      };
      settleServerAsync(
        runFirst(),
        runFirst,
        deferred,
        (value: void | T) => {
          if (value !== undefined && value !== state) {
            Object.assign(state, value);
          }
          markReady();
          return state as T;
        },
        (error: any) => {
          markReady();
        },
        () => disposed
      );
      if (ctx?.async && !getContext(NoHydrateContext) && owner.id)
        ctx.serialize(owner.id, deferred.promise, options?.deferStream);
      return pending;
    } else {
      // Full streaming: eagerly start first iteration. Tapped wrapper replays
      // first value as full state snapshot, then yields patch batches.
      let currentResult = result;
      let iter: AsyncIterator<void | T>;
      let firstResult: IteratorResult<void | T> | undefined;
      const deferred = createDeferredPromise<void>();
      const [pending, markReady] = createPendingProxy(state, deferred.promise);
      const runFirst = () => {
        const source = currentResult ?? runProjection();
        currentResult = undefined;
        const nextIterator = (source as any)?.[Symbol.asyncIterator];
        if (typeof nextIterator !== "function") {
          throw new Error("Expected async iterator while retrying server createProjection");
        }
        iter = nextIterator.call(source);
        return iter.next().then((value: IteratorResult<void | T>) => {
          firstResult = value;
          return Promise.resolve();
        });
      };

      settleServerAsync(
        runFirst(),
        runFirst,
        deferred,
        () => {
          patches.length = 0;
          const resolved = firstResult;
          if (
            resolved &&
            !resolved.done &&
            resolved.value !== undefined &&
            resolved.value !== draft
          ) {
            Object.assign(state, resolved.value as T);
          }
          // Lock SSR-visible state at V1: subsequent generator mutations update
          // `state` (for draft/patch correctness) but reads go through the frozen copy.
          markReady(JSON.parse(JSON.stringify(state)) as T);
          return undefined;
        },
        (error: any) => {
          markReady();
        },
        () => disposed
      );

      if (ctx?.async && !getContext(NoHydrateContext) && owner.id) {
        let tappedFirst = true;
        const tapped = {
          [Symbol.asyncIterator]: () => ({
            next() {
              if (tappedFirst) {
                tappedFirst = false;
                return deferred.promise.then(() => {
                  if (firstResult?.done) return { done: true as const, value: undefined };
                  return { done: false as const, value: JSON.parse(JSON.stringify(state)) };
                });
              }
              return iter.next().then((r: IteratorResult<void | T>) => {
                if (disposed) return { done: true as const, value: undefined };
                const flushed = patches.splice(0);
                if (!r.done) {
                  if (r.value !== undefined && r.value !== draft) {
                    Object.assign(state, r.value as T);
                  }
                  return { done: false as const, value: flushed };
                }
                return { done: true as const, value: undefined };
              });
            },
            return(value?: any) {
              return iter.return?.(value);
            }
          })
        };
        ctx.serialize(owner.id, tapped, options?.deferStream);
      }
      return pending;
    }
  }

  if (result instanceof Promise) {
    const deferred = createDeferredPromise<T>();
    const [pending, markReady] = createPendingProxy(state, deferred.promise);
    settleServerAsync(
      result,
      () => runProjection() as void | T | PromiseLike<void | T>,
      deferred,
      (value: void | T) => {
        if (value !== undefined && value !== state) {
          Object.assign(state, value);
        }
        markReady();
        return state as T;
      },
      (error: any) => {
        markReady();
      },
      () => disposed
    );
    if (ctx?.async && !getContext(NoHydrateContext) && owner.id)
      ctx.serialize(owner.id, deferred.promise, options?.deferStream);
    return pending;
  }

  // Synchronous: fn either mutated state directly (void) or returned a new value
  if (result !== undefined && result !== state && result !== draft) {
    Object.assign(state, result as T);
  }
  return state;
}

export function reconcile<T extends U, U extends object>(value: T): (state: U) => T {
  return state => {
    if (!isWrappable(state) || !isWrappable(value)) return value;
    const targetKeys = Object.keys(value) as (keyof T)[];
    const previousKeys = Object.keys(state) as (keyof T)[];
    for (let i = 0, len = targetKeys.length; i < len; i++) {
      const key = targetKeys[i];
      setProperty(state, key, value[key]);
    }
    for (let i = 0, len = previousKeys.length; i < len; i++) {
      if (value[previousKeys[i]] === undefined) setProperty(state, previousKeys[i], undefined);
    }
    return state as T;
  };
}

export function deep<T extends object>(store: Store<T>): Store<T> {
  return store;
}

// === Array mapping ===

export function mapArray<T, U>(
  list: Accessor<readonly T[] | undefined | null | false>,
  mapFn: (v: Accessor<T>, i: Accessor<number>) => U,
  options: { keyed?: boolean | ((item: T) => any); fallback?: Accessor<any> } = {}
): () => U[] {
  const parent = createOwner();
  return createMemo(() => {
    const items = list();
    let s: U[] = [];
    if (items && items.length) {
      runWithOwner(parent, () => {
        for (let i = 0, len = items.length; i < len; i++) {
          const o = createOwner();
          s.push(
            runWithOwner(o, () =>
              mapFn(
                () => items[i],
                () => i
              )
            )
          );
        }
      });
    } else if (options.fallback) {
      s = [
        runWithOwner(parent, () => {
          const fo = createOwner();
          return runWithOwner(fo, () => options.fallback!()) as U;
        })
      ];
    }
    return s;
  });
}

export function repeat<T>(
  count: Accessor<number>,
  mapFn: (i: number) => T,
  options: { fallback?: Accessor<any>; from?: Accessor<number | undefined> } = {}
): () => T[] {
  const owner = createOwner();
  return createMemo(() => {
    const len = count();
    const offset = options.from?.() || 0;
    if (!len) {
      if (!options.fallback) return [];
      return [
        runWithOwner(owner, () => {
          const fallbackOwner = createOwner();
          return runWithOwner(fallbackOwner, () => options.fallback!()) as T;
        }) as T
      ];
    }
    return runWithOwner(owner, () =>
      Array.from({ length: len }, (_, i) => {
        const itemOwner = createOwner();
        return runWithOwner(itemOwner, () => mapFn(i + offset)) as T;
      })
    );
  });
}

// === Boundary primitives ===

const ErrorContext: Context<((err: any) => void) | null> = {
  id: Symbol("ErrorContext"),
  defaultValue: null
};

export { ErrorContext };
export function runWithBoundaryErrorContext<T>(
  owner: Owner,
  render: () => T,
  onError: (err: any, parentHandler: ((err: any) => void) | null) => void,
  context?: NonNullable<typeof sharedConfig.context>,
  boundaryId?: string
): T {
  const prevCtx = sharedConfig.context;
  const prevBoundary = context?._currentBoundaryId;
  if (context) {
    sharedConfig.context = context;
    if (boundaryId !== undefined) context._currentBoundaryId = boundaryId;
  }
  try {
    return runWithOwner(owner, () => {
      const parentHandler = getContext(ErrorContext);
      setContext(ErrorContext, err => onError(err, parentHandler));
      return render();
    }) as T;
  } finally {
    if (context) {
      if (boundaryId !== undefined) context._currentBoundaryId = prevBoundary;
      sharedConfig.context = prevCtx;
    }
  }
}

export { NoHydrateContext };

export function createErrorBoundary<U>(
  fn: () => any,
  fallback: (error: unknown, reset: () => void) => U
): () => unknown {
  const ctx = sharedConfig.context;
  const parent = getOwner();
  const owner = createOwner();
  const resolve = () => {
    const resolved = ctx!.resolve(runWithOwner(createOwner(), fn));
    if (resolved?.p?.length) throw new NotReadyError(Promise.all(resolved.p));
    return resolved;
  };
  const renderFallback = (err: any) =>
    ctx
      ? runWithOwner(parent!, () => {
          const fallbackOwner = createOwner();
          return runWithOwner(fallbackOwner, () => fallback(err, () => {}));
        })
      : fallback(err, () => {});
  const serializeError = (err: any) => {
    if (ctx && owner.id && !runWithOwner(owner, () => getContext(NoHydrateContext))) {
      ctx.serialize(owner.id, err);
    }
  };
  const handleError = (err: any) => {
    serializeError(err);
    return renderFallback(err);
  };
  return () => {
    let result: any;
    let handled = false;
    if (ctx) owner.dispose(false);
    try {
      result = ctx
        ? runWithBoundaryErrorContext(owner, resolve, err => {
            if (err instanceof NotReadyError) throw err;
            handled = true;
            result = handleError(err);
            throw err;
          })
        : runWithOwner(owner, fn);
    } catch (err) {
      if (err instanceof NotReadyError) throw err;
      result = handled ? result : handleError(err);
    }
    return result;
  };
}

export function createLoadingBoundary(
  fn: () => any,
  fallback: () => any,
  options?: { on?: () => any }
): () => unknown {
  // On server, try to run fn. If NotReadyError is thrown, return fallback.
  // Full HydrationContext integration happens in the Loading component wrapper.
  try {
    const result = fn();
    return () => result;
  } catch (err) {
    if (err instanceof NotReadyError) {
      return () => fallback();
    }
    throw err;
  }
}

export function createRevealOrder<T>(
  fn: () => T,
  _options?: { together?: () => boolean; collapsed?: () => boolean }
): T {
  const o = createOwner();
  return runWithOwner(o, fn);
}

// === Utilities ===

export function untrack<T>(fn: () => T): T {
  return fn();
}

export function flush() {}

export function resolve<T>(fn: () => T): Promise<T> {
  throw new Error("resolve is not implemented on the server");
}

export function isPending(fn: () => any, fallback?: boolean): boolean {
  try {
    fn();
    return false;
  } catch (err) {
    if (err instanceof NotReadyError && arguments.length > 1) {
      return fallback!;
    }
    throw err;
  }
}

export function latest<T>(fn: () => T): T {
  return fn();
}

export function isRefreshing(): boolean {
  return false;
}

export function refresh<T>(fn: () => T): T {
  return fn();
}

export function action<T extends (...args: any[]) => any>(fn: T): T {
  return fn;
}

export function onSettled(callback: () => void | (() => void)): void {
  // No-op on server, but allocate computation ID for hydration tree alignment
  // (on the client, onSettled calls createTrackedEffect which allocates an ID)
  const o = getOwner();
  if (o?.id != null) getNextChildId(o);
}

// NoInfer utility type (also re-exported from signals, but define for local use)
type NoInfer<T extends any> = [T][T extends any ? 0 : never];
