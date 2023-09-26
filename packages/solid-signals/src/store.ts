import { getObserver } from "./bubble-reactivity/core";
import { Computation } from "./bubble-reactivity/core";

export type Store<T> = Readonly<T>;
export type StoreSetter<T> = (fn: (state: T) => void) => void;

type DataNode = Computation<any>;
type DataNodes = Record<PropertyKey, DataNode>;

const $RAW = Symbol(__DEV__ ? "STORE_RAW" : 0),
  $TRACK = Symbol(__DEV__ ? "TRACK" : 0),
  $PROXY = Symbol(__DEV__ ? "STORE_PROXY" : 0),
  $NODE = Symbol(__DEV__ ? "STORE_NODE" : 0),
  $HAS = Symbol(__DEV__ ? "STORE_HAS" : 0);

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

function wrap<T extends StoreNode>(value: T): T {
  let p = value[$PROXY];
  if (!p) {
    Object.defineProperty(value, $PROXY, {
      value: (p = new Proxy(value, proxyTraps)),
    });
    if (!Array.isArray(value)) {
      const keys = Object.keys(value);
      const desc = Object.getOwnPropertyDescriptors(value);
      for (let i = 0, l = keys.length; i < l; i++) {
        const prop = keys[i];
        if (desc[prop].get) {
          Object.defineProperty(value, prop, {
            enumerable: desc[prop].enumerable,
            get: desc[prop].get!.bind(p),
          });
        }
      }
    }
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
    const keys = Object.keys(item);
    const desc = Object.getOwnPropertyDescriptors(item);
    for (let i = 0, l = keys.length; i < l; i++) {
      prop = keys[i];
      if (desc[prop].get) continue;
      v = item[prop];
      if ((unwrapped = unwrap(v, set)) !== v) item[prop] = unwrapped;
    }
  }
  return item;
}

function getNodes(
  target: StoreNode,
  symbol: typeof $NODE | typeof $HAS
): DataNodes {
  let nodes = target[symbol];
  if (!nodes)
    Object.defineProperty(target, symbol, {
      value: (nodes = Object.create(null) as DataNodes),
    });
  return nodes;
}

function getNode(nodes: DataNodes, property: PropertyKey, value?: any) {
  if (nodes[property]) return nodes[property]!;
  return (nodes[property] = new Computation<any>(value, null, {
    equals: false,
  }));
}

function proxyDescriptor(target: StoreNode, property: PropertyKey) {
  const desc = Reflect.getOwnPropertyDescriptor(target, property);
  if (
    !desc ||
    desc.get ||
    !desc.configurable ||
    property === $PROXY ||
    property === $NODE
  )
    return desc;
  delete desc.value;
  delete desc.writable;
  desc.get = () => target[$PROXY][property];
  return desc;
}

function trackSelf(target: StoreNode) {
  getObserver() && getNode(getNodes(target, $NODE), $TRACK).read();
}

function ownKeys(target: StoreNode) {
  trackSelf(target);
  return Reflect.ownKeys(target);
}

let Writing = false;
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
    let value = tracked ? nodes[property].read() : target[property];
    if (property === $NODE || property === $HAS || property === "__proto__")
      return value;
    const desc = Object.getOwnPropertyDescriptor(target, property);

    if (!tracked) {
      if (
        getObserver() &&
        (typeof value !== "function" || target.hasOwnProperty(property)) &&
        !(desc && desc.get)
      )
        value = getNode(nodes, property, value).read();
    }
    return isWrappable(value) && !(desc && desc.get) ? wrap(value) : value;
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
    getObserver() && getNode(getNodes(target, $HAS), property).read();
    return property in target;
  },

  set(target, property, value) {
    Writing && setProperty(target, property, unwrap(value));
    return true;
  },

  deleteProperty(target, property) {
    Writing && setProperty(target, property, undefined, true);
    return true;
  },

  ownKeys: ownKeys,

  getOwnPropertyDescriptor: proxyDescriptor,
};

function setProperty(
  state: StoreNode,
  property: PropertyKey,
  value: any,
  deleting: boolean = false
): void {
  if (!deleting && state[property] === value) return;
  const prev = state[property];
  const len = state.length;

  if (deleting) delete state[property];
  else state[property] = value;
  const nodes = getNodes(state, $NODE);
  let node: DataNode;
  if ((node = getNode(nodes, property, prev))) node.write(value);

  if (Array.isArray(state) && state.length !== len)
    (node = getNode(nodes, "length", len)) && node.write(state.length);
  (node = nodes[$TRACK]) && node.write(undefined);
}

export function createStore<T extends object = {}>(
  store: T | Store<T>
): [get: Store<T>, set: StoreSetter<T>] {
  const unwrappedStore = unwrap(store);

  const wrappedStore = wrap(unwrappedStore);
  const setStore = (fn: (state: T) => void): void => {
    try {
      Writing = true;
      fn(wrappedStore);
    } finally {
      Writing = false;
    }
  };

  return [wrappedStore, setStore];
}
