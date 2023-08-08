import { getListener, batch, DEV, $PROXY, $TRACK, createSignal } from "solid-js";

export const $RAW = Symbol("store-raw"),
  $NODE = Symbol("store-node"),
  $HAS = Symbol("store-has"),
  $SELF = Symbol("store-self");

// debug hooks for devtools
export const DevHooks: { onStoreNodeUpdate: OnStoreNodeUpdate | null } = {
  onStoreNodeUpdate: null
};

type DataNode = {
  (): any;
  $(value?: any): void;
};
type DataNodes = Record<PropertyKey, DataNode | undefined>;

export type OnStoreNodeUpdate = (
  state: StoreNode,
  property: PropertyKey,
  value: StoreNode | NotWrappable,
  prev: StoreNode | NotWrappable
) => void;

export interface StoreNode {
  [$NODE]?: DataNodes;
  [key: PropertyKey]: any;
}

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
export type Store<T> = T;

function wrap<T extends StoreNode>(value: T): T {
  let p = value[$PROXY];
  if (!p) {
    Object.defineProperty(value, $PROXY, { value: (p = new Proxy(value, proxyTraps)) });
    if (!Array.isArray(value)) {
      const keys = Object.keys(value),
        desc = Object.getOwnPropertyDescriptors(value);
      for (let i = 0, l = keys.length; i < l; i++) {
        const prop = keys[i];
        if (desc[prop].get) {
          Object.defineProperty(value, prop, {
            enumerable: desc[prop].enumerable,
            get: desc[prop].get!.bind(p)
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

export function getNodes(target: StoreNode, symbol: typeof $NODE | typeof $HAS): DataNodes {
  let nodes = target[symbol];
  if (!nodes)
    Object.defineProperty(target, symbol, { value: (nodes = Object.create(null) as DataNodes) });
  return nodes;
}

export function getNode(nodes: DataNodes, property: PropertyKey, value?: any) {
  if (nodes[property]) return nodes[property]!;
  const [s, set] = createSignal<any>(value, {
    equals: false,
    internal: true
  });
  (s as DataNode).$ = set;
  return (nodes[property] = s as DataNode);
}

export function proxyDescriptor(target: StoreNode, property: PropertyKey) {
  const desc = Reflect.getOwnPropertyDescriptor(target, property);
  if (!desc || desc.get || !desc.configurable || property === $PROXY || property === $NODE)
    return desc;
  delete desc.value;
  delete desc.writable;
  desc.get = () => target[$PROXY][property];
  return desc;
}

export function trackSelf(target: StoreNode) {
  getListener() && getNode(getNodes(target, $NODE), $SELF)();
}

export function ownKeys(target: StoreNode) {
  trackSelf(target);
  return Reflect.ownKeys(target);
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
      if (
        getListener() &&
        (typeof value !== "function" || target.hasOwnProperty(property)) &&
        !(desc && desc.get)
      )
        value = getNode(nodes, property, value)();
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

  set() {
    if ("_SOLID_DEV_") console.warn("Cannot mutate a Store directly");
    return true;
  },

  deleteProperty() {
    if ("_SOLID_DEV_") console.warn("Cannot mutate a Store directly");
    return true;
  },

  ownKeys: ownKeys,

  getOwnPropertyDescriptor: proxyDescriptor
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

  if ("_SOLID_DEV_")
    DevHooks.onStoreNodeUpdate && DevHooks.onStoreNodeUpdate(state, property, value, prev);

  if (value === undefined) {
    delete state[property];
    if (state[$HAS] && state[$HAS][property] && prev !== undefined) state[$HAS][property].$();
  } else {
    state[property] = value;
    if (state[$HAS] && state[$HAS][property] && prev === undefined) state[$HAS][property].$();
  }
  let nodes = getNodes(state, $NODE),
    node: DataNode | undefined;
  if ((node = getNode(nodes, property, prev))) node.$(() => value);

  if (Array.isArray(state) && state.length !== len) {
    for (let i = state.length; i < len; i++) (node = nodes[i]) && node.$();
    (node = getNode(nodes, "length", len)) && node.$(state.length);
  }
  (node = nodes[$SELF]) && node.$();
}

function mergeStoreNode(state: StoreNode, value: Partial<StoreNode>) {
  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    setProperty(state, key, value[key]);
  }
}

function updateArray(
  current: StoreNode,
  next: Array<any> | Record<string, any> | ((prev: StoreNode) => Array<any> | Record<string, any>)
) {
  if (typeof next === "function") next = next(current);
  next = unwrap(next) as Array<any> | Record<string, any>;
  if (Array.isArray(next)) {
    if (current === next) return;
    let i = 0,
      len = next.length;
    for (; i < len; i++) {
      const value = next[i];
      if (current[i] !== value) setProperty(current, i, value);
    }
    setProperty(current, "length", len);
  } else mergeStoreNode(current, next);
}

export function updatePath(current: StoreNode, path: any[], traversed: PropertyKey[] = []) {
  let part,
    prev = current;
  if (path.length > 1) {
    part = path.shift();
    const partType = typeof part,
      isArray = Array.isArray(current);

    if (Array.isArray(part)) {
      // Ex. update('data', [2, 23], 'label', l => l + ' !!!');
      for (let i = 0; i < part.length; i++) {
        updatePath(current, [part[i]].concat(path), traversed);
      }
      return;
    } else if (isArray && partType === "function") {
      // Ex. update('data', i => i.id === 42, 'label', l => l + ' !!!');
      for (let i = 0; i < current.length; i++) {
        if (part(current[i], i)) updatePath(current, [i].concat(path), traversed);
      }
      return;
    } else if (isArray && partType === "object") {
      // Ex. update('data', { from: 3, to: 12, by: 2 }, 'label', l => l + ' !!!');
      const { from = 0, to = current.length - 1, by = 1 } = part;
      for (let i = from; i <= to; i += by) {
        updatePath(current, [i].concat(path), traversed);
      }
      return;
    } else if (path.length > 1) {
      updatePath(current[part], path, [part].concat(traversed));
      return;
    }
    prev = current[part];
    traversed = [part].concat(traversed);
  }
  let value = path[0];
  if (typeof value === "function") {
    value = value(prev, traversed);
    if (value === prev) return;
  }
  if (part === undefined && value == undefined) return;
  value = unwrap(value);
  if (part === undefined || (isWrappable(prev) && isWrappable(value) && !Array.isArray(value))) {
    mergeStoreNode(prev, value);
  } else setProperty(current, part, value);
}

/** @deprecated */
export type DeepReadonly<T> = 0 extends 1 & T
  ? T
  : T extends NotWrappable
  ? T
  : {
      readonly [K in keyof T]: DeepReadonly<T[K]>;
    };
/** @deprecated */
export type DeepMutable<T> = 0 extends 1 & T
  ? T
  : T extends NotWrappable
  ? T
  : {
      -readonly [K in keyof T]: DeepMutable<T[K]>;
    };

export type CustomPartial<T> = T extends readonly unknown[]
  ? "0" extends keyof T
    ? { [K in Extract<keyof T, `${number}`>]?: T[K] }
    : { [x: number]: T[number] }
  : Partial<T>;

export type PickMutable<T> = {
  [K in keyof T as (<U>() => U extends { [V in K]: T[V] } ? 1 : 2) extends <U>() => U extends {
    -readonly [V in K]: T[V];
  }
    ? 1
    : 2
    ? K
    : never]: T[K];
};

export type StorePathRange = { from?: number; to?: number; by?: number };

export type ArrayFilterFn<T> = (item: T, index: number) => boolean;

export type StoreSetter<T, U extends PropertyKey[] = []> =
  | T
  | CustomPartial<T>
  | ((prevState: T, traversed: U) => T | CustomPartial<T>);

export type Part<T, K extends KeyOf<T> = KeyOf<T>> =
  | K
  | ([K] extends [never] ? never : readonly K[])
  | ([T] extends [readonly unknown[]] ? ArrayFilterFn<T[number]> | StorePathRange : never);

// shortcut to avoid writing `Exclude<T, NotWrappable>` too many times
type W<T> = Exclude<T, NotWrappable>;

// specially handle keyof to avoid errors with arrays and any
type KeyOf<T> = number extends keyof T // have to check this otherwise ts won't allow KeyOf<T> to index T
  ? 0 extends 1 & T // if it's any just return keyof T
    ? keyof T
    : [T] extends [never]
    ? never // keyof never is PropertyKey, which number extends. this must go before
    : // checking [T] extends [readonly unknown[]] because never extends everything
    [T] extends [readonly unknown[]]
    ? number // it's an array or tuple; exclude the non-number properties
    : keyof T // it's something which contains an index signature for strings or numbers
  : keyof T;

type MutableKeyOf<T> = KeyOf<T> & keyof PickMutable<T>;

// rest must specify at least one (additional) key, followed by a StoreSetter if the key is mutable.
type Rest<T, U extends PropertyKey[], K extends KeyOf<T> = KeyOf<T>> = [T] extends [never]
  ? never
  : K extends MutableKeyOf<T>
  ? [Part<T, K>, ...RestSetterOrContinue<T[K], [K, ...U]>]
  : K extends KeyOf<T>
  ? [Part<T, K>, ...RestContinue<T[K], [K, ...U]>]
  : never;

type RestContinue<T, U extends PropertyKey[]> = 0 extends 1 & T
  ? [...Part<any>[], StoreSetter<any, PropertyKey[]>]
  : Rest<W<T>, U>;

type RestSetterOrContinue<T, U extends PropertyKey[]> = [StoreSetter<T, U>] | RestContinue<T, U>;

export interface SetStoreFunction<T> {
  <
    K1 extends KeyOf<W<T>>,
    K2 extends KeyOf<W<W<T>[K1]>>,
    K3 extends KeyOf<W<W<W<T>[K1]>[K2]>>,
    K4 extends KeyOf<W<W<W<W<T>[K1]>[K2]>[K3]>>,
    K5 extends KeyOf<W<W<W<W<W<T>[K1]>[K2]>[K3]>[K4]>>,
    K6 extends KeyOf<W<W<W<W<W<W<T>[K1]>[K2]>[K3]>[K4]>[K5]>>,
    K7 extends MutableKeyOf<W<W<W<W<W<W<W<T>[K1]>[K2]>[K3]>[K4]>[K5]>[K6]>>
  >(
    k1: Part<W<T>, K1>,
    k2: Part<W<W<T>[K1]>, K2>,
    k3: Part<W<W<W<T>[K1]>[K2]>, K3>,
    k4: Part<W<W<W<W<T>[K1]>[K2]>[K3]>, K4>,
    k5: Part<W<W<W<W<W<T>[K1]>[K2]>[K3]>[K4]>, K5>,
    k6: Part<W<W<W<W<W<W<T>[K1]>[K2]>[K3]>[K4]>[K5]>, K6>,
    k7: Part<W<W<W<W<W<W<W<T>[K1]>[K2]>[K3]>[K4]>[K5]>[K6]>, K7>,
    setter: StoreSetter<
      W<W<W<W<W<W<W<T>[K1]>[K2]>[K3]>[K4]>[K5]>[K6]>[K7],
      [K7, K6, K5, K4, K3, K2, K1]
    >
  ): void;
  <
    K1 extends KeyOf<W<T>>,
    K2 extends KeyOf<W<W<T>[K1]>>,
    K3 extends KeyOf<W<W<W<T>[K1]>[K2]>>,
    K4 extends KeyOf<W<W<W<W<T>[K1]>[K2]>[K3]>>,
    K5 extends KeyOf<W<W<W<W<W<T>[K1]>[K2]>[K3]>[K4]>>,
    K6 extends MutableKeyOf<W<W<W<W<W<W<T>[K1]>[K2]>[K3]>[K4]>[K5]>>
  >(
    k1: Part<W<T>, K1>,
    k2: Part<W<W<T>[K1]>, K2>,
    k3: Part<W<W<W<T>[K1]>[K2]>, K3>,
    k4: Part<W<W<W<W<T>[K1]>[K2]>[K3]>, K4>,
    k5: Part<W<W<W<W<W<T>[K1]>[K2]>[K3]>[K4]>, K5>,
    k6: Part<W<W<W<W<W<W<T>[K1]>[K2]>[K3]>[K4]>[K5]>, K6>,
    setter: StoreSetter<W<W<W<W<W<W<T>[K1]>[K2]>[K3]>[K4]>[K5]>[K6], [K6, K5, K4, K3, K2, K1]>
  ): void;
  <
    K1 extends KeyOf<W<T>>,
    K2 extends KeyOf<W<W<T>[K1]>>,
    K3 extends KeyOf<W<W<W<T>[K1]>[K2]>>,
    K4 extends KeyOf<W<W<W<W<T>[K1]>[K2]>[K3]>>,
    K5 extends MutableKeyOf<W<W<W<W<W<T>[K1]>[K2]>[K3]>[K4]>>
  >(
    k1: Part<W<T>, K1>,
    k2: Part<W<W<T>[K1]>, K2>,
    k3: Part<W<W<W<T>[K1]>[K2]>, K3>,
    k4: Part<W<W<W<W<T>[K1]>[K2]>[K3]>, K4>,
    k5: Part<W<W<W<W<W<T>[K1]>[K2]>[K3]>[K4]>, K5>,
    setter: StoreSetter<W<W<W<W<W<T>[K1]>[K2]>[K3]>[K4]>[K5], [K5, K4, K3, K2, K1]>
  ): void;
  <
    K1 extends KeyOf<W<T>>,
    K2 extends KeyOf<W<W<T>[K1]>>,
    K3 extends KeyOf<W<W<W<T>[K1]>[K2]>>,
    K4 extends MutableKeyOf<W<W<W<W<T>[K1]>[K2]>[K3]>>
  >(
    k1: Part<W<T>, K1>,
    k2: Part<W<W<T>[K1]>, K2>,
    k3: Part<W<W<W<T>[K1]>[K2]>, K3>,
    k4: Part<W<W<W<W<T>[K1]>[K2]>[K3]>, K4>,
    setter: StoreSetter<W<W<W<W<T>[K1]>[K2]>[K3]>[K4], [K4, K3, K2, K1]>
  ): void;
  <
    K1 extends KeyOf<W<T>>,
    K2 extends KeyOf<W<W<T>[K1]>>,
    K3 extends MutableKeyOf<W<W<W<T>[K1]>[K2]>>
  >(
    k1: Part<W<T>, K1>,
    k2: Part<W<W<T>[K1]>, K2>,
    k3: Part<W<W<W<T>[K1]>[K2]>, K3>,
    setter: StoreSetter<W<W<W<T>[K1]>[K2]>[K3], [K3, K2, K1]>
  ): void;
  <K1 extends KeyOf<W<T>>, K2 extends MutableKeyOf<W<W<T>[K1]>>>(
    k1: Part<W<T>, K1>,
    k2: Part<W<W<T>[K1]>, K2>,
    setter: StoreSetter<W<W<T>[K1]>[K2], [K2, K1]>
  ): void;
  <K1 extends MutableKeyOf<W<T>>>(k1: Part<W<T>, K1>, setter: StoreSetter<W<T>[K1], [K1]>): void;
  (setter: StoreSetter<T, []>): void;
  // fallback
  <
    K1 extends KeyOf<W<T>>,
    K2 extends KeyOf<W<W<T>[K1]>>,
    K3 extends KeyOf<W<W<W<T>[K1]>[K2]>>,
    K4 extends KeyOf<W<W<W<W<T>[K1]>[K2]>[K3]>>,
    K5 extends KeyOf<W<W<W<W<W<T>[K1]>[K2]>[K3]>[K4]>>,
    K6 extends KeyOf<W<W<W<W<W<W<T>[K1]>[K2]>[K3]>[K4]>[K5]>>,
    K7 extends KeyOf<W<W<W<W<W<W<W<T>[K1]>[K2]>[K3]>[K4]>[K5]>[K6]>>
  >(
    k1: Part<W<T>, K1>,
    k2: Part<W<W<T>[K1]>, K2>,
    k3: Part<W<W<W<T>[K1]>[K2]>, K3>,
    k4: Part<W<W<W<W<T>[K1]>[K2]>[K3]>, K4>,
    k5: Part<W<W<W<W<W<T>[K1]>[K2]>[K3]>[K4]>, K5>,
    k6: Part<W<W<W<W<W<W<T>[K1]>[K2]>[K3]>[K4]>[K5]>, K6>,
    k7: Part<W<W<W<W<W<W<W<T>[K1]>[K2]>[K3]>[K4]>[K5]>[K6]>, K7>,
    ...rest: Rest<W<W<W<W<W<W<W<T>[K1]>[K2]>[K3]>[K4]>[K5]>[K6]>[K7], [K7, K6, K5, K4, K3, K2, K1]>
  ): void;
}

/**
 * creates a reactive store that can be read through a proxy object and written with a setter function
 *
 * @description https://www.solidjs.com/docs/latest/api#createstore
 */
export function createStore<T extends object = {}>(
  ...[store, options]: {} extends T
    ? [store?: T | Store<T>, options?: { name?: string }]
    : [store: T | Store<T>, options?: { name?: string }]
): [get: Store<T>, set: SetStoreFunction<T>] {
  const unwrappedStore = unwrap((store || {}) as T);
  const isArray = Array.isArray(unwrappedStore);
  if ("_SOLID_DEV_" && typeof unwrappedStore !== "object" && typeof unwrappedStore !== "function")
    throw new Error(
      `Unexpected type ${typeof unwrappedStore} received when initializing 'createStore'. Expected an object.`
    );
  const wrappedStore = wrap(unwrappedStore);
  if ("_SOLID_DEV_") DEV!.registerGraph({ value: unwrappedStore, name: options && options.name });
  function setStore(...args: any[]): void {
    batch(() => {
      isArray && args.length === 1
        ? updateArray(unwrappedStore, args[0])
        : updatePath(unwrappedStore, args);
    });
  }

  return [wrappedStore, setStore];
}
