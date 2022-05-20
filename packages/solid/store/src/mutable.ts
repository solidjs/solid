import { batch, getListener, DEV, $PROXY, $TRACK } from "solid-js";
import {
  unwrap,
  isWrappable,
  getDataNodes,
  trackSelf,
  getDataNode,
  $RAW,
  $NODE,
  $NAME,
  StoreNode,
  setProperty,
  proxyDescriptor,
  ownKeys
} from "./store";

const proxyTraps: ProxyHandler<StoreNode> = {
  get(target, property, receiver) {
    if (property === $RAW) return target;
    if (property === $PROXY) return receiver;
    if (property === $TRACK) return trackSelf(target);
    const nodes = getDataNodes(target);
    const tracked = nodes[property];
    let value = tracked ? nodes[property]() : target[property];
    if (property === $NODE || property === "__proto__") return value;

    if (!tracked) {
      const desc = Object.getOwnPropertyDescriptor(target, property);
      const isFunction = typeof value === "function";
      if (getListener() && (!isFunction || target.hasOwnProperty(property)) && !(desc && desc.get))
        value = getDataNode(nodes, property, value)();
      else if (value != null && isFunction && value === Array.prototype[property as any]) {
        return (...args: unknown[]) =>
          batch(() => Array.prototype[property as any].apply(receiver, args));
      }
    }
    return isWrappable(value)
      ? wrap(value, "_SOLID_DEV_" && target[$NAME] && `${target[$NAME]}:${property.toString()}`)
      : value;
  },

  set(target, property, value) {
    setProperty(target, property, unwrap(value));
    return true;
  },

  deleteProperty(target, property) {
    setProperty(target, property, undefined);
    return true;
  },

  ownKeys: ownKeys,

  getOwnPropertyDescriptor: proxyDescriptor
};

function wrap<T extends StoreNode>(value: T, name?: string): T {
  let p = value[$PROXY];
  if (!p) {
    Object.defineProperty(value, $PROXY, { value: (p = new Proxy(value, proxyTraps)) });
    const keys = Object.keys(value),
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

export function createMutable<T extends StoreNode>(state: T, options?: { name?: string }): T {
  const unwrappedStore = unwrap(state || {});
  if ("_SOLID_DEV_" && typeof unwrappedStore !== "object" && typeof unwrappedStore !== "function")
    throw new Error(
      `Unexpected type ${typeof unwrappedStore} received when initializing 'createMutable'. Expected an object.`
    );
  const wrappedStore = wrap(
    unwrappedStore,
    "_SOLID_DEV_" && ((options && options.name) || DEV.hashValue(unwrappedStore))
  );
  if ("_SOLID_DEV_") {
    const name = (options && options.name) || DEV.hashValue(unwrappedStore);
    DEV.registerGraph(name, { value: unwrappedStore });
  }
  return wrappedStore;
}

export function modifyMutable<T>(state: T, modifier: (state: T) => T) {
  batch(() => modifier(unwrap(state)));
}
