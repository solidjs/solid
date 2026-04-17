import { $REFRESH, computed, getOwner, handleAsync, type Computed } from "../core/index.js";
import { setProjectionWriteActive } from "../core/scheduler.js";
import { reconcile } from "./reconcile.js";
import {
  $TARGET,
  createStoreProxy,
  setWriteOverride,
  STORE_FIREWALL,
  STORE_LOOKUP,
  STORE_WRAP,
  storeSetter,
  storeTraps,
  type ProjectionOptions,
  type Store
} from "./store.js";

export function createProjectionInternal<T extends object = {}>(
  fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  seed: Partial<T>,
  options?: ProjectionOptions
) {
  let node;
  const wrappedMap = new WeakMap();
  const wrapper = s => {
    s[STORE_WRAP] = wrapProjection;
    s[STORE_LOOKUP] = wrappedMap;
    Object.defineProperty(s, STORE_FIREWALL, {
      get() {
        return node;
      },
      configurable: true
    });
  };
  const wrapProjection = (source: Partial<T>) => {
    if (wrappedMap.has(source)) return wrappedMap.get(source);
    if (source[$TARGET]?.[STORE_WRAP] === wrapProjection) return source;
    const wrapped = createStoreProxy(source, storeTraps, wrapper);
    wrappedMap.set(source, wrapped);
    return wrapped;
  };
  const wrappedStore = wrapProjection(seed) as Store<T>;

  node = computed(() => {
    const owner = getOwner() as Computed<void | T>;
    let settled = false;
    let result: void | T | Promise<void | T> | AsyncIterable<void | T>;
    const draft = new Proxy(
      wrappedStore,
      createWriteTraps(() => !settled || owner._inFlight === result)
    );
    storeSetter<T>(draft, s => {
      result = fn(s);
      settled = true;
      const value = handleAsync(owner, result, value => {
        value !== s &&
          value !== undefined &&
          storeSetter(wrappedStore, reconcile(value, options?.key || "id"));
      });
      value !== s && value !== undefined && reconcile(value, options?.key || "id")(wrappedStore);
    });
  });
  (node as any)._preventAutoDisposal = true;

  return { store: wrappedStore, node } as {
    store: Store<T> & { [$REFRESH]: any };
    node: Computed<void | T>;
  };
}

/**
 * Creates a mutable derived store (projection). The derive function receives a mutable
 * draft and can mutate it directly or return a new value for reconciliation.
 *
 * ```typescript
 * const store = createProjection<T>(fn, seed, options?: ProjectionOptions);
 * ```
 * @param fn a function that receives the current draft and mutates it or returns new data
 * @param seed the backing store host value to wrap and reconcile into
 * @param options `ProjectionOptions` -- name, key, all
 *
 * @see {@link https://github.com/solidjs/x-reactivity#createprojection}
 */
export function createProjection<T extends object = {}>(
  fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  seed: Partial<T>,
  options?: ProjectionOptions
): Store<T> & { [$REFRESH]: any } {
  return createProjectionInternal(fn, seed, options).store;
}

export function createWriteTraps(isActive?: () => boolean): ProxyHandler<any> {
  const traps: ProxyHandler<any> = {
    get(_, prop) {
      let value;
      setWriteOverride(true);
      setProjectionWriteActive(true);
      try {
        value = _[prop];
      } finally {
        setWriteOverride(false);
        setProjectionWriteActive(false);
      }
      return typeof value === "object" && value !== null ? new Proxy(value, traps) : value;
    },
    has(_, prop) {
      let value;
      setWriteOverride(true);
      setProjectionWriteActive(true);
      try {
        value = prop in _;
      } finally {
        setWriteOverride(false);
        setProjectionWriteActive(false);
      }
      return value;
    },
    set(_, prop, value) {
      if (isActive && !isActive()) return true;
      setWriteOverride(true);
      setProjectionWriteActive(true);
      try {
        _[prop] = value;
      } finally {
        setWriteOverride(false);
        setProjectionWriteActive(false);
      }
      return true;
    },
    deleteProperty(_, prop) {
      if (isActive && !isActive()) return true;
      setWriteOverride(true);
      setProjectionWriteActive(true);
      try {
        delete _[prop];
      } finally {
        setWriteOverride(false);
        setProjectionWriteActive(false);
      }
      return true;
    }
  };
  return traps;
}

export const writeTraps: ProxyHandler<any> = createWriteTraps();
