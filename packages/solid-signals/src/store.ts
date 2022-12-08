import { createSignal, batch, CurrentReaction } from "./";

export type Store<T> = T;
export type SetStoreFunction<T> = (fn: (state: T) => void) => void;
type DataNode = {
  (): any;
  $(value?: any): void;
};
type DataNodes = Record<PropertyKey, DataNode>;

export const $RAW = Symbol("store-raw"),
  $TRACK = Symbol("track"),
  $PROXY = Symbol("store-proxy"),
  $NODE = Symbol("store-node"),
  $NAME = Symbol("store-name");

export type StoreNode = Record<PropertyKey, any>;
export namespace SolidStore {
  export interface Unwrappable {}
}
export type NotWrappable =
  | string
  | number
  | bigint
  | symbol
  | boolean
  | Function
  | null
  | undefined
  | SolidStore.Unwrappable[keyof SolidStore.Unwrappable];

function wrap<T extends StoreNode>(value: T, name?: string): T {
  let p = value[$PROXY];
  if (!p) {
    Object.defineProperty(value, $PROXY, {
      value: (p = new Proxy(value, proxyTraps)),
    });
    if (!Array.isArray(value)) {
      const keys = Object.keys(value),
        desc = Object.getOwnPropertyDescriptors(value);
      for (let i = 0, l = keys.length; i < l; i++) {
        const prop = keys[i];
        if (desc[prop].get) {
          const get = desc[prop].get!.bind(p);
          Object.defineProperty(value, prop, {
            enumerable: desc[prop].enumerable,
            get,
          });
        }
      }
    }
    if ("_SOLID_DEV_" && name)
      Object.defineProperty(value, $NAME, { value: name });
  }
  return p;
}

export function isWrappable<T>(obj: T | NotWrappable): obj is T;
export function isWrappable(obj: any) {
  let proto;
  return (
    obj != null &&
    typeof obj === "object" &&
    (obj[$PROXY] ||
      !(proto = Object.getPrototypeOf(obj)) ||
      proto === Object.prototype ||
      Array.isArray(obj))
  );
}

/**
 * Returns the underlying data in the store without a proxy.
 * @param item store proxy object
 * @example
 * ```js
 * const initial = {z...};
 * const [state, setState] = createStore(initial);
 * initial === state; // => false
 * initial === unwrap(state); // => true
 * ```
 */
export function unwrap<T>(item: T, set?: Set<unknown>): T;
export function unwrap<T>(item: any, set = new Set()): T {
  let result, unwrapped, v, prop;
  if ((result = item != null && item[$RAW])) return result;
  if (!isWrappable(item) || set.has(item)) return item;

  if (Array.isArray(item)) {
    if (Object.isFrozen(item)) item = item.slice(0);
    else set.add(item);
    for (let i = 0, l = item.length; i < l; i++) {
      v = item[i];
      if ((unwrapped = unwrap(v, set)) !== v) item[i] = unwrapped;
    }
  } else {
    if (Object.isFrozen(item)) item = Object.assign({}, item);
    else set.add(item);
    const keys = Object.keys(item),
      desc = Object.getOwnPropertyDescriptors(item);
    for (let i = 0, l = keys.length; i < l; i++) {
      prop = keys[i];
      if (desc[prop].get) continue;
      v = item[prop];
      if ((unwrapped = unwrap(v, set)) !== v) item[prop] = unwrapped;
    }
  }
  return item;
}

export function getDataNodes(target: StoreNode): DataNodes {
  let nodes = target[$NODE];
  if (!nodes) Object.defineProperty(target, $NODE, { value: (nodes = {}) });
  return nodes;
}

export function getDataNode(
  nodes: DataNodes,
  property: PropertyKey,
  value: any
) {
  return nodes[property] || (nodes[property] = createDataNode(value));
}

export function proxyDescriptor(target: StoreNode, property: PropertyKey) {
  const desc = Reflect.getOwnPropertyDescriptor(target, property);
  if (
    !desc ||
    desc.get ||
    !desc.configurable ||
    property === $PROXY ||
    property === $NODE ||
    property === $NAME
  )
    return desc;
  delete desc.value;
  delete desc.writable;
  desc.get = () => target[$PROXY][property];
  return desc;
}

export function trackSelf(target: StoreNode) {
  if (CurrentReaction) {
    const nodes = getDataNodes(target);
    (nodes._ || (nodes._ = createDataNode()))();
  }
}

export function ownKeys(target: StoreNode) {
  trackSelf(target);
  return Reflect.ownKeys(target);
}

function createDataNode(value?: any) {
  const [s, set] = createSignal<any>(value, {
    equals: false,
  });
  (s as DataNode).$ = set;
  return s as DataNode;
}

const proxyTraps: ProxyHandler<StoreNode> = {
  get(target, property, receiver) {
    if (property === $RAW) return target;
    if (property === $PROXY) return receiver;
    if (property === $TRACK) {
      trackSelf(target);
      return receiver;
    }
    const nodes = getDataNodes(target);
    const tracked = nodes.hasOwnProperty(property);
    let value = tracked ? nodes[property]() : target[property];
    if (property === $NODE || property === "__proto__") return value;

    if (!tracked) {
      const desc = Object.getOwnPropertyDescriptor(target, property);
      if (
        CurrentReaction &&
        (typeof value !== "function" || target.hasOwnProperty(property)) &&
        !(desc && desc.get)
      )
        value = getDataNode(nodes, property, value)();
    }
    return isWrappable(value)
      ? wrap(
          value,
          "_SOLID_DEV_" &&
            target[$NAME] &&
            `${target[$NAME]}:${property.toString()}`
        )
      : value;
  },

  has(target, property) {
    if (
      property === $RAW ||
      property === $PROXY ||
      property === $TRACK ||
      property === $NODE ||
      property === "__proto__"
    )
      return true;
    this.get!(target, property, target);
    return property in target;
  },

  set() {
    if ("_SOLID_DEV_") console.warn("Cannot mutate a Store directly");
    return true;
  },

  deleteProperty() {
    if ("_SOLID_DEV_") console.warn("Cannot mutate a Store directly");
    return true;
  },

  ownKeys: ownKeys,

  getOwnPropertyDescriptor: proxyDescriptor,
};

const producers = new WeakMap();
const setterTraps: ProxyHandler<StoreNode> = {
  get(target, property): any {
    if (property === $RAW) return target;
    const value = target[property];
    let proxy;
    return isWrappable(value)
      ? producers.get(value) ||
          (producers.set(value, (proxy = new Proxy(value, setterTraps))), proxy)
      : value;
  },

  set(target, property, value) {
    setProperty(target, property, unwrap(value));
    return true;
  },

  deleteProperty(target, property) {
    setProperty(target, property, undefined, true);
    return true;
  },
};

export function setProperty(
  state: StoreNode,
  property: PropertyKey,
  value: any,
  deleting: boolean = false
): void {
  if (!deleting && state[property] === value) return;
  const prev = state[property],
    len = state.length;

  if ("_SOLID_DEV_" && globalThis._$onStoreNodeUpdate)
    globalThis._$onStoreNodeUpdate(state, property, value, prev);

  if (value === undefined) delete state[property];
  else state[property] = value;
  let nodes = getDataNodes(state),
    node: DataNode;
  if ((node = getDataNode(nodes, property, prev))) node.$(() => value);

  if (Array.isArray(state) && state.length !== len)
    (node = getDataNode(nodes, "length", len)) && node.$(state.length);
  (node = nodes._) && node.$();
}

export function createStore<T extends object = {}>(
  store: T | Store<T>
): [get: Store<T>, set: SetStoreFunction<T>] {
  const unwrappedStore = unwrap((store || {}) as T);

  const wrappedStore = wrap(unwrappedStore);
  function setStore(fn: (state: T) => void): void {
    batch(() => update<T>(unwrappedStore, fn));
  }

  return [wrappedStore, setStore];
}

function update<T extends object>(state: T, fn: (state: T) => void): void {
  let proxy: T;
  if (!(proxy = producers.get(state as Record<keyof T, T[keyof T]>))) {
    producers.set(
      state as Record<keyof T, T[keyof T]>,
      (proxy = new Proxy(state, setterTraps))
    );
  }
  fn(proxy);
}
