import { ProjectionComputation } from "../core/effect.js";
import { createStore, isWrappable } from "./store.js";

/**
 * Creates a mutable derived value
 *
 * @see {@link https://github.com/solidjs/x-reactivity#createprojection}
 */
export function createProjection<T extends Object>(
  fn: (draft: T) => void,
  initialValue: T = {} as T
) {
  const [store, setStore] = createStore(initialValue);
  const node = new ProjectionComputation(() => {
    setStore(fn);
  });
  const wrapped = new WeakMap();
  return wrap(store, node, wrapped);
}

function wrap(source, node, wrapped) {
  if (wrapped.has(source)) return wrapped.get(source);
  const wrap = new Proxy(source, {
    get(target, property) {
      node.read();
      const v = target[property];
      return isWrappable(v) ? wrap(v, node, wrapped) : v;
    },
    set() {
      throw new Error("Projections are readonly");
    },
    deleteProperty() {
      throw new Error("Projections are readonly");
    }
  });
  wrapped.set(source, wrap);
  return wrap;
}
