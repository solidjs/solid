import {
  $REFRESH,
  computed,
  getOwner,
  handleAsync,
  setSignal,
  type Computed
} from "../core/index.js";
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
  type Store,
  type ProjectionOptions
} from "./store.js";

export function createProjectionInternal<T extends object = {}>(
  fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  initialValue: T = {} as T,
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
  const wrapProjection = (source: T) => {
    if (wrappedMap.has(source)) return wrappedMap.get(source);
    if (source[$TARGET]?.[STORE_WRAP] === wrapProjection) return source;
    const wrapped = createStoreProxy(source, storeTraps, wrapper);
    wrappedMap.set(source, wrapped);
    return wrapped;
  };
  const wrappedStore: Store<T> = wrapProjection(initialValue);

  node = computed(() => {
    const owner = getOwner() as Computed<void | T>;
    storeSetter<T>(new Proxy(wrappedStore, writeTraps), s => {
      const value = handleAsync(owner, fn(s), value => {
        value !== s &&
          value !== undefined &&
          storeSetter(wrappedStore, reconcile(value, options?.key || "id", options?.all));
        setSignal(owner, undefined);
      });
      value !== s &&
        value !== undefined &&
        reconcile(value, options?.key || "id", options?.all)(wrappedStore);
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
 * const store = createProjection<T>(fn, initialValue?, options?: ProjectionOptions);
 * ```
 * @param fn a function that receives the current draft and mutates it or returns new data
 * @param initialValue the initial store value (defaults to `{}`)
 * @param options `ProjectionOptions` -- name, key, all
 *
 * @see {@link https://github.com/solidjs/x-reactivity#createprojection}
 */
export function createProjection<T extends object = {}>(
  fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  initialValue: T = {} as T,
  options?: ProjectionOptions
): Store<T> & { [$REFRESH]: any } {
  return createProjectionInternal(fn, initialValue, options).store;
}

export const writeTraps: ProxyHandler<any> = {
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
    return typeof value === "object" && value !== null ? new Proxy(value, writeTraps) : value;
  },
  set(_, prop, value) {
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
