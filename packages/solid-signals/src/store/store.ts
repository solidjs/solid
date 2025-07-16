import { Computation, getObserver, isEqual } from "../core/index.js";
import { wrapProjection } from "./projection.js";

export type Store<T> = Readonly<T>;
export type StoreSetter<T> = (fn: (state: T) => void) => void;

type DataNode = Computation<any>;
type DataNodes = Record<PropertyKey, DataNode>;

export const $TRACK = Symbol(__DEV__ ? "STORE_TRACK" : 0),
  $DEEP = Symbol(__DEV__ ? "STORE_DEEP" : 0),
  $TARGET = Symbol(__DEV__ ? "STORE_TARGET" : 0),
  $PROXY = Symbol(__DEV__ ? "STORE_PROXY" : 0),
  $DELETED = Symbol(__DEV__ ? "STORE_DELETED" : 0);

const PARENTS = new WeakMap<object, Set<object>>();

export const STORE_VALUE = "v",
  STORE_OVERRIDE = "o",
  STORE_NODE = "n",
  STORE_HAS = "h";

export type StoreNode = {
  [$PROXY]: any;
  [STORE_VALUE]: Record<PropertyKey, any>;
  [STORE_OVERRIDE]?: Record<PropertyKey, any>;
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
    target[$PROXY] = p;
  }
  return p;
}

export function isWrappable<T>(obj: T | NotWrappable): obj is T;
export function isWrappable(obj: any) {
  return obj != null && typeof obj === "object" && !Object.isFrozen(obj);
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

function trackSelf(target: StoreNode, symbol: symbol = $TRACK) {
  getObserver() && getNode(getNodes(target, STORE_NODE), symbol, undefined, false).read();
}

export function getKeys(
  source: Record<PropertyKey, any>,
  override: Record<PropertyKey, any> | undefined,
  enumerable: boolean = true
): PropertyKey[] {
  const baseKeys = enumerable ? Object.keys(source) : Reflect.ownKeys(source);
  if (!override) return baseKeys;
  const keys = new Set(baseKeys);
  const overrides = Reflect.ownKeys(override);
  for (const key of overrides) {
    if (override![key] !== $DELETED) keys.add(key);
    else keys.delete(key);
  }
  return Array.from(keys);
}

export function getPropertyDescriptor(
  source: Record<PropertyKey, any>,
  override: Record<PropertyKey, any> | undefined,
  property: PropertyKey
): PropertyDescriptor | undefined {
  let value = source;
  if (override && property in override) {
    if (value[property] === $DELETED) return void 0;
    if (!(property in value)) value = override;
  }
  return Reflect.getOwnPropertyDescriptor(value, property);
}

let Writing: Set<Object> | null = null;
const proxyTraps: ProxyHandler<StoreNode> = {
  get(target, property, receiver) {
    if (property === $TARGET) return target;
    if (property === $PROXY) return receiver;
    if (property === $TRACK || property === $DEEP) {
      trackSelf(target, property);
      return receiver;
    }
    const nodes = getNodes(target, STORE_NODE);
    const tracked = nodes[property];
    const overridden = target[STORE_OVERRIDE] && property in target[STORE_OVERRIDE];
    const storeValue = overridden ? target[STORE_OVERRIDE]! : target[STORE_VALUE];
    if (!tracked) {
      const desc = Object.getOwnPropertyDescriptor(storeValue, property);
      if (desc && desc.get) return desc.get.call(receiver);
    }
    if (Writing?.has(receiver)) {
      const value = tracked ? tracked._value : storeValue[property];
      if (!isWrappable(value)) return value;
      const wrapped = wrap(value);
      Writing.add(wrapped);
      return wrapped;
    }
    let value = tracked ? nodes[property].read() : storeValue[property];
    if (!tracked) {
      if (!overridden && typeof value === "function" && !storeValue.hasOwnProperty(property)) {
        let proto;
        return !Array.isArray(target[STORE_VALUE]) &&
          (proto = Object.getPrototypeOf(target[STORE_VALUE])) &&
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
    if (property === $PROXY || property === $TRACK || property === "__proto__") return true;
    const has =
      target[STORE_OVERRIDE] && property in target[STORE_OVERRIDE]
        ? target[STORE_OVERRIDE][property] !== $DELETED
        : property in target[STORE_VALUE];

    getObserver() && getNode(getNodes(target, STORE_HAS), property, has).read();
    return has;
  },

  set(target, property, rawValue) {
    if (Writing?.has(target[$PROXY])) {
      const state = target[STORE_VALUE];
      const prev = target[STORE_OVERRIDE]?.[property] || state[property];
      const value = rawValue?.[$TARGET]?.[STORE_VALUE] ?? rawValue;

      if (prev === value) return true;
      const len = target[STORE_OVERRIDE]?.length || state.length;

      (target[STORE_OVERRIDE] || (target[STORE_OVERRIDE] = Object.create(null)))[property] = value;
      const wrappable = isWrappable(value);
      if (isWrappable(prev)) {
        const parents = PARENTS.get(prev[$PROXY]);
        parents &&
          (parents instanceof Set ? parents.delete(target[$PROXY]) : PARENTS.delete(prev[$PROXY]));
      }
      if (recursivelyNotify(state) && wrappable) recursivelyAddParent(value, state);
      target[STORE_HAS]?.[property]?.write(true);
      const nodes = getNodes(target, STORE_NODE);
      nodes[property]?.write(wrappable ? wrap(value) : value);
      // notify length change
      if (Array.isArray(state)) {
        const index = parseInt(property as string) + 1;
        if (index > len) nodes.length?.write(index);
      }
      // notify self
      nodes[$TRACK]?.write(undefined);
    }
    return true;
  },

  deleteProperty(target, property) {
    if (Writing?.has(target[$PROXY]) && target[STORE_OVERRIDE]?.[property] !== $DELETED) {
      const prev = target[STORE_OVERRIDE]?.[property] || target[STORE_VALUE][property];
      if (property in target[STORE_VALUE]) {
        (target[STORE_OVERRIDE] || (target[STORE_OVERRIDE] = Object.create(null)))[property] =
          $DELETED;
      } else if (target[STORE_OVERRIDE] && property in target[STORE_OVERRIDE]) {
        delete target[STORE_OVERRIDE][property];
      } else return true;
      if (isWrappable(prev)) {
        const parents = PARENTS.get(prev);
        parents && (parents instanceof Set ? parents.delete(target) : PARENTS.delete(prev));
      }
      target[STORE_HAS]?.[property]?.write(false);
      const nodes = getNodes(target, STORE_NODE);
      nodes[property]?.write(undefined);
      nodes[$TRACK]?.write(undefined);
    }
    return true;
  },

  ownKeys(target: StoreNode) {
    trackSelf(target);
    return getKeys(target[STORE_VALUE], target[STORE_OVERRIDE], false) as ArrayLike<string | symbol>;
  },

  getOwnPropertyDescriptor(target: StoreNode, property: PropertyKey) {
    if (property === $PROXY) return { value: target[$PROXY], writable: true, configurable: true };
    return getPropertyDescriptor(target[STORE_VALUE], target[STORE_OVERRIDE], property);
  },

  getPrototypeOf(target) {
    return Object.getPrototypeOf(target[STORE_VALUE]);
  }
};

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

  const wrappedStore = store[$PROXY] || wrap(store);
  const setStore = (fn: (draft: T) => void): void => {
    const prevWriting = Writing;
    Writing = new Set();
    Writing.add(wrappedStore);
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
  let override: Record<PropertyKey, any> | undefined;
  const target = state[$TARGET] as StoreNode | undefined;
  if (target) {
    override = target[STORE_OVERRIDE];
    state = target[STORE_VALUE];
  }
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
    const len = override?.length || state.length;
    for (let i = 0; i < len; i++) {
      const item = override && i in override ? override[i] : state[i];
      isWrappable(item) && recursivelyAddParent(item, state);
    }
  } else {
    const keys = getKeys(state, override);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const item = override && key in override ? override[key] : state[key];
      isWrappable(item) && recursivelyAddParent(item, state);
    }
  }
}

export function deep<T extends object>(store: Store<T>): Store<any> {
  recursivelyAddParent(store);
  return store[$DEEP];
}
