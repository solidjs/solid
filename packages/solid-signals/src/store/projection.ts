import { FirewallComputation } from "../core/effect.js";
import { getOwner } from "../core/owner.js";
import { getTransitionSource } from "../core/scheduler.js";
import { reconcile } from "./reconcile.js";
import {
  $TARGET,
  createStoreProxy,
  STORE_LOOKUP,
  STORE_WRAP,
  storeSetter,
  storeTraps,
  type Store,
  type StoreOptions
} from "./store.js";

/**
 * Creates a mutable derived value
 *
 * @see {@link https://github.com/solidjs/x-reactivity#createprojection}
 */
export function createProjection<T extends Object>(
  fn: (draft: T) => void | T,
  initialValue: T = {} as T,
  options?: StoreOptions
): Store<T> {
  let wrappedStore: Store<T>;
  const node = new FirewallComputation(() => {
    storeSetter(wrappedStore, (s) => {
      const value = fn(s);
      if (value !== s && value !== undefined) {
        reconcile(value, options?.key || "id", options?.all)(s);
      }
    });
  });
  const wrappedMap = new WeakMap();
  const traps = {
    ...storeTraps,
    get(target, property, receiver) {
      const o = getOwner();
      const n = getTransitionSource(node);
      (!o || o !== n) && n.wait();
      return storeTraps.get!(target, property, receiver);
    }
  };
  function wrapProjection(source) {
    if (wrappedMap.has(source)) return wrappedMap.get(source);
    if (source[$TARGET]?.[STORE_WRAP] === wrapProjection) return source;
    const wrapped = createStoreProxy(source, traps, {
      [STORE_WRAP]: wrapProjection,
      [STORE_LOOKUP]: wrappedMap
    });
    wrappedMap.set(source, wrapped);
    return wrapped;
  }

  return (wrappedStore = wrapProjection(initialValue));
}
