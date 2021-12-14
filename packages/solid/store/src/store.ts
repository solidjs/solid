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

export type NotWrappable = string | number | bigint | boolean | Function | null;
export type Store<T> = DeepReadonly<T>;

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

export type DeepReadonly<T> = {
  readonly [K in keyof T]: T[K] extends NotWrappable ? T[K] : DeepReadonly<T[K]>;
};

export type StorePathRange = {
  from?: number;
  to?: number;
  by?: number;
};

export type ArrayFilterFn<T> = (item: T, index: number) => boolean;

// avoid putting a generic (e.g. T) on the left side of an "extends", as T could be a complex union
// and applying a conditional type to all of its members might take a lot of time
// [T] extends [unknown[]] doesn't seem to work either
export type StoreKeys<T> = number extends keyof T ? number : keyof T;

export type Part<T, K extends keyof T> =
  | K
  | K[]
  | (number extends keyof T ? ArrayFilterFn<T[number]> | StorePathRange : never);

export type StoreSetter<T> =
  // handle unknown and any
  (unknown extends T ? T : Partial<T>) | ((v: T, traversed: (keyof any)[]) => Partial<T> | void);

// using infer doesn't type K as extending keyof T
type Infer<T, K extends keyof T> = K extends K ? [NonNullable<Part<T, K>>, T[K]] : never;
export type StoreBranch<T> = T extends NotWrappable ? never : Infer<T, StoreKeys<T>>;

// handle unknown and any
type InferAll<T, K extends keyof T> = unknown extends T
  ? unknown[]
  : K extends K
  ? [NonNullable<Part<T, K>>, ...SetStoreFallback<T[K]>]
  : never;
export type SetStoreFallback<T> =
  | [StoreSetter<T>]
  | (T extends NotWrappable ? never : InferAll<T, StoreKeys<T>>);

export type SetStoreFunction<T> = _SetStoreFunction<Store<T>>;
interface _SetStoreFunction<T> {
  // uncommenting this drastically increases the time needed to infer types
  // <
  //   A extends StoreBranch<T>,
  //   B extends StoreBranch<A[1]>,
  //   C extends StoreBranch<B[1]>,
  //   D extends StoreBranch<C[1]>,
  //   E extends StoreBranch<D[1]>,
  //   F extends StoreBranch<E[1]>,
  //   G extends StoreBranch<F[1]>,
  //   H extends StoreBranch<G[1]>
  // >(
  //   a: A[0],
  //   b: B[0],
  //   c: C[0],
  //   d: D[0],
  //   e: E[0],
  //   f: F[0],
  //   g: G[0],
  //   h: H[0],
  //   setter: StoreSetter<H[1]>
  // ): void;
  <
    A extends StoreBranch<T>,
    B extends StoreBranch<A[1]>,
    C extends StoreBranch<B[1]>,
    D extends StoreBranch<C[1]>,
    E extends StoreBranch<D[1]>,
    F extends StoreBranch<E[1]>,
    G extends StoreBranch<F[1]>
  >(
    a: A[0],
    b: B[0],
    c: C[0],
    d: D[0],
    e: E[0],
    f: F[0],
    g: G[0],
    setter: StoreSetter<G[1]>
  ): void;
  <
    A extends StoreBranch<T>,
    B extends StoreBranch<A[1]>,
    C extends StoreBranch<B[1]>,
    D extends StoreBranch<C[1]>,
    E extends StoreBranch<D[1]>,
    F extends StoreBranch<E[1]>
  >(
    a: A[0],
    b: B[0],
    c: C[0],
    d: D[0],
    e: E[0],
    f: F[0],
    setter: StoreSetter<F[1]>
  ): void;
  <
    A extends StoreBranch<T>,
    B extends StoreBranch<A[1]>,
    C extends StoreBranch<B[1]>,
    D extends StoreBranch<C[1]>,
    E extends StoreBranch<D[1]>
  >(
    a: A[0],
    b: B[0],
    c: C[0],
    d: D[0],
    e: E[0],
    setter: StoreSetter<E[1]>
  ): void;
  <
    A extends StoreBranch<T>,
    B extends StoreBranch<A[1]>,
    C extends StoreBranch<B[1]>,
    D extends StoreBranch<C[1]>
  >(
    a: A[0],
    b: B[0],
    c: C[0],
    d: D[0],
    setter: StoreSetter<D[1]>
  ): void;
  <A extends StoreBranch<T>, B extends StoreBranch<A[1]>, C extends StoreBranch<B[1]>>(
    a: A[0],
    b: B[0],
    c: C[0],
    setter: StoreSetter<C[1]>
  ): void;
  <A extends StoreBranch<T>, B extends StoreBranch<A[1]>>(
    a: A[0],
    b: B[0],
    setter: StoreSetter<B[1]>
  ): void;
  <A extends StoreBranch<T>>(a: A[0], setter: StoreSetter<A[1]>): void;
  (setter: StoreSetter<T>): void;
  <
    A extends StoreBranch<T>,
    B extends StoreBranch<A[1]>,
    C extends StoreBranch<B[1]>,
    D extends StoreBranch<C[1]>,
    E extends StoreBranch<D[1]>,
    F extends StoreBranch<E[1]>,
    G extends StoreBranch<F[1]>
  >(
    a: A[0],
    b: B[0],
    c: C[0],
    d: D[0],
    e: E[0],
    f: F[0],
    g: G[0],
    ...args: SetStoreFallback<G[1]>
  ): void;
}

/**
 * creates a reactive store that can be read through a proxy object and written with a setter function
 *
 * @description https://www.solidjs.com/docs/latest/api#createstore
 */
export function createStore<T extends StoreNode>(
  store: T,
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
