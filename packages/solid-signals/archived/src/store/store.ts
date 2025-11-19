import { Computation, getObserver, isEqual, untrack } from "../core/index.js";
import { createProjectionInternal } from "./projection.js";

export type Store<T> = Readonly<T>;
export type StoreSetter<T> = (fn: (state: T) => T | void) => void;
export type StoreOptions = {
  key?: string | ((item: NonNullable<any>) => any);
  all?: boolean;
};

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
  STORE_HAS = "h",
  STORE_WRAP = "w",
  STORE_LOOKUP = "l";

export type StoreNode = {
  [$PROXY]: any;
  [STORE_VALUE]: Record<PropertyKey, any>;
  [STORE_OVERRIDE]?: Record<PropertyKey, any>;
  [STORE_NODE]?: DataNodes;
  [STORE_HAS]?: DataNodes;
  [STORE_WRAP]?: (value: any, target?: StoreNode) => any;
  [STORE_LOOKUP]?: WeakMap<any, any>;
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

export function createStoreProxy<T extends object>(
  value: T,
  traps: ProxyHandler<StoreNode> = storeTraps,
  extend?: Record<PropertyKey, any>
) {
  let newTarget;
  if (Array.isArray(value)) {
    newTarget = [];
    newTarget.v = value;
  } else newTarget = { v: value };
  extend && Object.assign(newTarget, extend);
  return (newTarget[$PROXY] = new Proxy(newTarget, traps));
}

export const storeLookup = new WeakMap();
export function wrap<T extends Record<PropertyKey, any>>(value: T, target?: StoreNode): T {
  if (target?.[STORE_WRAP]) return target[STORE_WRAP](value, target);
  let p = value[$PROXY] || storeLookup.get(value);
  if (!p) storeLookup.set(value, (p = createStoreProxy(value)));
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
  const baseKeys = untrack(() => (enumerable ? Object.keys(source) : Reflect.ownKeys(source)));
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
export const storeTraps: ProxyHandler<StoreNode> = {
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
    const proxySource = !!target[STORE_VALUE][$TARGET];
    const storeValue = overridden ? target[STORE_OVERRIDE]! : target[STORE_VALUE];
    if (!tracked) {
      const desc = Object.getOwnPropertyDescriptor(storeValue, property);
      if (desc && desc.get) return desc.get.call(receiver);
    }
    if (Writing?.has(receiver)) {
      let value = tracked && (overridden || !proxySource) ? tracked._value : storeValue[property];
      value === $DELETED && (value = undefined);
      if (!isWrappable(value)) return value;
      const wrapped = wrap(value, target);
      Writing.add(wrapped);
      return wrapped;
    }
    let value = tracked
      ? overridden || !proxySource
        ? nodes[property].read()
        : (nodes[property].read(), storeValue[property])
      : storeValue[property];
    value === $DELETED && (value = undefined);
    if (!tracked) {
      if (!overridden && typeof value === "function" && !storeValue.hasOwnProperty(property)) {
        let proto;
        return !Array.isArray(target[STORE_VALUE]) &&
          (proto = Object.getPrototypeOf(target[STORE_VALUE])) &&
          proto !== Object.prototype
          ? value.bind(storeValue)
          : value;
      } else if (getObserver()) {
        return getNode(nodes, property, isWrappable(value) ? wrap(value, target) : value).read();
      }
    }
    return isWrappable(value) ? wrap(value, target) : value;
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
    const store = target[$PROXY];
    if (Writing?.has(target[$PROXY])) {
      untrack(() => {
        const state = target[STORE_VALUE];
        const base = state[property];
        const prev =
          target[STORE_OVERRIDE] && property in target[STORE_OVERRIDE]
            ? target[STORE_OVERRIDE][property]
            : base;
        const value = rawValue?.[$TARGET]?.[STORE_VALUE] ?? rawValue;

        if (prev === value) return true;
        const len = target[STORE_OVERRIDE]?.length || state.length;

        if (value !== undefined && value === base) delete target[STORE_OVERRIDE]![property];
        else
          (target[STORE_OVERRIDE] || (target[STORE_OVERRIDE] = Object.create(null)))[property] =
            value;
        const wrappable = isWrappable(value);
        if (isWrappable(prev)) {
          const parents = PARENTS.get(prev);
          parents && (parents instanceof Set ? parents.delete(store) : PARENTS.delete(prev));
        }
        if (recursivelyNotify(store, storeLookup) && wrappable) recursivelyAddParent(value, store);
        target[STORE_HAS]?.[property]?.write(true);
        const nodes = getNodes(target, STORE_NODE);
        nodes[property]?.write(wrappable ? wrap(value, target) : value);
        // notify length change
        if (Array.isArray(state)) {
          const index = parseInt(property as string) + 1;
          if (index > len) nodes.length?.write(index);
        }
        // notify self
        nodes[$TRACK]?.write(undefined);
      });
    }
    return true;
  },

  deleteProperty(target, property) {
    if (Writing?.has(target[$PROXY]) && target[STORE_OVERRIDE]?.[property] !== $DELETED) {
      untrack(() => {
        const prev =
          target[STORE_OVERRIDE] && property in target[STORE_OVERRIDE]
            ? target[STORE_OVERRIDE][property]
            : target[STORE_VALUE][property];
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
      });
    }
    return true;
  },

  ownKeys(target: StoreNode) {
    trackSelf(target);
    return getKeys(target[STORE_VALUE], target[STORE_OVERRIDE], false) as ArrayLike<
      string | symbol
    >;
  },

  getOwnPropertyDescriptor(target: StoreNode, property: PropertyKey) {
    if (property === $PROXY) return { value: target[$PROXY], writable: true, configurable: true };
    return getPropertyDescriptor(target[STORE_VALUE], target[STORE_OVERRIDE], property);
  },

  getPrototypeOf(target) {
    return Object.getPrototypeOf(target[STORE_VALUE]);
  }
};

export function storeSetter<T extends object>(store: Store<T>, fn: (draft: T) => T | void): void {
  const prevWriting = Writing;
  Writing = new Set();
  Writing.add(store);
  try {
    const value = fn(store);
    if (value !== store && value !== undefined) {
      if (Array.isArray(value)) {
        for (let i = 0, len = value.length; i < len; i++) store[i] = value[i];
        (store as any).length = value.length;
      } else {
        const keys = new Set([...Object.keys(store), ...Object.keys(value)]);
        keys.forEach(key => {
          if (key in value) store[key] = value[key];
          else delete store[key];
        });
      }
    }
  } finally {
    Writing.clear();
    Writing = prevWriting;
  }
}

export function createStore<T extends object = {}>(
  store: T | Store<T>
): [get: Store<T>, set: StoreSetter<T>];
export function createStore<T extends object = {}>(
  fn: (store: T) => void | T,
  store: T | Store<T>,
  options?: StoreOptions
): [get: Store<T>, set: StoreSetter<T>];
export function createStore<T extends object = {}>(
  first: T | ((store: T) => void | T),
  second?: T | Store<T>,
  options?: StoreOptions
): [get: Store<T>, set: StoreSetter<T>] {
  const derived = typeof first === "function",
    wrappedStore = derived ? createProjectionInternal(first, second, options).store : wrap(first);

  return [wrappedStore, (fn: (draft: T) => void): void => storeSetter(wrappedStore, fn)];
}

function recursivelyNotify(state: object, lookup: WeakMap<any, any>): boolean {
  let target = state[$TARGET] || (lookup?.get(state)?.[$TARGET] as StoreNode | undefined);
  let notified = false;
  if (target) {
    const deep = getNodes(target, STORE_NODE)[$DEEP];
    if (deep) {
      deep.write(undefined);
      notified = true;
    }
    lookup = target[STORE_LOOKUP] || lookup;
  }

  // trace parents
  const parents = PARENTS.get(target?.[STORE_VALUE] || state);
  if (!parents) return notified;
  if (parents instanceof Set) {
    for (let parent of parents) notified = recursivelyNotify(parent, lookup) || notified;
  } else notified = recursivelyNotify(parents, lookup) || notified;
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

export function deep<T extends object>(store: Store<T>): Store<T> {
  recursivelyAddParent(store);
  return store[$DEEP];
}
