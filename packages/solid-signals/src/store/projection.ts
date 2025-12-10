import { computed } from "../core/index.js";
import { reconcile } from "./reconcile.js";
import {
  $TARGET,
  createStoreProxy,
  STORE_FIREWALL,
  STORE_LOOKUP,
  STORE_WRAP,
  storeSetter,
  storeTraps,
  type Store,
  type StoreOptions
} from "./store.js";

export function createProjectionInternal<T extends object = {}>(
  fn: (draft: T) => void | T,
  initialValue: T = {} as T,
  options?: StoreOptions
) {
  let node;
  const wrappedMap = new WeakMap();
  const wrapProjection = (source: T) => {
    if (wrappedMap.has(source)) return wrappedMap.get(source);
    if (source[$TARGET]?.[STORE_WRAP] === wrapProjection) return source;
    const wrapped = createStoreProxy(source, storeTraps, {
      [STORE_WRAP]: wrapProjection,
      [STORE_LOOKUP]: wrappedMap,
      [STORE_FIREWALL]() {
        return node;
      }
    });
    wrappedMap.set(source, wrapped);
    return wrapped;
  };
  const wrappedStore: Store<T> = wrapProjection(initialValue);

  node = computed(() => {
    storeSetter(wrappedStore, s => {
      const value = fn(s);
      if (value !== s && value !== undefined) {
        reconcile(value, options?.key || "id", options?.all)(s);
      }
    });
  });

  return { store: wrappedStore, node };
}

/**
 * Creates a mutable derived value
 *
 * @see {@link https://github.com/solidjs/x-reactivity#createprojection}
 */
export function createProjection<T extends Object = {}>(
  fn: (draft: T) => void | T,
  initialValue: T = {} as T,
  options?: StoreOptions
): Store<T> {
  return createProjectionInternal(fn, initialValue, options).store;
}
