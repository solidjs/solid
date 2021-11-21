import { getListener, batch, DEV, $PROXY, Accessor, createSignal } from "solid-js";
export const $RAW = Symbol("store-raw"),
  $NODE = Symbol("store-node"),
  $NAME = Symbol("store-name");

export type StoreNode = {
  [$NODE]?: any;
  [$PROXY]?: any;
  [$NAME]?: string;
  [k: string]: any;
  [k: number]: any;
};

// well-known symbols need special treatment until https://github.com/microsoft/TypeScript/issues/24622 is implemented.
type AddSymbolToPrimitive<T> = T extends { [Symbol.toPrimitive]: infer V }
  ? { [Symbol.toPrimitive]: V }
  : {};
type AddSymbolIterator<T> = T extends { [Symbol.iterator]: infer V }
  ? { [Symbol.iterator]: V }
  : {};
type AddSymbolToStringTag<T> = T extends { [Symbol.toStringTag]: infer V }
  ? { [Symbol.toStringTag]: V }
  : {};
type AddCallable<T> = T extends { (...x: any[]): infer V } ? { (...x: Parameters<T>): V } : {};

export type NotWrappable = string | number | boolean | Function | null;
// Intersection for missing fields https://github.com/microsoft/TypeScript/issues/13543
export type Store<T> = {
  [P in keyof T]: T[P] extends object ? Store<T[P]> & T[P] : T[P];
} & {
  [$RAW]?: T;
} & AddSymbolToPrimitive<T> &
  AddSymbolIterator<T> &
  AddSymbolToStringTag<T> &
  AddCallable<T>;

function wrap<T extends StoreNode>(value: T, name?: string): Store<T> {
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
    }
    if ("_SOLID_DEV_" && name) Object.defineProperty(value, $NAME, { value: name });
  }
  return p;
}

export function isWrappable(obj: any) {
  return (
    obj != null &&
    typeof obj === "object" &&
    (obj[$PROXY] || !obj.__proto__ || obj.__proto__ === Object.prototype || Array.isArray(obj))
  );
}

export function unwrap<T extends StoreNode>(item: any, set = new Set()): T {
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
      if ((desc as any)[prop].get) continue;
      v = item[prop];
      if ((unwrapped = unwrap(v, set)) !== v) item[prop] = unwrapped;
    }
  }
  return item;
}

export function getDataNodes(target: StoreNode) {
  let nodes = target[$NODE];
  if (!nodes) Object.defineProperty(target, $NODE, { value: (nodes = {}) });
  return nodes;
}

export function proxyDescriptor(target: StoreNode, property: string | number | symbol) {
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
  desc.get = () => target[$PROXY][property as string | number];
  return desc;
}

export function ownKeys(target: StoreNode) {
  if (getListener()) {
    const nodes = getDataNodes(target);
    (nodes._ || (nodes._ = createDataNode()))();
  }
  return Reflect.ownKeys(target);
}

export function createDataNode() {
  const [s, set] = createSignal<void>(undefined, { equals: false, internal: true });
  (s as Accessor<void> & { $: () => void }).$ = set;
  return s as Accessor<void> & { $: () => void };
}

const proxyTraps: ProxyHandler<StoreNode> = {
  get(target, property, receiver) {
    if (property === $RAW) return target;
    if (property === $PROXY) return receiver;
    const value = target[property as string | number];
    if (property === $NODE || property === "__proto__") return value;

    const wrappable = isWrappable(value);
    if (getListener() && (typeof value !== "function" || target.hasOwnProperty(property))) {
      let nodes, node;
      if (wrappable && (nodes = getDataNodes(value))) {
        node = nodes._ || (nodes._ = createDataNode());
        node();
      }
      nodes = getDataNodes(target);
      node = nodes[property] || (nodes[property] = createDataNode());
      node();
    }
    return wrappable
      ? wrap(value, "_SOLID_DEV_" && target[$NAME] && `${target[$NAME]}:${property as string}`)
      : value;
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

export function setProperty(state: StoreNode, property: string | number, value: any) {
  if (state[property] === value) return;
  const array = Array.isArray(state);
  const len = state.length;
  const isUndefined = value === undefined;
  const notify = array || isUndefined === property in state;
  if (isUndefined) {
    delete state[property];
  } else state[property] = value;
  let nodes = getDataNodes(state),
    node;
  (node = nodes[property]) && node.$();
  if (array && state.length !== len) (node = nodes.length) && node.$();
  notify && (node = nodes._) && node.$();
}

function mergeStoreNode(state: StoreNode, value: Partial<StoreNode>) {
  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    setProperty(state, key, value[key]);
  }
}

export function updatePath(current: StoreNode, path: any[], traversed: (number | string)[] = []) {
  let part,
    prev = current;
  if (path.length > 1) {
    part = path.shift();
    const partType = typeof part,
      isArray = Array.isArray(current);

    if (Array.isArray(part)) {
      // Ex. update('data', [2, 23], 'label', l => l + ' !!!');
      for (let i = 0; i < part.length; i++) {
        updatePath(current, [part[i]].concat(path), [part[i]].concat(traversed));
      }
      return;
    } else if (isArray && partType === "function") {
      // Ex. update('data', i => i.id === 42, 'label', l => l + ' !!!');
      for (let i = 0; i < current.length; i++) {
        if (part(current[i], i))
          updatePath(current, [i].concat(path), ([i] as (number | string)[]).concat(traversed));
      }
      return;
    } else if (isArray && partType === "object") {
      // Ex. update('data', { from: 3, to: 12, by: 2 }, 'label', l => l + ' !!!');
      const { from = 0, to = current.length - 1, by = 1 } = part;
      for (let i = from; i <= to; i += by) {
        updatePath(current, [i].concat(path), ([i] as (number | string)[]).concat(traversed));
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

export type Readonly<T> = { readonly [K in keyof T]: DeepReadonly<T[K]> };
export type DeepReadonly<T> = T extends [infer A]
  ? Readonly<[A]>
  : T extends [infer A, infer B]
  ? Readonly<[A, B]>
  : T extends [infer A, infer B, infer C]
  ? Readonly<[A, B, C]>
  : T extends [infer A, infer B, infer C, infer D]
  ? Readonly<[A, B, C, D]>
  : T extends [infer A, infer B, infer C, infer D, infer E]
  ? Readonly<[A, B, C, D, E]>
  : T extends [infer A, infer B, infer C, infer D, infer E, infer F]
  ? Readonly<[A, B, C, D, E, F]>
  : T extends [infer A, infer B, infer C, infer D, infer E, infer F, infer G]
  ? Readonly<[A, B, C, D, E, F, G]>
  : T extends [infer A, infer B, infer C, infer D, infer E, infer F, infer G, infer H]
  ? Readonly<[A, B, C, D, E, F, G, H]>
  : T extends object
  ? Readonly<T>
  : T;

export type StoreSetter<T> =
  | Partial<T>
  | ((
      prevState: T extends NotWrappable ? T : Store<DeepReadonly<T>>,
      traversed?: (string | number)[]
    ) => Partial<T | DeepReadonly<T>> | void);
export type StorePathRange = { from?: number; to?: number; by?: number };

export type ArrayFilterFn<T> = (
  item: T extends any[] ? T[number] : never,
  index: number
) => boolean;

export type Part<T> = T extends any[]
  ? keyof T | Array<keyof T> | ArrayFilterFn<T> | StorePathRange
  : T extends object
  ? keyof T | Array<keyof T>
  : never;

export type NullableNext<T, K> = K extends keyof T
  ? T[K]
  : K extends Array<keyof T>
  ? T[K[number]]
  : T extends any[]
  ? K extends StorePathRange
    ? T[number]
    : K extends ArrayFilterFn<T>
    ? T[number]
    : never
  : never;

export type Next<T, K> = NonNullable<NullableNext<T, K>>;

export interface SetStoreFunction<T> {
  <Setter extends StoreSetter<T>>(...args: [Setter]): void;
  <K1 extends Part<T>, Setter extends StoreSetter<NullableNext<T, K1>>>(
    ...args: [K1, Setter]
  ): void;
  <
    K1 extends Part<T>,
    K2 extends Part<Next<T, K1>>,
    Setter extends StoreSetter<NullableNext<Next<T, K1>, K2>>
  >(
    ...args: [K1, K2, Setter]
  ): void;
  <
    K1 extends Part<T>,
    K2 extends Part<Next<T, K1>>,
    K3 extends Part<Next<Next<T, K1>, K2>>,
    Setter extends StoreSetter<NullableNext<Next<Next<T, K1>, K2>, K3>>
  >(
    ...args: [K1, K2, K3, Setter]
  ): void;
  <
    K1 extends Part<T>,
    K2 extends Part<Next<T, K1>>,
    K3 extends Part<Next<Next<T, K1>, K2>>,
    K4 extends Part<Next<Next<Next<T, K1>, K2>, K3>>,
    Setter extends StoreSetter<NullableNext<Next<Next<Next<T, K1>, K2>, K3>, K4>>
  >(
    ...args: [K1, K2, K3, K4, Setter]
  ): void;
  <
    K1 extends Part<T>,
    K2 extends Part<Next<T, K1>>,
    K3 extends Part<Next<Next<T, K1>, K2>>,
    K4 extends Part<Next<Next<Next<T, K1>, K2>, K3>>,
    K5 extends Part<Next<Next<Next<Next<T, K1>, K2>, K3>, K4>>,
    Setter extends StoreSetter<NullableNext<Next<Next<Next<Next<T, K1>, K2>, K3>, K4>, K5>>
  >(
    ...args: [K1, K2, K3, K4, K5, Setter]
  ): void;
  <
    K1 extends Part<T>,
    K2 extends Part<Next<T, K1>>,
    K3 extends Part<Next<Next<T, K1>, K2>>,
    K4 extends Part<Next<Next<Next<T, K1>, K2>, K3>>,
    K5 extends Part<Next<Next<Next<Next<T, K1>, K2>, K3>, K4>>,
    K6 extends Part<Next<Next<Next<Next<Next<T, K1>, K2>, K3>, K4>, K5>>,
    Setter extends StoreSetter<
      NullableNext<Next<Next<Next<Next<Next<T, K1>, K2>, K3>, K4>, K5>, K6>
    >
  >(
    ...args: [K1, K2, K3, K4, K5, K6, Setter]
  ): void;
  <
    K1 extends Part<T>,
    K2 extends Part<Next<T, K1>>,
    K3 extends Part<Next<Next<T, K1>, K2>>,
    K4 extends Part<Next<Next<Next<T, K1>, K2>, K3>>,
    K5 extends Part<Next<Next<Next<Next<T, K1>, K2>, K3>, K4>>,
    K6 extends Part<Next<Next<Next<Next<Next<T, K1>, K2>, K3>, K4>, K5>>,
    K7 extends Part<Next<Next<Next<Next<Next<Next<T, K1>, K2>, K3>, K4>, K5>, K6>>,
    Setter extends StoreSetter<
      NullableNext<Next<Next<Next<Next<Next<Next<T, K1>, K2>, K3>, K4>, K5>, K6>, K7>
    >
  >(
    ...args: [K1, K2, K3, K4, K5, K6, K7, Setter]
  ): void;

  // and here we give up on being accurate after 8 args
  <
    K1 extends Part<T>,
    K2 extends Part<Next<T, K1>>,
    K3 extends Part<Next<Next<T, K1>, K2>>,
    K4 extends Part<Next<Next<Next<T, K1>, K2>, K3>>,
    K5 extends Part<Next<Next<Next<Next<T, K1>, K2>, K3>, K4>>,
    K6 extends Part<Next<Next<Next<Next<Next<T, K1>, K2>, K3>, K4>, K5>>,
    K7 extends Part<Next<Next<Next<Next<Next<Next<T, K1>, K2>, K3>, K4>, K5>, K6>>,
    K8 extends Part<Next<Next<Next<Next<Next<Next<Next<T, K1>, K2>, K3>, K4>, K5>, K6>, K7>>
  >(
    ...args: [K1, K2, K3, K4, K5, K6, K7, K8, ...(Part<any> | StoreSetter<any>)[]]
  ): void;
}

/**
 * creates a reactive store that can be read through a proxy object and written with a setter function
 *
 * @description https://www.solidjs.com/docs/latest/api#createstore
 */
export function createStore<T extends StoreNode>(
  store: T | Store<T>,
  options?: { name?: string }
): [get: Store<T>, set: SetStoreFunction<T>] {
  const unwrappedStore = unwrap<T>(store || {});
  const wrappedStore = wrap(
    unwrappedStore,
    "_SOLID_DEV_" && ((options && options.name) || DEV.hashValue(unwrappedStore))
  );
  if ("_SOLID_DEV_") {
    const name = (options && options.name) || DEV.hashValue(unwrappedStore);
    DEV.registerGraph(name, { value: unwrappedStore });
  }
  function setStore(...args: any[]): void {
    batch(() => updatePath(unwrappedStore, args));
  }

  return [wrappedStore, setStore];
}
