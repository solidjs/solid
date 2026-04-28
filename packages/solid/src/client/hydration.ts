import {
  getOwner,
  createLoadingBoundary as coreLoadingBoundary,
  createErrorBoundary as coreErrorBoundary,
  flush,
  runWithOwner,
  onCleanup,
  isDisposed,
  getNextChildId,
  peekNextChildId,
  createMemo as coreMemo,
  createSignal as coreSignal,
  createOptimistic as coreOptimistic,
  createProjection as coreProjection,
  createStore as coreStore,
  createOptimisticStore as coreOptimisticStore,
  createRenderEffect as coreRenderEffect,
  createEffect as coreEffect,
  setSnapshotCapture,
  markSnapshotScope,
  releaseSnapshotScope,
  clearSnapshots,
  type Accessor,
  type ComputeFunction,
  type MemoOptions,
  type NoInfer,
  type Owner,
  type ProjectionOptions,
  type Refreshable,
  type Signal,
  type SignalOptions,
  type Store,
  type StoreSetter,
  createOwner,
  getContext,
  setContext,
  type Context
} from "@solidjs/signals";
import { JSX } from "../jsx.js";
import { IS_DEV } from "./core.js";

type HydrationSsrFields = {
  /**
   * Defer the SSR stream flush until this primitive's first value is
   * resolved. Lets late-resolving sources hold the document open
   * rather than forcing the surrounding `<Loading>` boundary to render
   * its fallback into the HTML. Server-only; ignored on the client.
   */
  deferStream?: boolean;
  /**
   * Hydration policy. Decides what initial value the client uses and
   * whether the compute re-runs.
   *
   * - `"server"` *(default)*: client uses the serialized server value
   *   as initial state. Compute does **not** re-run for the initial
   *   value — the serialized result is authoritative. Choose this when
   *   the compute is deterministic from server-available inputs.
   * - `"hybrid"`: client uses the serialized server value, then
   *   re-runs the compute to take over. Choose this for computes that
   *   mix server data with client-only signals (e.g. window size,
   *   user-locale).
   * - `"client"`: skip the server value entirely. Compute is deferred
   *   until hydration completes, then runs as if first-mounted.
   *   Choose this for client-only state where serialization is
   *   meaningless.
   */
  ssrSource?: "server" | "hybrid" | "client";
};
declare module "@solidjs/signals" {
  interface MemoOptions<T> extends HydrationSsrFields {}
  interface SignalOptions<T> extends HydrationSsrFields {}
  interface EffectOptions extends HydrationSsrFields {}
}

/**
 * Options for `createProjection`, `createStore(fn, ...)`, and
 * `createOptimisticStore(fn, ...)` — `ProjectionOptions` plus a
 * hydration-aware `ssrSource` field.
 *
 * `ssrSource` controls what initial value the client uses and whether
 * the projection's compute re-runs:
 *
 * - `"server"` *(default)*: client uses the serialized server value
 *   as initial state.
 * - `"hybrid"`: serialized value first, then re-run the compute on
 *   the client to take over.
 * - `"client"`: skip serialization; compute runs only after hydration
 *   completes.
 *
 * See {@link HydrationSsrFields} for the fuller explanation.
 */
export type HydrationProjectionOptions = ProjectionOptions & {
  ssrSource?: "server" | "hybrid" | "client";
};

type HydrationClientMemoOptions<T> = Omit<MemoOptions<T>, "ssrSource"> & { ssrSource: "client" };
type HydrationMemoOptions<T> = Omit<MemoOptions<T>, "ssrSource"> & {
  ssrSource?: "server" | "hybrid";
};
type HydrationClientSignalOptions<T> = Omit<SignalOptions<T> & MemoOptions<T>, "ssrSource"> & {
  ssrSource: "client";
};
type HydrationSignalOptions<T> = Omit<SignalOptions<T> & MemoOptions<T>, "ssrSource"> & {
  ssrSource?: "server" | "hybrid";
};

export type HydrationContext = {};

export const NoHydrateContext: Context<boolean> = {
  id: Symbol("NoHydrateContext"),
  defaultValue: false
};

type SharedConfig = {
  hydrating: boolean;
  resources?: { [key: string]: any };
  load?: (id: string) => Promise<any> | any;
  has?: (id: string) => boolean;
  gather?: (key: string) => void;
  cleanupFragment?: (id: string) => void;
  loadModuleAssets?: (mapping: Record<string, string>) => Promise<void> | undefined;
  registry?: Map<string, Element>;
  completed?: WeakSet<Element> | null;
  events?: any[] | null;
  verifyHydration?: () => void;
  done: boolean;
  getNextContextId(): string;
};

export const sharedConfig: SharedConfig = {
  hydrating: false,
  registry: undefined,
  done: false,
  getNextContextId() {
    const o = getOwner();
    if (!o) throw new Error(`getNextContextId cannot be used under non-hydrating context`);
    if (getContext(NoHydrateContext)) return undefined as unknown as string;
    return getNextChildId(o);
  }
};

// === Hydration phase API ===

let _hydrationEndCallbacks: (() => void)[] | null = null;
let _pendingBoundaries = 0;
let _hydrationDone = false;
let _snapshotRootOwner: Owner | null = null;

function markTopLevelSnapshotScope() {
  if (_snapshotRootOwner) return;
  let owner: Owner | null = getOwner();
  if (!owner) return;
  while (owner._parent) owner = owner._parent;
  markSnapshotScope(owner);
  _snapshotRootOwner = owner;
}

/**
 * Registers a callback to run once when all hydration completes
 * (all boundaries hydrated or cancelled). If hydration is already
 * complete (or not hydrating), fires via queueMicrotask.
 */
export function onHydrationEnd(callback: () => void): void {
  if (_hydrationDone || (!sharedConfig.hydrating && _pendingBoundaries === 0)) {
    queueMicrotask(callback);
    return;
  }
  if (!_hydrationEndCallbacks) _hydrationEndCallbacks = [];
  _hydrationEndCallbacks.push(callback);
}

function drainHydrationCallbacks() {
  if (_hydrationDone) return;
  _hydrationDone = true;
  _doneValue = true;
  clearSnapshots();
  setSnapshotCapture(false);
  flush();
  const cbs = _hydrationEndCallbacks;
  _hydrationEndCallbacks = null;
  if (cbs) for (const cb of cbs) cb();
  setTimeout(() => {
    if (IS_DEV && sharedConfig.verifyHydration) sharedConfig.verifyHydration();
    if ((globalThis as any)._$HY) (globalThis as any)._$HY.done = true;
    sharedConfig.registry?.clear();
  });
}

function checkHydrationComplete() {
  if (_pendingBoundaries === 0) drainHydrationCallbacks();
}

// Backing values for property interceptors (installed by enableHydration)
let _hydratingValue = false;
let _doneValue = false;

// === Override slots for hydration-aware primitives (tree-shakeable) ===
// Only assigned inside enableHydration(). If enableHydration is never called
// (no hydrate() import), the hydrated* functions and their dependencies
// (MockPromise, subFetch) are eliminated by the bundler.

let _createMemo: Function | undefined;
let _createSignal: Function | undefined;
let _createErrorBoundary: Function | undefined;
let _createOptimistic: Function | undefined;
let _createProjection: Function | undefined;
let _createStore: Function | undefined;
let _createOptimisticStore: Function | undefined;
let _createRenderEffect: Function | undefined;
let _createEffect: Function | undefined;

// --- Hydration helpers ---

class MockPromise {
  static {
    for (const k of ["all", "allSettled", "any", "race", "reject", "resolve"] as const) {
      (MockPromise as any)[k] = () => new MockPromise();
    }
  }
  catch() {
    return new MockPromise();
  }
  then() {
    return new MockPromise();
  }
  finally() {
    return new MockPromise();
  }
}

function subFetch<T>(fn: (prev?: T) => any, prev?: T) {
  const ogFetch = fetch;
  const ogPromise = Promise;
  try {
    window.fetch = () => new MockPromise() as any;
    Promise = MockPromise as any;
    const result = fn(prev);
    if (result && typeof result[Symbol.asyncIterator] === "function") {
      result[Symbol.asyncIterator]().next();
    }
    return result;
  } finally {
    window.fetch = ogFetch;
    Promise = ogPromise;
  }
}

function syncThenable(value: any) {
  return {
    then(fn: any) {
      fn(value);
    }
  };
}

const NO_HYDRATED_VALUE = Symbol("NO_HYDRATED_VALUE");

function readHydratedValue(initP: any, refresh: () => void) {
  if (initP == null) return NO_HYDRATED_VALUE;
  refresh();
  if (typeof initP === "object" && initP.s === 2) throw initP.v;
  return initP?.v ?? initP;
}

/** Shared “serialized init or run compute” path for memo/signal/optimistic/effect under hydration. */
function readSerializedOrCompute(compute: (prev: any) => any, prev: any) {
  if (!sharedConfig.hydrating) return compute(prev);
  const o = getOwner()!;
  let initP: any;
  if (sharedConfig.has!(o.id!)) initP = sharedConfig.load!(o.id!);
  const init = readHydratedValue(initP, () => subFetch(compute, prev));
  return init !== NO_HYDRATED_VALUE ? init : compute(prev);
}

function forwardIteratorReturn(it: any, value?: any) {
  const returned = it.return?.(value);
  return returned && typeof returned.then === "function"
    ? returned
    : syncThenable(returned ?? { done: true, value });
}

function normalizeIterator(it: any) {
  let first = true;
  let buffered: any = null;
  return {
    next() {
      if (first) {
        first = false;
        const r = it.next();
        return r && typeof r.then === "function" ? r : syncThenable(r);
      }
      if (buffered) {
        const b = buffered;
        buffered = null;
        return b;
      }
      let latest = it.next();
      if (latest && typeof latest.then === "function") return latest;
      while (!latest.done) {
        const peek = it.next();
        if (peek && typeof peek.then === "function") {
          buffered = peek;
          break;
        }
        latest = peek;
      }
      return Promise.resolve(latest);
    },
    return(value?: any) {
      buffered = null;
      return forwardIteratorReturn(it, value);
    }
  };
}

function applyPatches(target: any, patches: any[]) {
  for (const patch of patches) {
    const path = patch[0];
    let current = target;
    for (let i = 0; i < path.length - 1; i++) current = current[path[i]];
    const key = path[path.length - 1];
    if (patch.length === 1) {
      Array.isArray(current) ? current.splice(key as number, 1) : delete current[key];
    } else if (patch.length === 3) {
      (current as any[]).splice(key as number, 0, patch[1]);
    } else {
      current[key] = patch[1];
    }
  }
}

function isAsyncIterable(v: any): boolean {
  return v != null && typeof v[Symbol.asyncIterator] === "function";
}

function createShadowDraft(realDraft: any) {
  const shadow = JSON.parse(JSON.stringify(realDraft));
  let useShadow = true;
  return {
    proxy: new Proxy(shadow, {
      get(_, prop) {
        return useShadow ? shadow[prop] : realDraft[prop];
      },
      set(_, prop, value) {
        if (useShadow) {
          shadow[prop] = value;
          return true;
        }
        return Reflect.set(realDraft, prop, value);
      },
      deleteProperty(_, prop) {
        if (useShadow) {
          delete shadow[prop];
          return true;
        }
        return Reflect.deleteProperty(realDraft, prop);
      },
      has(_, prop) {
        return prop in (useShadow ? shadow : realDraft);
      },
      ownKeys() {
        return Reflect.ownKeys(useShadow ? shadow : realDraft);
      },
      getOwnPropertyDescriptor(_, prop) {
        return Object.getOwnPropertyDescriptor(useShadow ? shadow : realDraft, prop);
      }
    }),
    activate() {
      useShadow = false;
    }
  };
}

function wrapFirstYield(iterable: any, activate: () => void) {
  const srcIt = iterable[Symbol.asyncIterator]();
  let first = true;
  return {
    [Symbol.asyncIterator]() {
      return {
        next() {
          const p = srcIt.next();
          if (first) {
            first = false;
            return p.then((r: any) => {
              activate();
              return r.done ? r : { done: false, value: undefined };
            });
          }
          return p;
        },
        return(value?: any) {
          return forwardIteratorReturn(srcIt, value);
        }
      };
    }
  };
}

function hydrateSignalFromAsyncIterable(coreFn: Function, compute: any, options: any): any {
  const parent = getOwner()!;
  const expectedId = peekNextChildId(parent);
  if (!sharedConfig.has!(expectedId)) return null;
  const loaded = sharedConfig.load!(expectedId);
  if (!isAsyncIterable(loaded)) return null;

  const it = normalizeIterator(loaded[Symbol.asyncIterator]());
  const iterable = {
    [Symbol.asyncIterator]() {
      return it;
    }
  };
  return coreFn((prev: any) => {
    // Run the user compute up to its first await on the client so any reactive
    // dependencies read before the first suspension are tracked. subFetch mocks
    // fetch/Promise so the async generator cannot progress past that point —
    // the server iterator drives the actual values from here on.
    subFetch(compute, prev);
    return iterable;
  }, options);
}

function hydrateStoreFromAsyncIterable(
  coreFn: Function,
  fn: any,
  initialValue: any,
  options: any
): any {
  const parent = getOwner()!;
  const expectedId = peekNextChildId(parent);
  if (!sharedConfig.has!(expectedId)) return null;
  const loaded = sharedConfig.load!(expectedId);
  if (!isAsyncIterable(loaded)) return null;

  const srcIt = loaded[Symbol.asyncIterator]();
  let isFirst = true;
  let buffered: any = null;
  return coreFn(
    (draft: any) => {
      // Run the user fn up to its first await on the client so any reactive
      // dependencies read before the first suspension are tracked. Writes go
      // to a shadow of the draft and are discarded — the server iterator is
      // authoritative and drives the real draft via the iterable below.
      const { proxy } = createShadowDraft(draft);
      subFetch(fn, proxy);
      const process = (res: any) => {
        if (res.done) return { done: true, value: undefined };
        if (isFirst) {
          isFirst = false;
          // The initial full value IS the snapshot state the SSR DOM reflects.
          // Disable snapshot capture while applying it so prepareStoreWrite doesn't
          // record the pre-write (empty) base as the snapshot — otherwise reads
          // during hydration (e.g. Repeat reading length) see the stale pre-value
          // and fail to match the server-rendered DOM.
          setSnapshotCapture(false);
          try {
            if (Array.isArray(res.value)) {
              for (let i = 0; i < res.value.length; i++) draft[i] = res.value[i];
              draft.length = res.value.length;
            } else {
              Object.assign(draft, res.value);
            }
          } finally {
            setSnapshotCapture(true);
          }
        } else {
          applyPatches(draft, res.value);
        }
        return { done: false, value: undefined };
      };
      return {
        [Symbol.asyncIterator]() {
          return {
            next() {
              if (isFirst) {
                const r = srcIt.next();
                return r && typeof r.then === "function"
                  ? {
                      then(fn: any, rej: any) {
                        r.then((v: any) => fn(process(v)), rej);
                      }
                    }
                  : syncThenable(process(r));
              }
              if (buffered) {
                const b = buffered;
                buffered = null;
                return b.then(process);
              }
              let r = srcIt.next();
              if (r && typeof r.then === "function") {
                return r.then(process);
              }
              let result = process(r);
              while (!r.done) {
                const peek = srcIt.next();
                if (peek && typeof peek.then === "function") {
                  buffered = peek;
                  break;
                }
                r = peek;
                if (!r.done) result = process(r);
              }
              return Promise.resolve(result);
            },
            return(value?: any) {
              buffered = null;
              return forwardIteratorReturn(srcIt, value);
            }
          };
        }
      };
    },
    initialValue,
    options
  );
}

// --- Hydration-aware implementations ---

function hydratedCreateMemo(compute: any, options?: any) {
  if (!sharedConfig.hydrating || options?.transparent) {
    return coreMemo(compute, options);
  }
  markTopLevelSnapshotScope();

  const ssrSource = options?.ssrSource;

  if (ssrSource === "client") {
    const [hydrated, setHydrated] = coreSignal(false, { ownedWrite: true });
    const memo = coreMemo((prev: any) => {
      if (!hydrated()) return prev;
      return compute(prev);
    }, options);
    setHydrated(true);
    return memo;
  }

  // "server", "hybrid", or undefined — use serialized value from server
  const aiResult = hydrateSignalFromAsyncIterable(coreMemo, compute, options);
  if (aiResult !== null) return aiResult;

  return coreMemo((prev: any) => readSerializedOrCompute(compute, prev), options);
}

function hydratedCreateSignal(fn?: any, second?: any) {
  if (typeof fn !== "function" || !sharedConfig.hydrating) return coreSignal(fn, second);
  markTopLevelSnapshotScope();

  const ssrSource = second?.ssrSource;

  if (ssrSource === "client") {
    const [hydrated, setHydrated] = coreSignal(false, { ownedWrite: true });
    const sig = coreSignal((prev: any) => {
      if (!hydrated()) return prev;
      return fn(prev);
    }, second);
    setHydrated(true);
    return sig;
  }

  // "server", "hybrid", or undefined
  const aiResult = hydrateSignalFromAsyncIterable(coreSignal, fn, second);
  if (aiResult !== null) return aiResult;

  return coreSignal((prev: any) => readSerializedOrCompute(fn, prev), second);
}

function hydratedCreateErrorBoundary<U>(
  fn: () => any,
  fallback: (error: unknown, reset: () => void) => U
): () => unknown {
  if (!sharedConfig.hydrating) return coreErrorBoundary(fn, fallback);
  markTopLevelSnapshotScope();
  const parent = getOwner()!;
  const expectedId = peekNextChildId(parent);
  if (sharedConfig.has!(expectedId)) {
    const err = sharedConfig.load!(expectedId);
    if (err !== undefined) {
      let hydrated = true;
      return coreErrorBoundary(() => {
        if (hydrated) {
          hydrated = false;
          throw err;
        }
        return fn();
      }, fallback);
    }
  }
  return coreErrorBoundary(fn, fallback);
}

function hydratedCreateOptimistic(fn?: any, second?: any) {
  if (typeof fn !== "function" || !sharedConfig.hydrating) return coreOptimistic(fn, second);
  markTopLevelSnapshotScope();

  const ssrSource = second?.ssrSource;

  if (ssrSource === "client") {
    const [hydrated, setHydrated] = coreSignal(false, { ownedWrite: true });
    const sig = coreOptimistic((prev: any) => {
      if (!hydrated()) return prev;
      return fn(prev);
    }, second);
    setHydrated(true);
    return sig;
  }

  // "server", "hybrid", or undefined
  const aiResult = hydrateSignalFromAsyncIterable(coreOptimistic, fn, second);
  if (aiResult !== null) return aiResult;

  return coreOptimistic((prev: any) => readSerializedOrCompute(fn, prev), second);
}

function wrapStoreFn(fn: any) {
  return (draft: any) => readSerializedOrCompute(() => fn(draft), draft);
}

function hydrateStoreLikeFn(
  coreFn: Function,
  fn: any,
  initialValue: any,
  options: any,
  ssrSource: string | undefined
): any {
  if (ssrSource === "client") {
    const [hydrated, setHydrated] = coreSignal(false, { ownedWrite: true });
    const result = coreFn(
      (draft: any) => {
        if (!hydrated()) return;
        return fn(draft);
      },
      initialValue,
      options
    );
    setHydrated(true);
    return result;
  }
  if (ssrSource === "hybrid") {
    const [hydrated, setHydrated] = coreSignal(false, { ownedWrite: true });
    const result = coreFn(
      (draft: any) => {
        const o = getOwner()!;
        if (!hydrated()) {
          if (sharedConfig.has!(o.id!)) {
            const initP = sharedConfig.load!(o.id!);
            const init = readHydratedValue(initP, () => subFetch(fn, draft));
            if (init !== NO_HYDRATED_VALUE) return init;
          }
          return fn(draft);
        }
        const { proxy, activate } = createShadowDraft(draft);
        const r = fn(proxy);
        return isAsyncIterable(r) ? wrapFirstYield(r, activate) : r;
      },
      initialValue,
      options
    );
    setHydrated(true);
    return result;
  }
  const aiResult = hydrateStoreFromAsyncIterable(coreFn, fn, initialValue, options);
  if (aiResult !== null) return aiResult;
  return coreFn(wrapStoreFn(fn), initialValue, options);
}

function hydratedCreateStore(first?: any, second?: any, third?: any) {
  if (typeof first !== "function" || !sharedConfig.hydrating)
    return coreStore(first, second, third);
  markTopLevelSnapshotScope();
  const ssrSource = third?.ssrSource;
  return hydrateStoreLikeFn(coreStore, first, second ?? {}, third, ssrSource);
}

function hydratedCreateOptimisticStore(first?: any, second?: any, third?: any) {
  if (typeof first !== "function" || !sharedConfig.hydrating)
    return coreOptimisticStore(first, second, third);
  markTopLevelSnapshotScope();
  const ssrSource = third?.ssrSource;
  return hydrateStoreLikeFn(coreOptimisticStore, first, second ?? {}, third, ssrSource);
}

function hydratedCreateProjection(fn: any, initialValue?: any, options?: any) {
  if (!sharedConfig.hydrating) return coreProjection(fn, initialValue, options);
  markTopLevelSnapshotScope();
  const ssrSource = options?.ssrSource;
  return hydrateStoreLikeFn(coreProjection, fn, initialValue, options, ssrSource);
}

// --- Hydration-aware effect implementations ---

function hydratedEffect(coreFn: Function, compute: any, effectFn: any, options?: any) {
  if (!sharedConfig.hydrating || options?.transparent) return coreFn(compute, effectFn, options);

  const ssrSource = options?.ssrSource;

  if (ssrSource === "client") {
    const [hydrated, setHydrated] = coreSignal(false, { ownedWrite: true });
    let active = false;
    coreFn(
      (prev: any) => {
        if (!hydrated()) return prev;
        active = true;
        return compute(prev);
      },
      (next: any, prev: any) => {
        if (!active) return;
        return effectFn(next, prev);
      },
      options
    );
    setHydrated(true);
    return;
  }

  // "server", "hybrid", or undefined — use serialized value from server
  markTopLevelSnapshotScope();
  coreFn((prev: any) => readSerializedOrCompute(compute, prev), effectFn, options);
}

function hydratedCreateRenderEffect(compute: any, effectFn: any, options?: any) {
  return hydratedEffect(coreRenderEffect, compute, effectFn, options);
}

function hydratedCreateEffect(compute: any, effectFn: any, options?: any) {
  return hydratedEffect(coreEffect, compute, effectFn, options);
}

// --- Public API ---

export function enableHydration() {
  _createMemo = hydratedCreateMemo;
  _createSignal = hydratedCreateSignal;
  _createErrorBoundary = hydratedCreateErrorBoundary;
  _createOptimistic = hydratedCreateOptimistic;
  _createProjection = hydratedCreateProjection;
  _createStore = hydratedCreateStore;
  _createOptimisticStore = hydratedCreateOptimisticStore;
  _createRenderEffect = hydratedCreateRenderEffect;
  _createEffect = hydratedCreateEffect;

  _hydratingValue = sharedConfig.hydrating;
  _doneValue = sharedConfig.done;
  Object.defineProperty(sharedConfig, "hydrating", {
    get() {
      return _hydratingValue;
    },
    set(v: boolean) {
      const was = _hydratingValue;
      _hydratingValue = v;
      if (!was && v) {
        _hydrationDone = false;
        _doneValue = false;
        _pendingBoundaries = 0;
        setSnapshotCapture(true);
        _snapshotRootOwner = null;
      } else if (was && !v) {
        if (_snapshotRootOwner) {
          releaseSnapshotScope(_snapshotRootOwner);
          _snapshotRootOwner = null;
        }
        checkHydrationComplete();
      }
    },
    configurable: true,
    enumerable: true
  });
  Object.defineProperty(sharedConfig, "done", {
    get() {
      return _doneValue;
    },
    set(v: boolean) {
      _doneValue = v;
      if (v) drainHydrationCallbacks();
    },
    configurable: true,
    enumerable: true
  });
}

// Wrapped primitives — delegate to override or core

/**
 * Creates a readonly derived reactive memoized signal.
 *
 * `compute(prev)` runs reactively — every reactive read inside it is
 * tracked, and the returned value becomes the memo's current value.
 * The memo is cached: it only recomputes when one of its tracked
 * sources changes.
 *
 * ```ts
 * const value = createMemo<T>(compute, options?: MemoOptions<T>);
 * ```
 *
 * @example
 * ```ts
 * const [first, setFirst] = createSignal("Ada");
 * const [last, setLast] = createSignal("Lovelace");
 *
 * const fullName = createMemo(() => `${first()} ${last()}`);
 *
 * fullName(); // "Ada Lovelace"
 * ```
 *
 * @example
 * ```ts
 * // Async memo — reads suspend inside <Loading>
 * const user = createMemo(async () => {
 *   const res = await fetch(`/users/${id()}`);
 *   return res.json();
 * });
 * ```
 *
 * **Hydration:** `MemoOptions` accepts an `ssrSource` field
 * (`"server"` | `"hybrid"` | `"client"`) that controls what initial
 * value the client uses and whether `compute` re-runs. See
 * {@link HydrationSsrFields}.
 *
 * @param compute receives the previous value, returns the new value
 * @param options `MemoOptions` — `id`, `name`, `equals`, `unobserved`,
 *   `lazy`, `transparent`, `ssrSource`
 *
 * @description https://docs.solidjs.com/reference/basic-reactivity/create-memo
 */
export const createMemo: {
  <T>(
    compute: ComputeFunction<undefined | NoInfer<T>, T>,
    options: HydrationClientMemoOptions<T>
  ): Accessor<T | undefined>;
  <T>(
    compute: ComputeFunction<undefined | NoInfer<T>, T>,
    options?: HydrationMemoOptions<T>
  ): Accessor<T>;
} = ((...args: any[]) => (_createMemo || coreMemo)(...args)) as any;

/**
 * Creates a simple reactive state with a getter and setter.
 *
 * - **Plain form** — `createSignal(value, options?: SignalOptions<T>)`:
 *   stores a value; the setter writes a new value or applies an
 *   updater `(prev) => next`.
 * - **Function form (writable memo)** —
 *   `createSignal(fn, options?: SignalOptions<T> & MemoOptions<T>)`:
 *   the value is computed by `fn` like a memo, but the setter can
 *   locally override it (useful for optimistic edits over a derived
 *   default).
 *
 * ```ts
 * // Plain
 * const [count, setCount] = createSignal(0);
 *
 * count();              // 0
 * setCount(1);          // explicit value
 * setCount(c => c + 1); // updater
 *
 * // Writable memo: starts as `fn()`, can be locally overwritten.
 * const [user, setUser] = createSignal(() => fetchUser(userId()));
 * setUser({ ...user(), name: "Alice" }); // optimistic local edit
 * ```
 *
 * **Hydration:** in the function form, `SignalOptions & MemoOptions`
 * accepts an `ssrSource` field (`"server"` | `"hybrid"` | `"client"`)
 * that controls what initial value the client uses and whether `fn`
 * re-runs. See {@link HydrationSsrFields}.
 *
 * @returns `[state: Accessor<T>, setState: Setter<T>]`
 *
 * @description https://docs.solidjs.com/reference/basic-reactivity/create-signal
 */
export const createSignal: {
  <T>(): Signal<T | undefined>;
  <T>(value: Exclude<T, Function>, options?: SignalOptions<T>): Signal<T>;
  <T>(
    fn: ComputeFunction<undefined | NoInfer<T>, T>,
    options: HydrationClientSignalOptions<T>
  ): Signal<T | undefined>;
  <T>(
    fn: ComputeFunction<undefined | NoInfer<T>, T>,
    options?: HydrationSignalOptions<T>
  ): Signal<T>;
} = ((...args: any[]) => (_createSignal || coreSignal)(...args)) as any;

/**
 * Lower-level primitive that backs the `<Errored>` flow control.
 * Catches errors thrown inside `fn` and renders `fallback(error,
 * reset)` instead. `reset()` recomputes the failing sources so the
 * boundary can attempt to recover.
 *
 * App code should use `<Errored fallback={...}>` directly — reach for
 * this only when authoring a custom boundary component.
 *
 * **Hydration:** if the server serialized an error for this boundary,
 * the client re-throws it on the first hydration pass so `fallback`
 * renders the same content the server emitted.
 */
export const createErrorBoundary: typeof coreErrorBoundary = ((...args: any[]) =>
  (_createErrorBoundary || coreErrorBoundary)(...args)) as typeof coreErrorBoundary;

/**
 * Creates an optimistic signal — a `Signal<T>` whose writes are
 * tentative inside an `action` transition: they show up immediately,
 * then auto-revert (or reconcile to the action's resolved value) once
 * the transition settles.
 *
 * Use this for single-value optimistic state. For collection-shaped
 * state, prefer `createOptimisticStore`.
 *
 * - **Plain form** — `createOptimistic(value, options?: SignalOptions<T>)`.
 * - **Function form** — `createOptimistic(fn, options?: SignalOptions<T> & MemoOptions<T>)`:
 *   the authoritative value is recomputed by `fn`; the optimistic
 *   overlay reverts after each transition.
 *
 * @example
 * ```ts
 * const [name, setName] = createOptimistic("Ada");
 *
 * const rename = action(function* (next: string) {
 *   setName(next);                 // optimistic
 *   yield api.rename(next);        // commits or reverts on settle
 * });
 * ```
 *
 * **Hydration:** in the function form, accepts an `ssrSource` field
 * (`"server"` | `"hybrid"` | `"client"`). See {@link HydrationSsrFields}.
 *
 * @returns `[state: Accessor<T>, setState: Setter<T>]`
 *
 * @description https://docs.solidjs.com/reference/basic-reactivity/create-optimistic-signal
 */
export const createOptimistic: {
  <T>(): Signal<T | undefined>;
  <T>(value: Exclude<T, Function>, options?: SignalOptions<T>): Signal<T>;
  <T>(
    fn: ComputeFunction<undefined | NoInfer<T>, T>,
    options: HydrationClientSignalOptions<T>
  ): Signal<T | undefined>;
  <T>(
    fn: ComputeFunction<undefined | NoInfer<T>, T>,
    options?: HydrationSignalOptions<T>
  ): Signal<T>;
} = ((...args: any[]) => (_createOptimistic || coreOptimistic)(...args)) as any;

/**
 * Creates a derived (projected) store — `createMemo` for stores. The
 * derive function receives a mutable draft and either mutates it in
 * place (canonical) or returns a new value. Either way the result is
 * reconciled against the previous draft by `options.key` (default
 * `"id"`), so surviving items keep their proxy identity — only
 * added/removed items are created/disposed.
 *
 * Returns the projected store directly (no setter — reads only).
 *
 * Reach for this when you want the structural-sharing / per-property
 * tracking of a store on top of a derived computation. For simple
 * read-only derivations, `createMemo` is lighter.
 *
 * @example
 * ```ts
 * // Mutation form — update individual fields on the draft.
 * const summary = createProjection<{ total: number; active: number }>(
 *   draft => {
 *     draft.total = users().length;
 *     draft.active = users().filter(u => u.active).length;
 *   },
 *   { total: 0, active: 0 }
 * );
 *
 * // Return form — produce a derived collection. Reconciled by `id`
 * // so each surviving user keeps the same store identity.
 * const activeUsers = createProjection<User[]>(
 *   () => allUsers().filter(u => u.active),
 *   []
 * );
 * ```
 *
 * **Hydration:** {@link HydrationProjectionOptions} adds `ssrSource`
 * (`"server"` | `"hybrid"` | `"client"`) for the same client-vs-server
 * tradeoffs as the other primitives. See {@link HydrationSsrFields}.
 */
export const createProjection: <T extends object = {}>(
  fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  initialValue: T,
  options?: HydrationProjectionOptions
) => Refreshable<Store<T>> = ((...args: any[]) =>
  (_createProjection || coreProjection)(...args)) as any;

type NoFn<T> = T extends Function ? never : T;

/**
 * Creates a deeply-reactive store backed by a Proxy. Reads track each
 * property accessed; only the parts that change trigger updates.
 *
 * Store properties hold **plain values**, not accessors. The proxy
 * already tracks reads per-property — wrapping a value in
 * `() => state.foo` produces a getter that *won't* track when called,
 * which looks like a reactivity bug but is just a category error. If
 * you have a signal-shaped piece of state, make it a property of the
 * store (`{ foo: 1 }`) rather than nesting an accessor inside
 * (`{ foo: () => signal() }`).
 *
 * The setter takes a **draft-mutating** function — mutate the draft
 * in place (canonical). The callback may also return a new value:
 * arrays are replaced by index (length adjusted), objects are
 * shallow-diffed at the top level (keys present in the returned value
 * are written, missing keys deleted). Use the return form for shapes
 * where mutation is awkward — most commonly removing items via
 * `filter`. The setter does **not** do keyed reconciliation; for
 * that, use the derived/projection form (or `createProjection`).
 *
 * - **Plain form** — `createStore(initialValue)`: wraps a value in a
 *   reactive proxy.
 * - **Derived form** — `createStore(fn, seed, options?)`: a
 *   *projection store* whose contents are computed by `fn(draft)`.
 *   `fn` may be sync, async, or an `AsyncIterable`; the projection's
 *   result reconciles against the existing store by `options.key`
 *   (default `"id"`) for stable identity.
 *
 * @example
 * ```ts
 * const [state, setState] = createStore({
 *   user: { name: "Ada", age: 36 },
 *   todos: [] as { id: string; text: string; done: boolean }[]
 * });
 *
 * // Canonical: mutate the draft in place.
 * setState(s => { s.user.age = 37; });
 * setState(s => { s.todos.push({ id: "1", text: "x", done: false }); });
 *
 * // Return form: reach for it when mutation is awkward.
 * setState(s => s.todos.filter(t => !t.done));               // remove items
 * setState(s => ({ ...s, user: { name: "Grace", age: 85 } })); // shallow replace
 * ```
 *
 * @example
 * ```ts
 * // Derived store — auto-fetches & reconciles by `id`.
 * const [users] = createStore(
 *   async () => fetch("/users").then(r => r.json()),
 *   [] as User[]
 * );
 * ```
 *
 * **Hydration:** the derived form accepts
 * {@link HydrationProjectionOptions}, which adds an `ssrSource` field
 * (`"server"` | `"hybrid"` | `"client"`). See {@link HydrationSsrFields}.
 *
 * @returns `[store: Store<T>, setStore: StoreSetter<T>]`
 */
export const createStore: {
  <T extends object = {}>(store: NoFn<T> | Store<NoFn<T>>): [get: Store<T>, set: StoreSetter<T>];
  <T extends object = {}>(
    fn: (store: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
    store: NoFn<T> | Store<NoFn<T>>,
    options?: HydrationProjectionOptions
  ): [get: Refreshable<Store<T>>, set: StoreSetter<T>];
} = ((...args: any[]) => (_createStore || coreStore)(...args)) as any;

/**
 * The store equivalent of `createOptimistic`. Writes inside an
 * `action` transition are tentative — they show up immediately but
 * auto-revert (or reconcile to the action's resolved value) once the
 * transition finishes.
 *
 * Use this for optimistic UI on collection-shaped data. For
 * single-value optimistic state, prefer `createOptimistic`.
 *
 * - **Plain form** — `createOptimisticStore(initialValue)`.
 * - **Derived form** — `createOptimisticStore(fn, seed, options?)`:
 *   a projection store whose authoritative value is recomputed by
 *   `fn` and whose optimistic overlay reverts after each transition.
 *
 * `options.key` defaults to `"id"`; specify it only when your data
 * uses a different identity field (e.g. `{ key: "uuid" }` or
 * `{ key: t => t.slug }`). Restating the default just adds noise.
 *
 * @example
 * ```ts
 * const [todos, setTodos] = createOptimisticStore<Todo[]>([]);
 *
 * // Mutation: optimistic add, then in-place reconcile to the saved row.
 * const addTodo = action(function* (text: string) {
 *   const tempId = crypto.randomUUID();
 *   setTodos(t => { t.push({ id: tempId, text, pending: true }); });
 *   const saved = yield api.createTodo(text);
 *   setTodos(t => {
 *     const i = t.findIndex(x => x.id === tempId);
 *     if (i >= 0) t[i] = saved;
 *   });
 * });
 *
 * // Return form: filter is the natural shape for removal.
 * const removeTodo = action(function* (id: string) {
 *   setTodos(t => t.filter(x => x.id !== id));
 *   yield api.removeTodo(id);
 * });
 * ```
 *
 * **Hydration:** the derived form accepts
 * {@link HydrationProjectionOptions}, which adds an `ssrSource` field
 * (`"server"` | `"hybrid"` | `"client"`). See {@link HydrationSsrFields}.
 *
 * @returns `[store: Store<T>, setStore: StoreSetter<T>]`
 */
export const createOptimisticStore: {
  <T extends object = {}>(store: NoFn<T> | Store<NoFn<T>>): [get: Store<T>, set: StoreSetter<T>];
  <T extends object = {}>(
    fn: (store: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
    store: NoFn<T> | Store<NoFn<T>>,
    options?: HydrationProjectionOptions
  ): [get: Refreshable<Store<T>>, set: StoreSetter<T>];
} = ((...args: any[]) => (_createOptimisticStore || coreOptimisticStore)(...args)) as any;

/**
 * Creates a reactive computation that runs during the render phase as
 * DOM elements are created and updated but not necessarily connected.
 *
 * Same compute/effect split as `createEffect` (`compute(prev)` tracks,
 * `effect(next, prev?)` runs imperatively), but scheduled inside the
 * render queue rather than after it. Reach for this only when
 * authoring renderer plumbing — app code should use `createEffect`.
 *
 * ```ts
 * createRenderEffect<T>(compute, effectFn, options?: EffectOptions);
 * ```
 *
 * **Hydration:** `EffectOptions` accepts an `ssrSource` field
 * (`"server"` | `"hybrid"` | `"client"`). See {@link HydrationSsrFields}.
 *
 * @description https://docs.solidjs.com/reference/secondary-primitives/create-render-effect
 */
export const createRenderEffect: typeof coreRenderEffect = ((...args: any[]) =>
  (_createRenderEffect || coreRenderEffect)(...args)) as typeof coreRenderEffect;

/**
 * Creates a reactive effect with **separate compute and effect phases**.
 *
 * - `compute(prev)` runs reactively — *put all reactive reads here*.
 *   The returned value is passed to `effect` and is also the new
 *   "previous" value for the next run.
 * - `effect(next, prev?)` runs imperatively (untracked) after the
 *   queue flushes. *Put DOM writes / fetch / logging / subscriptions
 *   here.* It may return a cleanup function which runs before the
 *   next effect or on disposal.
 *
 * Reactive reads inside `effect` will *not* re-trigger this effect —
 * that's intentional. If you need a single-phase tracked effect, use
 * `createTrackedEffect` (with the tradeoffs noted there).
 *
 * Pass an `EffectBundle` (`{ effect, error }`) instead of a plain
 * function to intercept errors thrown from the compute or effect
 * phases.
 *
 * ```ts
 * createEffect<T>(compute, effectFn | { effect, error }, options?: EffectOptions);
 * ```
 *
 * @example
 * ```ts
 * const [count, setCount] = createSignal(0);
 *
 * createEffect(
 *   () => count(),                  // compute: tracks `count`
 *   value => console.log(value)     // effect: side effect
 * );
 *
 * setCount(1); // logs 1 after the next flush
 * ```
 *
 * @example
 * ```ts
 * createEffect(
 *   () => userId(),
 *   id => {
 *     const ctrl = new AbortController();
 *     fetch(`/users/${id}`, { signal: ctrl.signal });
 *     return () => ctrl.abort(); // cleanup before next run / disposal
 *   }
 * );
 * ```
 *
 * **Hydration:** `EffectOptions` accepts an `ssrSource` field
 * (`"server"` | `"hybrid"` | `"client"`). See {@link HydrationSsrFields}.
 *
 * @description https://docs.solidjs.com/reference/basic-reactivity/create-effect
 */
export const createEffect: typeof coreEffect = ((...args: any[]) =>
  (_createEffect || coreEffect)(...args)) as typeof coreEffect;

// === Loading component ===
function createBoundaryTrigger(): () => void {
  setSnapshotCapture(false);
  const [s, set] = coreSignal(undefined, { equals: false });
  s();
  setSnapshotCapture(true);
  return set;
}

function resumeBoundaryHydration(o: Owner, id: string, set: () => void) {
  _pendingBoundaries--;
  if (isDisposed(o)) {
    checkHydrationComplete();
    return;
  }
  sharedConfig.gather?.(id);
  _hydratingValue = true;
  markSnapshotScope(o);
  _snapshotRootOwner = o;
  set();
  flush();
  _snapshotRootOwner = null;
  _hydratingValue = false;
  releaseSnapshotScope(o);
  flush();
  checkHydrationComplete();
}

function initBoundaryResume(o: Owner, id: string): [trigger: () => void, resume: () => void] {
  _pendingBoundaries++;
  onCleanup(() => {
    if (!isDisposed(o as Owner)) return;
    sharedConfig.cleanupFragment?.(id);
  });
  const set = createBoundaryTrigger();
  return [set, () => resumeBoundaryHydration(o, id, set)];
}

function waitAndResume(p: any, resume: () => void, assetPromise?: Promise<void>) {
  const waitFor = assetPromise ? Promise.all([p, assetPromise]) : p;
  waitFor.then(
    () => {
      if (p && typeof p === "object") p.s = 1;
      resume();
    },
    (err: any) => {
      if (p && typeof p === "object") {
        p.s = 2;
        p.v = err;
      }
      resume();
    }
  );
}

function scheduleResumeAfterAssets(
  id: string,
  resume: () => void,
  assetPromise?: Promise<void>
): boolean {
  sharedConfig.gather?.(id);
  const doResume = () => queueMicrotask(resume);
  if (assetPromise) {
    assetPromise.then(doResume);
    return true;
  }
  doResume();
  return false;
}

/**
 * Lower-level primitive that backs the `<Loading>` component. Returns a
 * computation that yields `fallback()` while async reads inside `fn` are
 * pending, and `fn()` once they have settled. Most callers should use
 * `<Loading>` directly; this is exposed for renderers and library authors.
 */
export function createLoadingBoundary(
  fn: () => any,
  fallback: () => any,
  options?: { on?: () => any }
): () => unknown {
  if (!sharedConfig.hydrating) return coreLoadingBoundary(fn, fallback, options);

  let settledSerializationResumeQueued = false;

  return coreMemo(() => {
    const o = getOwner()!;
    const id = o.id!;

    let assetPromise: Promise<void> | undefined;
    if (sharedConfig.hydrating && sharedConfig.has!(id + "_assets")) {
      const mapping = sharedConfig.load!(id + "_assets");
      if (mapping && typeof mapping === "object")
        assetPromise = sharedConfig.loadModuleAssets?.(mapping);
    }

    // Check boundary serialization key (sync SSR path: ctx.serialize(id, ...))
    if (sharedConfig.hydrating && sharedConfig.has!(id)) {
      const ref = sharedConfig.load!(id);
      let p: Promise<any> | any;
      if (ref) {
        if (typeof ref !== "object" || ref.s == null) p = ref;
        else if (ref.s === 1 || ref.s === 2) sharedConfig.gather?.(id);
        else p = ref;
      }
      if (
        ref &&
        typeof ref === "object" &&
        ref.s === 1 &&
        p == null &&
        !settledSerializationResumeQueued
      ) {
        settledSerializationResumeQueued = true;
        const [, resume] = initBoundaryResume(o, id);
        if (scheduleResumeAfterAssets(id, resume, assetPromise)) return undefined;
        return fallback();
      }
      if (p) {
        const [set, resume] = initBoundaryResume(o, id);
        if (p !== "$$f") {
          waitAndResume(p, resume, assetPromise);
        } else {
          const afterAssets = () => {
            _pendingBoundaries--;
            set();
            checkHydrationComplete();
          };
          if (assetPromise) assetPromise.then(() => queueMicrotask(afterAssets));
          else queueMicrotask(afterAssets);
        }
        return fallback();
      }
    }

    // Check fragment registration key (streaming SSR path: registerFragment sets id + "_fr")
    if (
      sharedConfig.hydrating &&
      sharedConfig.has!(id + "_fr") &&
      !settledSerializationResumeQueued
    ) {
      settledSerializationResumeQueued = true;
      const fr = sharedConfig.load!(id + "_fr");
      const [, resume] = initBoundaryResume(o, id);

      if (fr && typeof fr === "object" && (fr.s === 1 || fr.s === 2)) {
        if (scheduleResumeAfterAssets(id, resume, assetPromise)) return undefined;
        return fallback();
      }

      waitAndResume(fr, resume, assetPromise);
      return fallback();
    }

    if (assetPromise && !sharedConfig.has!(id)) {
      const [, resume] = initBoundaryResume(o, id);
      assetPromise.then(resume);
      return undefined;
    }
    return coreLoadingBoundary(fn, fallback, options);
  }) as unknown as () => unknown;
}

/**
 * Disables hydration for its children on the client.
 * During hydration, skips the subtree entirely (returns undefined so DOM is left untouched).
 * After hydration, renders children fresh.
 */
export function NoHydration(props: { children: JSX.Element }): JSX.Element {
  const o = createOwner();
  return runWithOwner(o, () => {
    setContext(NoHydrateContext, true);
    if (sharedConfig.hydrating) return undefined as unknown as JSX.Element;
    return props.children;
  }) as unknown as JSX.Element;
}

/**
 * Re-enables hydration within a NoHydration zone (passthrough on client).
 */
export function Hydration(props: { id?: string; children: JSX.Element }): JSX.Element {
  return props.children as unknown as JSX.Element;
}
