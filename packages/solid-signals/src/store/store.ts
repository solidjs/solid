import { Computation, getObserver, isEqual, untrack } from "../core/index.js";
import { wrapProjection } from "./projection.js";

export type Store<T> = Readonly<T>;
export type StoreSetter<T> = (fn: (state: T) => void) => void;

type DataNode = Computation<any>;
type DataNodes = Record<PropertyKey, DataNode>;

const $RAW = Symbol(__DEV__ ? "STORE_RAW" : 0),
  $TRACK = Symbol(__DEV__ ? "STORE_TRACK" : 0),
  $DEEP = Symbol(__DEV__ ? "STORE_DEEP" : 0),
  $TARGET = Symbol(__DEV__ ? "STORE_TARGET" : 0),
  $PROXY = Symbol(__DEV__ ? "STORE_PROXY" : 0);

const PARENTS = new WeakMap<object, Set<object>>();

export const STORE_VALUE = "v",
  STORE_NODE = "n",
  STORE_HAS = "h";

export { $PROXY, $TRACK, $RAW, $TARGET };
export type StoreNode = {
  [STORE_VALUE]: Record<PropertyKey, any>;
  [STORE_NODE]?: DataNodes;
  [STORE_HAS]?: DataNodes;
};

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

export function wrap<T extends Record<PropertyKey, any>>(value: T): T {
  let p = value[$PROXY];
  if (!p) {
    let target;
    if (Array.isArray(value)) {
      target = [];
      target.v = value;
    } else target = { v: value };
    Object.defineProperty(value, $PROXY, {
      value: (p = new Proxy(target, proxyTraps)),
      writable: true
    });
  }
  return p;
}

export function isWrappable<T>(obj: T | NotWrappable): obj is T;
export function isWrappable(obj: any) {
  return obj != null && typeof obj === "object" && !Object.isFrozen(obj);
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
export function unwrap<T>(item: T, deep?: boolean, set?: Set<unknown>): T;
export function unwrap<T>(item: any, deep = true, set?: Set<unknown>): T {
  let result, unwrapped, v, prop;
  if ((result = item != null && item[$RAW])) return result;
  if (!deep) return item;
  if (!isWrappable(item) || set?.has(item)) return item;
  if (!set) set = new Set();
  set.add(item);
  if (Array.isArray(item)) {
    for (let i = 0, l = item.length; i < l; i++) {
      v = item[i];
      if ((unwrapped = unwrap(v, deep, set)) !== v) item[i] = unwrapped;
    }
  } else {
    if (!deep) return item;
    const keys = Object.keys(item);
    for (let i = 0, l = keys.length; i < l; i++) {
      prop = keys[i];
      const desc = Object.getOwnPropertyDescriptor(item, prop)!;
      if (desc.get) continue;
      v = item[prop];
      if ((unwrapped = unwrap(v, deep, set)) !== v) item[prop] = unwrapped;
    }
  }
  return item;
}

function getNodes(target: StoreNode, type: typeof STORE_NODE | typeof STORE_HAS): DataNodes {
  let nodes = target[type];
  if (!nodes) target[type] = nodes = Object.create(null) as DataNodes;
  return nodes;
}

function getNode(
  nodes: DataNodes,
  property: PropertyKey,
  value?: any,
  equals: false | ((a: any, b: any) => boolean) = isEqual
): DataNode {
  if (nodes[property]) return nodes[property]!;
  return (nodes[property] = new Computation<any>(value, null, {
    equals: equals,
    unobserved() {
      delete nodes[property];
    }
  }));
}

function proxyDescriptor(target: StoreNode, property: PropertyKey) {
  if (property === $PROXY) return { value: target[$PROXY], writable: true, configurable: true };
  const desc = Reflect.getOwnPropertyDescriptor(target[STORE_VALUE], property);
  if (!desc || desc.get || !desc.configurable) return desc;
  delete desc.value;
  delete desc.writable;
  desc.get = () => target[STORE_VALUE][$PROXY][property];
  return desc;
}

function trackSelf(target: StoreNode, symbol: symbol = $TRACK) {
  getObserver() && getNode(getNodes(target, STORE_NODE), symbol, undefined, false).read();
}

function ownKeys(target: StoreNode) {
  trackSelf(target);
  return Reflect.ownKeys(target[STORE_VALUE]);
}

let Writing: Set<Object> | null = null;
const proxyTraps: ProxyHandler<StoreNode> = {
  get(target, property, receiver) {
    if (property === $TARGET) return target;
    if (property === $RAW) return target[STORE_VALUE];
    if (property === $PROXY) return receiver;
    if (property === $TRACK || property === $DEEP) {
      trackSelf(target, property);
      return receiver;
    }
    const nodes = getNodes(target, STORE_NODE);
    const storeValue = target[STORE_VALUE];
    const tracked = nodes[property];
    if (!tracked) {
      const desc = Object.getOwnPropertyDescriptor(storeValue, property);
      if (desc && desc.get) return desc.get.call(receiver);
    }
    if (Writing?.has(storeValue)) {
      const value = tracked ? tracked._value : storeValue[property];
      return isWrappable(value) ? (Writing.add(value[$RAW] || value), wrap(value)) : value;
    }
    let value = tracked ? nodes[property].read() : storeValue[property];
    if (!tracked) {
      if (typeof value === "function" && !storeValue.hasOwnProperty(property)) {
        let proto;
        return !Array.isArray(storeValue) &&
          (proto = Object.getPrototypeOf(storeValue)) &&
          proto !== Object.prototype
          ? value.bind(storeValue)
          : value;
      } else if (getObserver()) {
        return getNode(nodes, property, isWrappable(value) ? wrap(value) : value).read();
      }
    }
    return isWrappable(value) ? wrap(value) : value;
  },

  has(target, property) {
    if (property === $RAW || property === $PROXY || property === $TRACK || property === "__proto__")
      return true;
    const has = property in target[STORE_VALUE];
    getObserver() && getNode(getNodes(target, STORE_HAS), property, has).read();
    return has;
  },

  set(target, property, value) {
    Writing?.has(target[STORE_VALUE]) &&
      setProperty(target[STORE_VALUE], property, unwrap(value, false));
    return true;
  },

  deleteProperty(target, property) {
    Writing?.has(target[STORE_VALUE]) && setProperty(target[STORE_VALUE], property, undefined, true);
    return true;
  },

  ownKeys: ownKeys,

  getOwnPropertyDescriptor: proxyDescriptor,

  getPrototypeOf(target) {
    return Object.getPrototypeOf(target[STORE_VALUE]);
  }
};

function setProperty(
  state: Record<PropertyKey, any>,
  property: PropertyKey,
  value: any,
  deleting: boolean = false
): void {
  const prev = state[property];
  if (!deleting && prev === value) return;
  const len = state.length;

  if (deleting) delete state[property];
  else state[property] = value;
  const wrappable = isWrappable(value);
  if (isWrappable(prev)) {
    const parents = PARENTS.get(prev);
    parents && (parents instanceof Set ? parents.delete(state) : PARENTS.delete(prev));
  }
  if (recursivelyNotify(state) && wrappable) recursivelyAddParent(value[$RAW] || value, state);
  const target = state[$PROXY]?.[$TARGET] as StoreNode | undefined;
  if (!target) return;
  if (deleting) target[STORE_HAS]?.[property]?.write(false);
  else target[STORE_HAS]?.[property]?.write(true);
  const nodes = getNodes(target, STORE_NODE);
  nodes[property]?.write(wrappable ? wrap(value) : value);
  // notify length change
  Array.isArray(state) && state.length !== len && nodes.length?.write(state.length);
  // notify self
  nodes[$TRACK]?.write(undefined);
}

function recursivelyNotify(state: object): boolean {
  let target = state[$PROXY]?.[$TARGET] as StoreNode | undefined;
  let notified = false;
  target && (getNodes(target, STORE_NODE)[$DEEP]?.write(undefined), (notified = true));

  // trace parents
  const parents = PARENTS.get(state);
  if (!parents) return notified;
  if (parents instanceof Set) {
    for (let parent of parents) notified = recursivelyNotify(parent) || notified;
  } else notified = recursivelyNotify(parents) || notified;
  return notified;
}

function recursivelyAddParent(state: any, parent?: any): void {
  if (parent) {
    let parents = PARENTS.get(state);
    if (!parents) PARENTS.set(state, parent);
    else if (parents !== parent) {
      if (!(parents instanceof Set))
        PARENTS.set(state, (parents = /* @__PURE__ */ new Set([parents])));
      else if (parents.has(parent)) return;
      parents.add(parent);
    } else return;
  }

  if (Array.isArray(state)) {
    for (let i = 0; i < state.length; i++) {
      const item = state[i];
      isWrappable(item) && recursivelyAddParent(item[$RAW] || item, state);
    }
  } else {
    const keys = Object.keys(state);
    for (let i = 0; i < keys.length; i++) {
      const item = state[keys[i]];
      isWrappable(item) && recursivelyAddParent(item[$RAW] || item, state);
    }
  }
}

export function createStore<T extends object = {}>(
  store: T | Store<T>
): [get: Store<T>, set: StoreSetter<T>];
export function createStore<T extends object = {}>(
  fn: (store: T) => void,
  store: T | Store<T>
): [get: Store<T>, set: StoreSetter<T>];
export function createStore<T extends object = {}>(
  first: T | ((store: T) => void),
  second?: T | Store<T>
): [get: Store<T>, set: StoreSetter<T>] {
  const derived = typeof first === "function",
    store = derived ? second! : first;

  const unwrappedStore = unwrap(store!);
  let wrappedStore = wrap(unwrappedStore);
  const setStore = (fn: (draft: T) => void): void => {
    const prevWriting = Writing;
    Writing = new Set();
    Writing.add(unwrappedStore);
    try {
      fn(wrappedStore);
    } finally {
      Writing.clear();
      Writing = prevWriting;
    }
  };

  if (derived) return wrapProjection(first as (store: T) => void, wrappedStore, setStore);

  return [wrappedStore, setStore];
}

export function deep<T extends object>(store: Store<T>): Store<any> {
  recursivelyAddParent(store[$RAW] || store);
  return store[$DEEP];
}
