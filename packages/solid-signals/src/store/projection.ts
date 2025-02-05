import { EFFECT_PURE, STATE_CLEAN } from "../core/constants.js";
import { EagerComputation } from "../core/effect.js";
import { createStore, isWrappable } from "./store.js";

class ProjectionComputation extends EagerComputation {
  _notify(state: number, skipQueue?: boolean): void {
    if (this._state >= state && !this._forceNotify) return;
    if (this._state === STATE_CLEAN && !skipQueue) this._queue.enqueue(EFFECT_PURE, this);
    super._notify(state, true);
  }
}

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
  const node = new ProjectionComputation(undefined, () => {
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
