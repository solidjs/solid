import { Listener, createSignal, hashValue, registerGraph } from "./signal";
import {
  wrap,
  unwrap,
  isWrappable,
  getDataNodes,
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
        node =
          nodes._ ||
          (nodes._ = "_SOLID_DEV_"
            ? createSignal(undefined, false, { internal: true })
            : createSignal());
        node[0]();
      }
      nodes = getDataNodes(target);
      node =
        nodes[property] ||
        (nodes[property] = "_SOLID_DEV_"
          ? createSignal(undefined, false, { internal: true })
          : createSignal());
      node[0]();
    }
    return wrappable
      ? wrap(
          value,
          "_SOLID_DEV_" && target[$NAME] && `${target[$NAME]}:${property as string}`,
          false,
          proxyTraps
        )
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

export function createMutable<T extends StateNode>(
  state: T | State<T>,
  options?: { name?: string }
): State<T> {
  const unwrappedState = unwrap<T>(state || {}, true);
  const wrappedState = wrap(
    unwrappedState,
    "_SOLID_DEV_" && ((options && options.name) || hashValue(unwrappedState)),
    true,
    proxyTraps
  );
  if ("_SOLID_DEV_") {
    const name = options && options.name || hashValue(unwrappedState);
    registerGraph(name, { value: unwrappedState });
  }
  return wrappedState as State<T>;
}
