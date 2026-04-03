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
  $REFRESH,
  type Owner,
  type ProjectionOptions,
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
  deferStream?: boolean;
  ssrSource?: "server" | "hybrid" | "initial" | "client";
};
declare module "@solidjs/signals" {
  interface MemoOptions<T> extends HydrationSsrFields {}
  interface SignalOptions<T> extends HydrationSsrFields {}
  interface EffectOptions extends HydrationSsrFields {}
}

export type HydrationProjectionOptions = ProjectionOptions & {
  ssrSource?: "server" | "hybrid" | "initial" | "client";
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

function hydrateSignalFromAsyncIterable(
  coreFn: Function,
  compute: any,
  value: any,
  options: any
): any {
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
  return coreFn(() => iterable, value, options);
}

function hydrateStoreFromAsyncIterable(coreFn: Function, initialValue: any, options: any): any {
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
      const process = (res: any) => {
        if (res.done) return { done: true, value: undefined };
        if (isFirst) {
          isFirst = false;
          if (Array.isArray(res.value)) {
            for (let i = 0; i < res.value.length; i++) draft[i] = res.value[i];
            draft.length = res.value.length;
          } else {
            Object.assign(draft, res.value);
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

function hydratedCreateMemo(compute: any, value?: any, options?: any) {
  if (!sharedConfig.hydrating || options?.transparent) {
    return coreMemo(compute, value, options);
  }
  markTopLevelSnapshotScope();

  const ssrSource = options?.ssrSource;

  if (ssrSource === "client") {
    const [hydrated, setHydrated] = coreSignal(false, { pureWrite: true });
    const memo = coreMemo(
      (prev: any) => {
        if (!hydrated()) return prev ?? value;
        return compute(prev);
      },
      value,
      options
    );
    setHydrated(true);
    return memo;
  }

  if (ssrSource === "initial") {
    return coreMemo(
      (prev: any) => {
        if (!sharedConfig.hydrating) return compute(prev);
        subFetch(compute, prev);
        return prev ?? value;
      },
      value,
      options
    );
  }

  // "server", "hybrid", or undefined — use serialized value from server
  const aiResult = hydrateSignalFromAsyncIterable(coreMemo, compute, value, options);
  if (aiResult !== null) return aiResult;

  return coreMemo((prev: any) => readSerializedOrCompute(compute, prev), value, options);
}

function hydratedCreateSignal(fn?: any, second?: any, third?: any) {
  if (typeof fn !== "function" || !sharedConfig.hydrating) return coreSignal(fn, second, third);
  markTopLevelSnapshotScope();

  const ssrSource = third?.ssrSource;

  if (ssrSource === "client") {
    const [hydrated, setHydrated] = coreSignal(false, { pureWrite: true });
    const sig = coreSignal(
      (prev: any) => {
        if (!hydrated()) return prev ?? second;
        return fn(prev);
      },
      second,
      third
    );
    setHydrated(true);
    return sig;
  }

  if (ssrSource === "initial") {
    return coreSignal(
      (prev: any) => {
        if (!sharedConfig.hydrating) return fn(prev);
        subFetch(fn, prev);
        return prev ?? second;
      },
      second,
      third
    );
  }

  // "server", "hybrid", or undefined
  const aiResult = hydrateSignalFromAsyncIterable(coreSignal, fn, second, third);
  if (aiResult !== null) return aiResult;

  return coreSignal((prev: any) => readSerializedOrCompute(fn, prev), second, third);
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

function hydratedCreateOptimistic(fn?: any, second?: any, third?: any) {
  if (typeof fn !== "function" || !sharedConfig.hydrating) return coreOptimistic(fn, second, third);
  markTopLevelSnapshotScope();

  const ssrSource = third?.ssrSource;

  if (ssrSource === "client") {
    const [hydrated, setHydrated] = coreSignal(false, { pureWrite: true });
    const sig = coreOptimistic(
      (prev: any) => {
        if (!hydrated()) return prev ?? second;
        return fn(prev);
      },
      second,
      third
    );
    setHydrated(true);
    return sig;
  }

  if (ssrSource === "initial") {
    return coreOptimistic(
      (prev: any) => {
        if (!sharedConfig.hydrating) return fn(prev);
        subFetch(fn, prev);
        return prev ?? second;
      },
      second,
      third
    );
  }

  // "server", "hybrid", or undefined
  const aiResult = hydrateSignalFromAsyncIterable(coreOptimistic, fn, second, third);
  if (aiResult !== null) return aiResult;

  return coreOptimistic((prev: any) => readSerializedOrCompute(fn, prev), second, third);
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
    const [hydrated, setHydrated] = coreSignal(false, { pureWrite: true });
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
    const [hydrated, setHydrated] = coreSignal(false, { pureWrite: true });
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
  const aiResult = hydrateStoreFromAsyncIterable(coreFn, initialValue, options);
  if (aiResult !== null) return aiResult;
  return coreFn(wrapStoreFn(fn), initialValue, options);
}

function hydratedCreateStore(first?: any, second?: any, third?: any) {
  if (typeof first !== "function" || !sharedConfig.hydrating)
    return coreStore(first, second, third);
  markTopLevelSnapshotScope();
  const ssrSource = third?.ssrSource;
  if (ssrSource === "initial") return coreStore(second ?? {}, undefined, third);
  return hydrateStoreLikeFn(coreStore, first, second ?? {}, third, ssrSource);
}

function hydratedCreateOptimisticStore(first?: any, second?: any, third?: any) {
  if (typeof first !== "function" || !sharedConfig.hydrating)
    return coreOptimisticStore(first, second, third);
  markTopLevelSnapshotScope();
  const ssrSource = third?.ssrSource;
  if (ssrSource === "initial") return coreOptimisticStore(second ?? {}, undefined, third);
  return hydrateStoreLikeFn(coreOptimisticStore, first, second ?? {}, third, ssrSource);
}

function hydratedCreateProjection(fn: any, initialValue?: any, options?: any) {
  if (!sharedConfig.hydrating) return coreProjection(fn, initialValue, options);
  markTopLevelSnapshotScope();
  const ssrSource = options?.ssrSource;
  if (ssrSource === "initial") return coreProjection((draft: any) => draft, initialValue, options);
  return hydrateStoreLikeFn(coreProjection, fn, initialValue, options, ssrSource);
}

// --- Hydration-aware effect implementations ---

function hydratedEffect(coreFn: Function, compute: any, effectFn: any, value?: any, options?: any) {
  if (!sharedConfig.hydrating) return coreFn(compute, effectFn, value, options);

  const ssrSource = options?.ssrSource;

  if (ssrSource === "client") {
    const [hydrated, setHydrated] = coreSignal(false, { pureWrite: true });
    let active = false;
    coreFn(
      (prev: any) => {
        if (!hydrated()) return value;
        active = true;
        return compute(prev);
      },
      (next: any, prev: any) => {
        if (!active) return;
        return effectFn(next, prev);
      },
      value,
      options
    );
    setHydrated(true);
    return;
  }

  if (ssrSource === "initial") {
    coreFn(
      (prev: any) => {
        if (!sharedConfig.hydrating) return compute(prev);
        subFetch(compute, prev);
        return prev ?? value;
      },
      effectFn,
      value,
      options
    );
    return;
  }

  // "server", "hybrid", or undefined — use serialized value from server
  markTopLevelSnapshotScope();
  coreFn((prev: any) => readSerializedOrCompute(compute, prev), effectFn, value, options);
}

function hydratedCreateRenderEffect(compute: any, effectFn: any, value?: any, options?: any) {
  return hydratedEffect(coreRenderEffect, compute, effectFn, value, options);
}

function hydratedCreateEffect(compute: any, effectFn: any, value?: any, options?: any) {
  return hydratedEffect(coreEffect, compute, effectFn, value, options);
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
export const createMemo: typeof coreMemo = ((...args: any[]) =>
  (_createMemo || coreMemo)(...args)) as typeof coreMemo;

export const createSignal: typeof coreSignal = ((...args: any[]) =>
  (_createSignal || coreSignal)(...args)) as typeof coreSignal;

export const createErrorBoundary: typeof coreErrorBoundary = ((...args: any[]) =>
  (_createErrorBoundary || coreErrorBoundary)(...args)) as typeof coreErrorBoundary;

export const createOptimistic: typeof coreOptimistic = ((...args: any[]) =>
  (_createOptimistic || coreOptimistic)(...args)) as typeof coreOptimistic;

export const createProjection: <T extends object = {}>(
  fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  initialValue?: T,
  options?: HydrationProjectionOptions
) => Store<T> & { [$REFRESH]: any } = ((...args: any[]) =>
  (_createProjection || coreProjection)(...args)) as any;

type NoFn<T> = T extends Function ? never : T;

export const createStore: {
  <T extends object = {}>(store: NoFn<T> | Store<NoFn<T>>): [get: Store<T>, set: StoreSetter<T>];
  <T extends object = {}>(
    fn: (store: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
    store?: NoFn<T> | Store<NoFn<T>>,
    options?: HydrationProjectionOptions
  ): [get: Store<T> & { [$REFRESH]: any }, set: StoreSetter<T>];
} = ((...args: any[]) => (_createStore || coreStore)(...args)) as any;

export const createOptimisticStore: {
  <T extends object = {}>(store: NoFn<T> | Store<NoFn<T>>): [get: Store<T>, set: StoreSetter<T>];
  <T extends object = {}>(
    fn: (store: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
    store?: NoFn<T> | Store<NoFn<T>>,
    options?: HydrationProjectionOptions
  ): [get: Store<T> & { [$REFRESH]: any }, set: StoreSetter<T>];
} = ((...args: any[]) => (_createOptimisticStore || coreOptimisticStore)(...args)) as any;

export const createRenderEffect: typeof coreRenderEffect = ((...args: any[]) =>
  (_createRenderEffect || coreRenderEffect)(...args)) as typeof coreRenderEffect;

export const createEffect: typeof coreEffect = ((...args: any[]) =>
  (_createEffect || coreEffect)(...args)) as typeof coreEffect;

// === Module asset loading ===

function loadModuleAssets(mapping: Record<string, string>): Promise<void> | undefined {
  const hy = (globalThis as any)._$HY;
  if (!hy) return;
  if (!hy.modules) hy.modules = {};
  if (!hy.loading) hy.loading = {};
  const pending: Promise<void>[] = [];
  for (const moduleUrl in mapping) {
    if (hy.modules[moduleUrl]) continue;
    const entryUrl = mapping[moduleUrl];
    if (!hy.loading[moduleUrl]) {
      hy.loading[moduleUrl] = import(/* @vite-ignore */ entryUrl).then(mod => {
        hy.modules[moduleUrl] = mod;
      });
    }
    pending.push(hy.loading[moduleUrl]);
  }
  return pending.length ? Promise.all(pending).then(() => {}) : undefined;
}

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

/**
 * Tracks all resources inside a component and renders a fallback until they are all resolved
 * ```typescript
 * const AsyncComponent = lazy(() => import('./component'));
 *
 * <Loading fallback={<LoadingIndicator />}>
 *   <AsyncComponent />
 * </Loading>
 * ```
 * @description https://docs.solidjs.com/reference/components/suspense
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
      if (mapping && typeof mapping === "object") assetPromise = loadModuleAssets(mapping);
    }

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
        _pendingBoundaries++;
        onCleanup(() => {
          if (!isDisposed(o as Owner)) return;
          sharedConfig.cleanupFragment?.(id);
        });
        const set = createBoundaryTrigger();
        const scheduleResume = () => queueMicrotask(() => resumeBoundaryHydration(o, id, set));
        if (assetPromise) {
          assetPromise.then(scheduleResume);
          return undefined;
        }
        scheduleResume();
        return fallback();
      }
      if (p) {
        _pendingBoundaries++;
        onCleanup(() => {
          if (!isDisposed(o as Owner)) return;
          sharedConfig.cleanupFragment?.(id);
        });
        const set = createBoundaryTrigger();
        if (p !== "$$f") {
          const waitFor = assetPromise ? Promise.all([p, assetPromise]) : p;
          waitFor.then(
            () => {
              if (p && typeof p === "object") {
                p.s = 1;
              }
              resumeBoundaryHydration(o, id, set);
            },
            (err: any) => {
              if (p && typeof p === "object") {
                p.s = 2;
                p.v = err;
              }
              resumeBoundaryHydration(o, id, set);
            }
          );
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
    if (assetPromise && !sharedConfig.has!(id)) {
      _pendingBoundaries++;
      const set = createBoundaryTrigger();
      assetPromise.then(() => resumeBoundaryHydration(o, id, set));
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
