import {
  $REFRESH,
  computed,
  getOwner,
  handleAsync,
  setSignal,
  signal,
  STATUS_NONE,
  type Computed
} from "../core/index.js";
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
  type StoreOptions
} from "./store.js";

export function createProjectionInternal<T extends object = {}>(
  fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  initialValue: T = {} as T,
  options?: StoreOptions
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
        value !== wrappedStore &&
          value !== undefined &&
          storeSetter(wrappedStore, reconcile(value, options?.key || "id", options?.all));
        setSignal(owner, undefined);
      });
      value !== wrappedStore &&
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
 * Creates a mutable derived value
 *
 * @see {@link https://github.com/solidjs/x-reactivity#createprojection}
 */
export function createProjection<T extends object = {}>(
  fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  initialValue: T = {} as T,
  options?: StoreOptions
): Store<T> & { [$REFRESH]: any } {
  return createProjectionInternal(fn, initialValue, options).store;
}

const writeTraps: ProxyHandler<any> = {
  get(_, prop) {
    let value;
    setWriteOverride(true);
    try {
      value = _[prop];
    } finally {
      setWriteOverride(false);
    }
    return typeof value === "object" && value !== null ? new Proxy(value, writeTraps) : value;
  },
  set(_, prop, value) {
    setWriteOverride(true);
    try {
      _[prop] = value;
    } finally {
      setWriteOverride(false);
    }
    return true;
  },
  deleteProperty(_, prop) {
    setWriteOverride(true);
    try {
      delete _[prop];
    } finally {
      setWriteOverride(false);
    }
    return true;
  }
};
