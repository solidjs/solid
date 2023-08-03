import { batch, getListener, DEV, $PROXY, $TRACK } from "solid-js";
import {
  unwrap,
  isWrappable,
  getNodes,
  trackSelf,
  getNode,
  $RAW,
  $NODE,
  $HAS,
  StoreNode,
  setProperty,
  ownKeys
} from "./store.js";

function proxyDescriptor(target: StoreNode, property: PropertyKey) {
  const desc = Reflect.getOwnPropertyDescriptor(target, property);
  if (
    !desc ||
    desc.get ||
    desc.set ||
    !desc.configurable ||
    property === $PROXY ||
    property === $NODE
  )
    return desc;

  delete desc.value;
  delete desc.writable;
  desc.get = () => target[$PROXY][property];
  desc.set = v => (target[$PROXY][property] = v);

  return desc;
}

const proxyTraps: ProxyHandler<StoreNode> = {
  get(target, property, receiver) {
    if (property === $RAW) return target;
    if (property === $PROXY) return receiver;
    if (property === $TRACK) {
      trackSelf(target);
      return receiver;
    }
    const nodes = getNodes(target, $NODE);
    const tracked = nodes[property];
    let value = tracked ? tracked() : target[property];
    if (property === $NODE || property === $HAS || property === "__proto__") return value;

    if (!tracked) {
      const desc = Object.getOwnPropertyDescriptor(target, property);
      const isFunction = typeof value === "function";
      if (getListener() && (!isFunction || target.hasOwnProperty(property)) && !(desc && desc.get))
        value = getNode(nodes, property, value)();
      else if (value != null && isFunction && value === Array.prototype[property as any]) {
        return (...args: unknown[]) =>
          batch(() => Array.prototype[property as any].apply(receiver, args));
      }
    }
    return isWrappable(value) ? wrap(value) : value;
  },

  has(target, property) {
    if (
      property === $RAW ||
      property === $PROXY ||
      property === $TRACK ||
      property === $NODE ||
      property === $HAS ||
      property === "__proto__"
    )
      return true;
    getListener() && getNode(getNodes(target, $HAS), property)();
    return property in target;
  },

  set(target, property, value) {
    batch(() => setProperty(target, property, unwrap(value)));
    return true;
  },

  deleteProperty(target, property) {
    batch(() => setProperty(target, property, undefined, true));
    return true;
  },

  ownKeys: ownKeys,

  getOwnPropertyDescriptor: proxyDescriptor
};

function wrap<T extends StoreNode>(value: T): T {
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
  }
  return p;
}

export function createMutable<T extends StoreNode>(state: T, options?: { name?: string }): T {
  const unwrappedStore = unwrap(state || {});
  if ("_SOLID_DEV_" && typeof unwrappedStore !== "object" && typeof unwrappedStore !== "function")
    throw new Error(
      `Unexpected type ${typeof unwrappedStore} received when initializing 'createMutable'. Expected an object.`
    );

  const wrappedStore = wrap(unwrappedStore);
  if ("_SOLID_DEV_") DEV!.registerGraph({ value: unwrappedStore, name: options && options.name });
  return wrappedStore;
}

export function modifyMutable<T>(state: T, modifier: (state: T) => T) {
  batch(() => modifier(unwrap(state)));
}
