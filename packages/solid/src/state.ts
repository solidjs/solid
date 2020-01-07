import { isListening, DataNode, freeze } from "./signal";
const SNODE = Symbol("state-node"),
  SPROXY = Symbol("state-proxy");

export type StateNode = {
  [SNODE]?: any;
  [SPROXY]?: any;
  [k: string]: any;
  [k: number]: any;
};

// well-known symbols need special treatment until https://github.com/microsoft/TypeScript/issues/24622 is implemented.
type AddSymbolToPrimitive<T> = T extends { [Symbol.toPrimitive]: infer V }
  ? { [Symbol.toPrimitive]: V }
  : {};
type AddCallable<T> = T extends { (...x: any[]): infer V }
  ? { (...x: Parameters<T>): V }
  : {};

export type NotWrappable = string | number | boolean | Function | null;
export type Wrapped<T> = {
  [P in keyof T]: T[P] extends object ? Wrapped<T[P]> : T[P];
} & {
  _state?: T;
} & AddSymbolToPrimitive<T> &
  AddCallable<T>;

type StateSetter<T> =
  | Partial<T>
  | ((
      prevState: T extends NotWrappable ? T : Wrapped<T>,
      traversed?: (string | number)[]
    ) => Partial<T> | void);
type StatePathRange = { from?: number; to?: number; by?: number };
type StatePathPart =
  | string
  | number
  | (string | number)[]
  | StatePathRange
  | ((item: any, index: number) => boolean);

// do up to depth of 8
type StatePath<T> =
  | [keyof T, StatePathPart, StateSetter<unknown>]
  | [keyof T, StatePathPart, StatePathPart, StateSetter<unknown>]
  | [keyof T, StatePathPart, StatePathPart, StatePathPart, StateSetter<unknown>]
  | [
      keyof T,
      StatePathPart,
      StatePathPart,
      StatePathPart,
      StatePathPart,
      StateSetter<unknown>
    ]
  | [
      keyof T,
      StatePathPart,
      StatePathPart,
      StatePathPart,
      StatePathPart,
      StatePathPart,
      StateSetter<unknown>
    ]
  | [
      keyof T,
      StatePathPart,
      StatePathPart,
      StatePathPart,
      StatePathPart,
      StatePathPart,
      StatePathPart,
      StateSetter<unknown>
    ];
function wrap<T extends StateNode>(value: T): Wrapped<T> {
  return value[SPROXY] || (value[SPROXY] = new Proxy(value, proxyTraps));
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
  if ((result = item != null && item._state)) return result;
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
  let nodes = target[SNODE];
  if (!nodes) target[SNODE] = nodes = {};
  return nodes;
}

const proxyTraps = {
  get(target: StateNode, property: string | number | symbol) {
    if (property === "_state") return target;
    if (property === SPROXY || property === SNODE) return;
    const value = target[property as string | number],
      wrappable = isWrappable(value);
    if (
      isListening() &&
      (typeof value !== "function" || target.hasOwnProperty(property))
    ) {
      let nodes, node;
      if (wrappable && (nodes = getDataNodes(value))) {
        node = nodes._ || (nodes._ = new DataNode());
        node.current();
      }
      nodes = getDataNodes(target);
      node = nodes[property] || (nodes[property] = new DataNode());
      node.current();
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
  get(target: StateNode, property: string | number): any {
    if (property === "_state") return target;
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
  (node = nodes[property]) && node.next(value);
  notify && (node = nodes._) && node.next();
}

function mergeState(
  state: StateNode,
  value: Partial<StateNode>,
  force?: boolean
) {
  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    setProperty(state, key, value[key], force);
  }
}

function updatePath(
  current: StateNode,
  path: any[],
  traversed: (number | string)[] = []
) {
  let part,
    next = current;
  if (path.length > 1) {
    part = path.shift();
    const partType = typeof part,
      isArray = Array.isArray(current);

    if (Array.isArray(part)) {
      // Ex. update('data', [2, 23], 'label', l => l + ' !!!');
      for (let i = 0; i < part.length; i++) {
        updatePath(
          current,
          [part[i]].concat(path),
          [part[i]].concat(traversed)
        );
      }
      return;
    } else if (isArray && partType === "function") {
      // Ex. update('data', i => i.id === 42, 'label', l => l + ' !!!');
      for (let i = 0; i < current.length; i++) {
        if (part(current[i], i))
          updatePath(current, [i].concat(path), ([i] as (number|string)[]).concat(traversed));
      }
      return;
    } else if (isArray && partType === "object") {
      // Ex. update('data', { from: 3, to: 12, by: 2 }, 'label', l => l + ' !!!');
      const { from = 0, to = current.length - 1, by = 1 } = part;
      for (let i = from; i <= to; i += by) {
        updatePath(current, [i].concat(path), ([i] as (number|string)[]).concat(traversed));
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
    const wrapped =
      part === undefined || isWrappable(next)
        ? new Proxy(next, setterTraps)
        : next;
    value = value(wrapped, traversed);
    if (value === wrapped || value === undefined) return;
  }
  value = unwrap(value);
  if (
    part === undefined ||
    (isWrappable(next) && isWrappable(value) && !Array.isArray(value))
  ) {
    mergeState(next, value);
  } else setProperty(current, part, value);
}

export interface SetStateFunction<T> {
  (update: StateSetter<T>): void;
  <A extends keyof T>(part: A, update: StateSetter<T[A]>): void;
  (...path: StatePath<T>): void;
}

export function createState<T extends StateNode>(
  state: T | Wrapped<T>
): [Wrapped<T>, SetStateFunction<T>] {
  const unwrappedState = unwrap<T>(state || {});
  const wrappedState = wrap<T>(unwrappedState);
  function setState(...args: any[]): void {
    freeze(() => updatePath(unwrappedState, args));
  }

  return [wrappedState, setState];
}

// force state merge change even if value hasn't changed
export function force<T>(value: T | Wrapped<T>): (state: T extends NotWrappable ? T : Wrapped<T>) => void {
  return state => {
    if (!isWrappable(state)) return value;
    mergeState(unwrap(state), value, true);
  };
}
