import { Listener, createSignal, hashValue, registerGraph, batch } from "./signal";
import {
  unwrap,
  isWrappable,
  getDataNodes,
  createDataNode,
  $RAW,
  $NODE,
  $PROXY,
  $NAME,
  StateNode,
  State,
  setProperty,
  proxyDescriptor
} from "./state";

const proxyTraps: ProxyHandler<StateNode> = {
  get(target, property, receiver) {
    if (property === $RAW) return target;
    if (property === $PROXY) return receiver;
    const value = target[property as string | number];
    if (property === $NODE || property === "__proto__") return value;

    const wrappable = isWrappable(value);
    if (Listener && (typeof value !== "function" || target.hasOwnProperty(property))) {
      let nodes, node;
      if (wrappable && (nodes = getDataNodes(value))) {
        node = nodes._ || (nodes._ = createDataNode());
        node();
      }
      nodes = getDataNodes(target);
      node = nodes[property] || (nodes[property] = createDataNode());
      node();
    }
    return wrappable
      ? wrap(value, "_SOLID_DEV_" && target[$NAME] && `${target[$NAME]}:${property as string}`)
      : value;
  },

  set(target, property: string | number, value) {
    setProperty(target, property, unwrap(value));
    return true;
  },

  deleteProperty(target, property: string | number) {
    setProperty(target, property, undefined);
    return true;
  },

  getOwnPropertyDescriptor: proxyDescriptor
};

function wrap<T extends StateNode>(value: T, name?: string): State<T> {
  let p = value[$PROXY];
  if (!p) {
    Object.defineProperty(value, $PROXY, { value: (p = new Proxy(value, proxyTraps)) });
    let keys = Object.keys(value),
      desc = Object.getOwnPropertyDescriptors(value);
    for (let i = 0, l = keys.length; i < l; i++) {
      const prop = keys[i];
      if (desc[prop].get) {
        const get = desc[prop].get!.bind(p);
        Object.defineProperty(value, prop, {
          get
        });
      }
      if (desc[prop].set) {
        const og = desc[prop].set!,
          set = (v: T[keyof T]) => batch(() => og.call(p, v));
        Object.defineProperty(value, prop, {
          set
        });
      }
    }
    if ("_SOLID_DEV_" && name) Object.defineProperty(value, $NAME, { value: name });
  }
  return p;
}

export function createMutable<T extends StateNode>(
  state: T | State<T>,
  options?: { name?: string }
): State<T> {
  const unwrappedState = unwrap<T>(state || {});
  const wrappedState = wrap(
    unwrappedState,
    "_SOLID_DEV_" && ((options && options.name) || hashValue(unwrappedState))
  );
  if ("_SOLID_DEV_") {
    const name = (options && options.name) || hashValue(unwrappedState);
    registerGraph(name, { value: unwrappedState });
  }
  return wrappedState as State<T>;
}
