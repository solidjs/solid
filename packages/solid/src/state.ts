import { isListening, createSignal, freeze } from "./signal";
export const $RAW = Symbol("state-raw"),
  $NODE = Symbol("state-node"),
  $PROXY = Symbol("state-proxy");

export type StateNode = {
  [$NODE]?: any;
  [$PROXY]?: any;
  [k: string]: any;
  [k: number]: any;
};

// well-known symbols need special treatment until https://github.com/microsoft/TypeScript/issues/24622 is implemented.
type AddSymbolToPrimitive<T> = T extends { [Symbol.toPrimitive]: infer V }
  ? { [Symbol.toPrimitive]: V }
  : {};
type AddCallable<T> = T extends { (...x: any[]): infer V } ? { (...x: Parameters<T>): V } : {};

export type NotWrappable = string | number | boolean | Function | null;
export type State<T> = {
  [P in keyof T]: T[P] extends object ? State<T[P]> : T[P];
} & {
  [$RAW]?: T;
} & AddSymbolToPrimitive<T> &
  AddCallable<T>;

export function wrap<T extends StateNode>(value: T, traps?: ProxyHandler<T>): State<T> {
  return value[$PROXY] || (value[$PROXY] = new Proxy(value, traps || proxyTraps));
}

export function isWrappable(obj: any) {
  return (
    obj != null &&
    typeof obj === "object" &&
    (obj.__proto__ === Object.prototype || Array.isArray(obj))
  );
}

export function unwrap<T extends StateNode>(item: any): T {
  let result, unwrapped, v;
  if ((result = item != null && item[$RAW])) return result;
  if (!isWrappable(item)) return item;

  if (Array.isArray(item)) {
    if (Object.isFrozen(item)) item = item.slice(0);
    for (let i = 0, l = item.length; i < l; i++) {
      v = item[i];
      if ((unwrapped = unwrap(v)) !== v) item[i] = unwrapped;
    }
  } else {
    if (Object.isFrozen(item)) item = Object.assign({}, item);
    let keys = Object.keys(item);
    for (let i = 0, l = keys.length; i < l; i++) {
      v = item[keys[i]];
      if ((unwrapped = unwrap(v)) !== v) item[keys[i]] = unwrapped;
    }
  }
  return item;
}

export function getDataNodes(target: StateNode) {
  let nodes = target[$NODE];
  if (!nodes) target[$NODE] = nodes = {};
  return nodes;
}

const proxyTraps = {
  get(target: StateNode, property: string | number | symbol) {
    if (property === $RAW) return target;
    if (property === $PROXY || property === $NODE) return;
    const value = target[property as string | number],
      wrappable = isWrappable(value);
    if (isListening() && (typeof value !== "function" || target.hasOwnProperty(property))) {
      let nodes, node;
      if (wrappable && (nodes = getDataNodes(value))) {
        node = nodes._ || (nodes._ = createSignal());
        node[0]();
      }
      nodes = getDataNodes(target);
      node = nodes[property] || (nodes[property] = createSignal());
      node[0]();
    }
    return wrappable ? wrap(value) : value;
  },

  set() {
    return true;
  },

  deleteProperty() {
    return true;
  }
};

const setterTraps = {
  get(target: StateNode, property: string | number | symbol): any {
    if (property === $RAW) return target;
    const value = target[property as string | number];
    return isWrappable(value) ? new Proxy(value, setterTraps) : value;
  },

  set(target: StateNode, property: string | number, value: any) {
    setProperty(target, property, unwrap(value));
    return true;
  },

  deleteProperty(target: StateNode, property: string | number) {
    setProperty(target, property, undefined);
    return true;
  }
};

export function setProperty(
  state: StateNode,
  property: string | number,
  value: any,
  force?: boolean
) {
  if (!force && state[property] === value) return;
  const notify = Array.isArray(state) || !(property in state);
  if (value === undefined) {
    delete state[property];
  } else state[property] = value;
  let nodes = getDataNodes(state),
    node;
  (node = nodes[property]) && node[1]();
  notify && (node = nodes._) && node[1]();
}

function mergeState(state: StateNode, value: Partial<StateNode>, force?: boolean) {
  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    setProperty(state, key, value[key], force);
  }
}

export function updatePath(current: StateNode, path: any[], traversed: (number | string)[] = []) {
  let part,
    next = current;
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
    next = current[part];
    traversed = [part].concat(traversed);
  }
  let value = path[0];
  if (typeof value === "function") {
    const wrapped = part === undefined || isWrappable(next) ? new Proxy(next, setterTraps) : next;
    value = value(wrapped, traversed);
    if (value === wrapped || value === undefined) return;
  }
  value = unwrap(value);
  if (part === undefined || (isWrappable(next) && isWrappable(value) && !Array.isArray(value))) {
    mergeState(next, value);
  } else setProperty(current, part, value);
}

type StateSetter<T> =
  | Partial<T>
  | ((
      prevState: T extends NotWrappable ? T : State<T>,
      traversed?: (string | number)[]
    ) => Partial<T> | void);
type StatePathRange = { from?: number; to?: number; by?: number };

type ArrayFilterFn<T> = (item: T extends any[] ? T[number] : never, index: number) => boolean;

type Part<T> = keyof T | Array<keyof T> | StatePathRange | ArrayFilterFn<T>; // changing this to "T extends any[] ? ArrayFilterFn<T> : never" results in depth limit errors

type Next<T, K> = K extends keyof T
  ? T[K]
  : K extends Array<keyof T>
  ? T[K[number]]
  : T extends any[]
  ? K extends StatePathRange
    ? T[number]
    : K extends ArrayFilterFn<T>
    ? T[number]
    : never
  : never;

export interface SetStateFunction<T> {
  <Setter extends StateSetter<T>>(...args: [Setter]): void;
  <K1 extends Part<T>, Setter extends StateSetter<Next<T, K1>>>(...args: [K1, Setter]): void;
  <
    K1 extends Part<T>,
    K2 extends Part<Next<T, K1>>,
    Setter extends StateSetter<Next<Next<T, K1>, K2>>
  >(
    ...args: [K1, K2, Setter]
  ): void;
  <
    K1 extends Part<T>,
    K2 extends Part<Next<T, K1>>,
    K3 extends Part<Next<Next<T, K1>, K2>>,
    Setter extends StateSetter<Next<Next<Next<T, K1>, K2>, K3>>
  >(
    ...args: [K1, K2, K3, Setter]
  ): void;
  <
    K1 extends Part<T>,
    K2 extends Part<Next<T, K1>>,
    K3 extends Part<Next<Next<T, K1>, K2>>,
    K4 extends Part<Next<Next<Next<T, K1>, K2>, K3>>,
    Setter extends StateSetter<Next<Next<Next<Next<T, K1>, K2>, K3>, K4>>
  >(
    ...args: [K1, K2, K3, K4, Setter]
  ): void;
  <
    K1 extends Part<T>,
    K2 extends Part<Next<T, K1>>,
    K3 extends Part<Next<Next<T, K1>, K2>>,
    K4 extends Part<Next<Next<Next<T, K1>, K2>, K3>>,
    K5 extends Part<Next<Next<Next<Next<T, K1>, K2>, K3>, K4>>,
    Setter extends StateSetter<Next<Next<Next<Next<Next<T, K1>, K2>, K3>, K4>, K5>>
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
    Setter extends StateSetter<Next<Next<Next<Next<Next<Next<T, K1>, K2>, K3>, K4>, K5>, K6>>
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
    Setter extends StateSetter<
      Next<Next<Next<Next<Next<Next<Next<T, K1>, K2>, K3>, K4>, K5>, K6>, K7>
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
    ...args: [K1, K2, K3, K4, K5, K6, K7, K8, ...(Part<any> | StateSetter<any>)[]]
  ): void;
}

export function createState<T extends StateNode>(
  state: T | State<T>
): [State<T>, SetStateFunction<T>] {
  const unwrappedState = unwrap<T>(state || {});
  const wrappedState = wrap<T>(unwrappedState);
  function setState(...args: any[]): void {
    freeze(() => updatePath(unwrappedState, args));
  }

  return [wrappedState, setState];
}
