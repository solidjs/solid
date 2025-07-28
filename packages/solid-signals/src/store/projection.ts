import { ProjectionComputation } from "../core/effect.js";
import { getOwner } from "../core/owner.js";
import {
  $TARGET,
  createStoreProxy,
  STORE_LOOKUP,
  STORE_WRAP,
  storeSetter,
  storeTraps,
  type Store
} from "./store.js";

/**
 * Creates a mutable derived value
 *
 * @see {@link https://github.com/solidjs/x-reactivity#createprojection}
 */
export function createProjection<T extends Object>(
  fn: (draft: T) => void,
  initialValue: T = {} as T
): Store<T> {
  let wrappedStore: Store<T>;
  const node = new ProjectionComputation(() => {
    storeSetter(wrappedStore, fn);
  });
  const wrappedMap = new WeakMap();
  const traps = {
    ...storeTraps,
    get(target, property, receiver) {
      const o = getOwner();
      (!o || o !== node) && node.wait();
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
