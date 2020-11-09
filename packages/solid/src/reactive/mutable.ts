import { Listener, createSignal } from "./signal";
import {
  wrap,
  unwrap,
  isWrappable,
  getDataNodes,
  $RAW,
  $NODE,
  $PROXY,
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
        node = nodes._ || (nodes._ = createSignal());
        node[0]();
      }
      nodes = getDataNodes(target);
      node = nodes[property] || (nodes[property] = createSignal());
      node[0]();
    }
    return wrappable ? wrap(value, proxyTraps) : value;
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

export function createMutable<T extends StateNode>(
  state: T | State<T>
): State<T> {
  const unwrappedState = unwrap<T>(state || {}, true);
  const wrappedState = wrap(unwrappedState, proxyTraps);
  return wrappedState as State<T>;
}