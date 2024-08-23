import { Computation, getObserver } from './core';
import { RenderEffect } from './effect';

export type Store<T> = Readonly<T>;
export type StoreSetter<T> = (fn: (state: T) => void) => void;

type DataNode = Computation<any>;
type DataNodes = Record<PropertyKey, DataNode>;

const $RAW = Symbol(__DEV__ ? 'STORE_RAW' : 0),
  $TRACK = Symbol(__DEV__ ? 'STORE_TRACK' : 0),
  $PROXY = Symbol(__DEV__ ? 'STORE_PROXY' : 0);

export { $PROXY, $TRACK };

const PROXIES = new WeakMap<any, any>();
// 0: DATA, 1: HAS
const NODES = [new WeakMap<any, DataNodes>(), new WeakMap<any, DataNodes>()];

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
  let p = PROXIES.get(value);
  if (!p) PROXIES.set(value, (p = new Proxy(value, proxyTraps)));
  return p;
}

export function isWrappable<T>(obj: T | NotWrappable): obj is T;
export function isWrappable(obj: any) {
  let proto;
  return (
    obj != null &&
    typeof obj === 'object' &&
    (PROXIES.has(obj) ||
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
    for (let i = 0, l = keys.length; i < l; i++) {
      prop = keys[i];
      const desc = Object.getOwnPropertyDescriptor(item, prop)!;
      if (desc.get) continue;
      v = item[prop];
      if ((unwrapped = unwrap(v, set)) !== v) item[prop] = unwrapped;
    }
  }
  return item;
}

function getNodes(target: StoreNode, type: 0 | 1): DataNodes {
  let nodes = NODES[type].get(target);
  if (!nodes)
    NODES[type].set(target, (nodes = Object.create(null) as DataNodes));
  return nodes;
}

function getNode(nodes: DataNodes, property: PropertyKey, value?: any) {
  if (nodes[property]) return nodes[property]!;
  return (nodes[property] = new Computation<any>(value, null, {
    equals: false,
    unobserved() {
      delete nodes[property];
    },
  }));
}

function proxyDescriptor(target: StoreNode, property: PropertyKey) {
  const desc = Reflect.getOwnPropertyDescriptor(target, property);
  if (!desc || desc.get || !desc.configurable || property === $PROXY)
    return desc;
  delete desc.value;
  delete desc.writable;
  desc.get = () => PROXIES.get(target)[property];
  return desc;
}

function trackSelf(target: StoreNode) {
  getObserver() && getNode(getNodes(target, 0), $TRACK).read();
}

function ownKeys(target: StoreNode) {
  trackSelf(target);
  return Reflect.ownKeys(target);
}

const Writing = new Set<Object>();
const proxyTraps: ProxyHandler<StoreNode> = {
  get(target, property, receiver) {
    if (property === $RAW) return target;
    if (property === $PROXY) return receiver;
    if (property === $TRACK) {
      trackSelf(target);
      return receiver;
    }
    const desc = Object.getOwnPropertyDescriptor(target, property);
    if (desc && desc.get) return desc.get.call(receiver);
    const nodes = getNodes(target, 0);
    const tracked = nodes[property];
    if (Writing.has(target)) {
      const value = tracked ? tracked._value : target[property];
      return isWrappable(value) ? (Writing.add(value), wrap(value)) : value;
    }
    let value = tracked ? nodes[property].read() : target[property];
    if (
      !tracked &&
      getObserver() &&
      (typeof value !== 'function' || target.hasOwnProperty(property))
    )
      value = getNode(nodes, property, value).read();
    return isWrappable(value) ? wrap(value) : value;
  },

  has(target, property) {
    if (
      property === $RAW ||
      property === $PROXY ||
      property === $TRACK ||
      property === '__proto__'
    )
      return true;
    getObserver() && getNode(getNodes(target, 1), property).read();
    return property in target;
  },

  set(target, property, value) {
    Writing.has(target) && setProperty(target, property, unwrap(value));
    return true;
  },

  deleteProperty(target, property) {
    Writing.has(target) && setProperty(target, property, undefined, true);
    return true;
  },

  ownKeys: ownKeys,

  getOwnPropertyDescriptor: proxyDescriptor,
};

function setProperty(
  state: StoreNode,
  property: PropertyKey,
  value: any,
  deleting: boolean = false,
): void {
  if (!deleting && state[property] === value) return;
  const prev = state[property];
  const len = state.length;

  if (deleting) delete state[property];
  else state[property] = value;
  const nodes = getNodes(state, 0);
  let node: DataNode;
  if ((node = getNode(nodes, property, prev))) node.write(value);

  if (Array.isArray(state) && state.length !== len)
    (node = getNode(nodes, 'length', len)) && node.write(state.length);
  (node = nodes[$TRACK]) && node.write(undefined);
}

export function createStore<T extends object = {}>(
  store: T | Store<T>,
): [get: Store<T>, set: StoreSetter<T>];
export function createStore<T extends object = {}>(
  fn: (store: T) => void,
  store: T | Store<T>,
): [get: Store<T>, set: StoreSetter<T>];
export function createStore<T extends object = {}>(
  first: T | ((store: T) => void),
  second?: T | Store<T>,
): [get: Store<T>, set: StoreSetter<T>] {
  const derived = typeof first === 'function',
    store = derived ? second! : first,
    unwrappedStore = unwrap(store!);

  const wrappedStore = wrap(unwrappedStore);
  const setStore = (fn: (draft: T) => void): void => {
    try {
      Writing.add(store);
      fn(wrappedStore);
    } finally {
      Writing.clear();
    }
  };
  if (derived) {
    // unsafe implementation
    new RenderEffect<T | undefined>(
      undefined,
      () => setStore(first) as any,
      () => {},
    );
  }

  return [wrappedStore, setStore];
}

/**
 * Creates a mutable derived value
 *
 * @see {@link https://github.com/solidjs/x-reactivity#createprojection}
 */
export function createProjection<T extends Object>(
  fn: (draft: T) => void,
  initialValue: T,
) {
  const [store] = createStore(fn, initialValue);
  return store;
}
