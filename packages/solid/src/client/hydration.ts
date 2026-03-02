import {
  getOwner,
  createLoadBoundary,
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
  type Owner,
  type ProjectionOptions,
  type Store,
  type StoreSetter
} from "@solidjs/signals";
import { JSX } from "../jsx.js";
import { IS_DEV } from "./core.js";

declare module "@solidjs/signals" {
  interface MemoOptions<T> {
    deferStream?: boolean;
    ssrSource?: "server" | "hybrid" | "initial" | "client";
  }
  interface SignalOptions<T> {
    deferStream?: boolean;
    ssrSource?: "server" | "hybrid" | "initial" | "client";
  }
  interface EffectOptions {
    deferStream?: boolean;
    ssrSource?: "server" | "hybrid" | "initial" | "client";
  }
}

export type HydrationProjectionOptions = ProjectionOptions & {
  ssrSource?: "server" | "hybrid" | "initial" | "client";
};

export type HydrationContext = {};

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
  static all() {
    return new MockPromise();
  }
  static allSettled() {
    return new MockPromise();
  }
  static any() {
    return new MockPromise();
  }
  static race() {
    return new MockPromise();
  }
  static reject() {
    return new MockPromise();
  }
  static resolve() {
    return new MockPromise();
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

function consumeFirstSync(ai: any): [any, AsyncIterator<any>] {
  const iter = ai[Symbol.asyncIterator]();
  const r = iter.next();
  const value = !(r instanceof Promise) && !r.done ? r.value : undefined;
  return [value, iter];
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

function scheduleIteratorConsumption(iter: AsyncIterator<any>, apply: (value: any) => void) {
  const consume = () => {
    while (true) {
      const n: any = iter.next();
      if (n instanceof Promise) {
        n.then((r: any) => {
          if (r.done) return;
          apply(r.value);
          consume();
        });
        return;
      }
      if (n.done) break;
      apply(n.value);
    }
  };
  consume();
}

function isAsyncIterable(v: any): boolean {
  return v != null && typeof v[Symbol.asyncIterator] === "function";
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
  const initP = sharedConfig.load!(expectedId);
  if (!isAsyncIterable(initP)) return null;

  const [firstValue, iter] = consumeFirstSync(initP);
  const [get, set] = coreSignal(firstValue);
  const result = coreFn(() => get(), firstValue, options);
  scheduleIteratorConsumption(iter, (v: any) => {
    set(() => v);
    flush();
  });
  return result;
}

function hydrateStoreFromAsyncIterable(coreFn: Function, initialValue: any, options: any): any {
  const parent = getOwner()!;
  const expectedId = peekNextChildId(parent);
  if (!sharedConfig.has!(expectedId)) return null;
  const initP = sharedConfig.load!(expectedId);
  if (!isAsyncIterable(initP)) return null;

  const [firstState, iter] = consumeFirstSync(initP);
  const [store, setStore] = coreFn(() => {}, firstState ?? initialValue, options);
  scheduleIteratorConsumption(iter, (patches: any) => {
    setStore((d: any) => {
      applyPatches(d, patches);
    });
  });
  return [store, setStore];
}

// --- Hydration-aware implementations ---

function hydratedCreateMemo(compute: any, value?: any, options?: any) {
  if (!sharedConfig.hydrating) return coreMemo(compute, value, options);
  markTopLevelSnapshotScope();

  const ssrSource = options?.ssrSource;

  if (ssrSource === "client") {
    const [hydrated, setHydrated] = coreSignal(false);
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

  return coreMemo(
    (prev: any) => {
      const o = getOwner()!;
      if (!sharedConfig.hydrating) return compute(prev);
      let initP: any;
      if (sharedConfig.has!(o.id!)) initP = sharedConfig.load!(o.id!);
      const init = initP?.v ?? initP;
      return init != null ? (subFetch(compute, prev), init) : compute(prev);
    },
    value,
    options
  );
}

function hydratedCreateSignal(fn?: any, second?: any, third?: any) {
  if (typeof fn !== "function" || !sharedConfig.hydrating) return coreSignal(fn, second, third);
  markTopLevelSnapshotScope();

  const ssrSource = third?.ssrSource;

  if (ssrSource === "client") {
    const [hydrated, setHydrated] = coreSignal(false);
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

  return coreSignal(
    (prev: any) => {
      if (!sharedConfig.hydrating) return fn(prev);
      const o = getOwner()!;
      let initP: any;
      if (sharedConfig.has!(o.id!)) initP = sharedConfig.load!(o.id!);
      const init = initP?.v ?? initP;
      return init != null ? (subFetch(fn, prev), init) : fn(prev);
    },
    second,
    third
  );
}

function hydratedCreateErrorBoundary<U>(
  fn: () => any,
  fallback: (error: unknown, reset: () => void) => U
): () => unknown {
  if (!sharedConfig.hydrating) return coreErrorBoundary(fn, fallback);
  markTopLevelSnapshotScope();
  // The server's createErrorBoundary creates an owner via createOwner() and
  // serializes caught errors at that owner's ID. Peek at what ID the boundary
  // owner will get (without consuming the counter slot), then check sharedConfig.
  const parent = getOwner()!;
  const expectedId = peekNextChildId(parent);
  if (sharedConfig.has!(expectedId)) {
    const err = sharedConfig.load!(expectedId);
    if (err !== undefined) {
      // Server had an error — use throw-once pattern so reset() can recover.
      // First call throws the serialized error (matching server state).
      // On reset, recompute runs the wrapper again with hydrated=false,
      // so the real fn() executes and children render fresh.
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
    const [hydrated, setHydrated] = coreSignal(false);
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

  return coreOptimistic(
    (prev: any) => {
      const o = getOwner()!;
      if (!sharedConfig.hydrating) return fn(prev);
      let initP: any;
      if (sharedConfig.has!(o.id!)) initP = sharedConfig.load!(o.id!);
      const init = initP?.v ?? initP;
      return init != null ? (subFetch(fn, prev), init) : fn(prev);
    },
    second,
    third
  );
}

function wrapStoreFn(fn: any, ssrSource?: string) {
  if (ssrSource === "initial") {
    return (draft: any) => {
      if (!sharedConfig.hydrating) return fn(draft);
      subFetch(fn, draft);
      return undefined;
    };
  }
  // "server", "hybrid", or undefined
  return (draft: any) => {
    const o = getOwner()!;
    if (!sharedConfig.hydrating) return fn(draft);
    let initP: any;
    if (sharedConfig.has!(o.id!)) initP = sharedConfig.load!(o.id!);
    const init = initP?.v ?? initP;
    return init != null ? (subFetch(fn, draft), init) : fn(draft);
  };
}

function hydratedCreateStore(first?: any, second?: any, third?: any) {
  if (typeof first !== "function" || !sharedConfig.hydrating)
    return coreStore(first, second, third);
  markTopLevelSnapshotScope();
  const ssrSource = third?.ssrSource;
  if (ssrSource === "client" || ssrSource === "initial") {
    return coreStore(second ?? {}, undefined, third);
  }

  const aiResult = hydrateStoreFromAsyncIterable(coreStore, second ?? {}, third);
  if (aiResult !== null) return aiResult;

  return coreStore(wrapStoreFn(first, ssrSource), second, third);
}

function hydratedCreateOptimisticStore(first?: any, second?: any, third?: any) {
  if (typeof first !== "function" || !sharedConfig.hydrating)
    return coreOptimisticStore(first, second, third);
  markTopLevelSnapshotScope();
  const ssrSource = third?.ssrSource;
  if (ssrSource === "client" || ssrSource === "initial") {
    return coreOptimisticStore(second ?? {}, undefined, third);
  }

  const aiResult = hydrateStoreFromAsyncIterable(coreOptimisticStore, second ?? {}, third);
  if (aiResult !== null) return aiResult;

  return coreOptimisticStore(wrapStoreFn(first, ssrSource), second, third);
}

function hydratedCreateProjection(fn: any, initialValue?: any, options?: any) {
  if (!sharedConfig.hydrating) return coreProjection(fn, initialValue, options);
  markTopLevelSnapshotScope();
  const ssrSource = options?.ssrSource;
  if (ssrSource === "client" || ssrSource === "initial") {
    return coreProjection((draft: any) => draft, initialValue, options);
  }

  const aiResult = hydrateStoreFromAsyncIterable(coreStore, initialValue, options);
  if (aiResult !== null) return aiResult[0];

  return coreProjection(wrapStoreFn(fn, ssrSource), initialValue, options);
}

// --- Hydration-aware effect implementations ---

function hydratedEffect(coreFn: Function, compute: any, effectFn: any, value?: any, options?: any) {
  if (!sharedConfig.hydrating) return coreFn(compute, effectFn, value, options);

  const ssrSource = options?.ssrSource;

  if (ssrSource === "client") {
    const [hydrated, setHydrated] = coreSignal(false);
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
  coreFn(
    (prev: any) => {
      const o = getOwner()!;
      if (!sharedConfig.hydrating) return compute(prev);
      let initP: any;
      if (sharedConfig.has!(o.id!)) initP = sharedConfig.load!(o.id!);
      const init = initP?.v ?? initP;
      return init != null ? (subFetch(compute, prev), init) : compute(prev);
    },
    effectFn,
    value,
    options
  );
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

  // Install property interceptors for hydration lifecycle tracking.
  // When dom-expressions' hydrate() sets hydrating = false after the sync walk,
  // or when event-handler cancellation sets done = true, we detect it and
  // drain onHydrationEnd callbacks at the right time.
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
) => Store<T> = ((...args: any[]) => (_createProjection || coreProjection)(...args)) as any;

type NoFn<T> = T extends Function ? never : T;

export const createStore: {
  <T extends object = {}>(store: NoFn<T> | Store<NoFn<T>>): [get: Store<T>, set: StoreSetter<T>];
  <T extends object = {}>(
    fn: (store: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
    store?: NoFn<T> | Store<NoFn<T>>,
    options?: HydrationProjectionOptions
  ): [get: Store<T>, set: StoreSetter<T>];
} = ((...args: any[]) => (_createStore || coreStore)(...args)) as any;

export const createOptimisticStore: {
  <T extends object = {}>(store: NoFn<T> | Store<NoFn<T>>): [get: Store<T>, set: StoreSetter<T>];
  <T extends object = {}>(
    fn: (store: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
    store?: NoFn<T> | Store<NoFn<T>>,
    options?: HydrationProjectionOptions
  ): [get: Store<T>, set: StoreSetter<T>];
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
  sharedConfig.gather!(id);
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
export function Loading(props: { fallback?: JSX.Element; children: JSX.Element }): JSX.Element {
  if (!sharedConfig.hydrating)
    return createLoadBoundary(
      () => props.children,
      () => props.fallback
    ) as unknown as JSX.Element;

  return coreMemo(() => {
    const o = getOwner()!;
    const id = o.id!;

    let assetPromise: Promise<void> | undefined;
    if (sharedConfig.hydrating && sharedConfig.has!(id + "_assets")) {
      const mapping = sharedConfig.load!(id + "_assets");
      if (mapping && typeof mapping === "object") assetPromise = loadModuleAssets(mapping);
    }

    if (sharedConfig.hydrating && sharedConfig.has!(id)) {
      let ref = sharedConfig.load!(id);
      let p: Promise<any> | any;
      if (ref) {
        if (typeof ref !== "object" || ref.s !== 1) p = ref;
        else sharedConfig.gather!(id);
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
            () => resumeBoundaryHydration(o, id, set),
            (err: any) => {
              _pendingBoundaries--;
              checkHydrationComplete();
              runWithOwner(o as Owner, () => {
                throw err;
              });
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
        return props.fallback;
      }
    }
    if (assetPromise) {
      _pendingBoundaries++;
      const set = createBoundaryTrigger();
      assetPromise.then(() => resumeBoundaryHydration(o, id, set));
      return undefined;
    }
    return createLoadBoundary(
      () => props.children,
      () => props.fallback
    );
  }) as unknown as JSX.Element;
}
