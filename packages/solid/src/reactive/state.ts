import { Listener, createSignal, batch, hashValue, registerGraph } from "./signal";
export const $RAW = Symbol("state-raw"),
  $NODE = Symbol("state-node"),
  $PROXY = Symbol("state-proxy"),
  $NAME = Symbol("state-name");

export type StateNode = {
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
export type State<T> = {
  [P in keyof T]: T[P] extends object ? State<T[P]> & T[P] : T[P];
} & {
  [$RAW]?: T;
} & AddSymbolToPrimitive<T> &
  AddSymbolIterator<T> &
  AddSymbolToStringTag<T> &
  AddCallable<T>;

function wrap<T extends StateNode>(value: T, name?: string): State<T> {
  let p = value[$PROXY];
  if (!p) {
    Object.defineProperty(value, $PROXY, { value: (p = new Proxy(value, proxyTraps)) });
    let keys = Object.keys(value),
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
    (!obj.__proto__ || obj.__proto__ === Object.prototype || Array.isArray(obj))
  );
}

export function unwrap<T extends StateNode>(item: any): T {
  let result, unwrapped, v, prop;
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
    let keys = Object.keys(item),
      desc = Object.getOwnPropertyDescriptors(item);
    for (let i = 0, l = keys.length; i < l; i++) {
      prop = keys[i];
      if ((desc as any)[prop].get) continue;
      v = item[prop];
      if ((unwrapped = unwrap(v)) !== v) item[prop] = unwrapped;
    }
  }
  return item;
}

export function getDataNodes(target: StateNode) {
  let nodes = target[$NODE];
  if (!nodes) Object.defineProperty(target, $NODE, { value: (nodes = {}) });
  return nodes;
}

export function proxyDescriptor(target: StateNode, property: string | number | symbol) {
  const desc = Reflect.getOwnPropertyDescriptor(target, property);
  if (!desc || desc.get || property === $PROXY || property === $NODE || property === $NAME)
    return desc;
  delete desc.value;
  delete desc.writable;
  desc.get = () => target[$PROXY][property as string | number];
  return desc;
}

export function createDataNode() {
  const [s, set] = ("_SOLID_DEV_"
    ? createSignal(undefined, false, { internal: true })
    : createSignal(undefined, false)) as [{ (): void; set: () => void }, () => void];
  s.set = set;
  return s;
}

const proxyTraps: ProxyHandler<StateNode> = {
  get(target, property, receiver) {
    if (property === $RAW) return target;
    if (property === $PROXY) return receiver;
    const value = target[property as string | number];
    if (property === $NODE || property === "__proto__") return value;

    const wrappable = isWrappable(value);
    if (Listener && (typeof value !== "function" || target.hasOwnProperty(property))) {
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
    return true;
  },

  deleteProperty() {
    return true;
  },

  getOwnPropertyDescriptor: proxyDescriptor
};

export function setProperty(
  target: StateNode,
  property: string | number,
  value: any,
  traversedPath?: (string | number)[],
  traversedTargets?: any[],
  notifiers?: StateChangedEventHandler[]
) {
  const oldValue = target[property];
  if (oldValue === value) return;
  const notify = Array.isArray(target) || !(property in target);
  if (value === undefined) {
    delete target[property];
  } else {
    target[property] = value;
  }
  let nodes = getDataNodes(target),
    node;
  (node = nodes[property]) && node.set();
  notify && (node = nodes._) && node.set();
  if (traversedPath && traversedTargets && notifiers) {
    if (Array.isArray(target[property])) {
      let eventArgs = {} as CollectionChangedEventArgs;
      if (oldValue.length < target[property].length) {
        eventArgs.action = "Add";
        eventArgs.newItems = target[property].slice(oldValue.length, target[property].length);
        eventArgs.newStartingIndex = oldValue.length;
      } else if (oldValue.length > target[property].length) {
        eventArgs.action = "Remove";
        eventArgs.oldItems = oldValue.slice(target[property].length, oldValue.length);
        eventArgs.oldStartingIndex = target[property].length;
      } else {
        eventArgs.action = "Replace";
        eventArgs.oldItems = [];
        eventArgs.newItems = [];
        for (let i = 0; i < target[property].length; i++) {
          if (target[property][i] !== oldValue[i]) {
            eventArgs.oldItems.push(oldValue[i]);
            eventArgs.newItems.push(target[property][i]);
          }
        }
      }
      notifiers.forEach(notifier =>
        notifier(traversedPath, traversedTargets, "Collection", eventArgs)
      );
    } else {
      notifiers.forEach(notifier =>
        notifier(traversedPath, traversedTargets, "Property", {
          oldValue,
          newValue: value
        })
      );
    }
  }
}

export function updatePath(
  current: StateNode,
  path: any[],
  traversedPath: (number | string)[] = [],
  traversedTargets: object[] = [],
  notifiers?: StateChangedEventHandler[]
) {
  let part: any,
    prev = current;
  if (!notifiers && Notifiers.has(current)) notifiers = Notifiers.get(current);
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
          [part[i]].concat(traversedPath),
          [prev].concat(traversedTargets),
          notifiers
        );
      }
      return;
    } else if (isArray && partType === "function") {
      // Ex. update('data', i => i.id === 42, 'label', l => l + ' !!!');
      for (let i = 0; i < current.length; i++) {
        if (part(current[i], i))
          updatePath(
            current,
            [i].concat(path),
            [i as string | number].concat(traversedPath),
            [prev].concat(traversedTargets),
            notifiers
          );
      }
      return;
    } else if (isArray && partType === "object") {
      // Ex. update('data', { from: 3, to: 12, by: 2 }, 'label', l => l + ' !!!');
      const { from = 0, to = current.length - 1, by = 1 } = part;
      for (let i = from; i <= to; i += by) {
        updatePath(
          current,
          [i].concat(path),
          [i].concat(traversedPath),
          [prev].concat(traversedTargets),
          notifiers
        );
      }
      return;
    } else if (path.length > 1) {
      updatePath(
        current[part],
        path,
        [part].concat(traversedPath),
        [prev].concat(traversedTargets),
        notifiers
      );
      return;
    }
    prev = current[part];
    traversedPath = [part].concat(traversedPath);
  }
  let value = path[0];
  if (typeof value === "function") {
    value = value(prev, traversedPath);
    if (value === prev) return;
  }
  if (part === undefined && value == undefined) return;
  value = unwrap(value);
  if (part === undefined || (isWrappable(prev) && isWrappable(value) && !Array.isArray(value))) {
    mergeState(prev, value);
  } else setProperty(current, part, value, traversedPath, traversedTargets, notifiers);
}
function mergeState(state: StateNode, value: Partial<StateNode>) {
  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    setProperty(state, key, value[key]);
  }
}
type StateChangeType = "Property" | "Collection";

type PropertyChangedEventArgs = {
  newValue: any;
  oldValue: any;
};
type CollectionChangedAction = "Add" | "Remove" | "Replace";
/**
 * @param action - Performed action
 * @param newItems - Added or replaced items
 * @param oldItems - Removed or replaced items
 * @param newStartingIndex - Index of inserted items
 * @param oldStartingIndex - Old index of inserted items
 */
type CollectionChangedEventArgs = {
  action: CollectionChangedAction;
  newItems?: any[];
  oldItems?: any[];
  newStartingIndex: number;
  oldStartingIndex: number;
};
/**
 * @param path - Artifacts of path to property, including arrays indices.
 * @example ['foo', 'bar', 0, 'xyz']
 * @param targets - Array of properties that form a path to target property.
 * @param type - Type of change. Property or Collection.
 * @param args - Detailed information about change.
 */
type StateChangedEventHandler = (
  path: (string | number)[],
  targets: object[],
  type: StateChangeType,
  args: PropertyChangedEventArgs | CollectionChangedEventArgs
) => void;
const Notifiers = new Map<object, StateChangedEventHandler[]>();
/**
 * Creates function that executes every time object or any children changes.
 * @param target - Target to watch
 * @param cb - Callback on target or target children change
 */
export function createNotifier(target: object, cb: StateChangedEventHandler) {
  target = unwrap(target);
  if (!Notifiers.has(target)) Notifiers.set(target, [cb]);
  else Notifiers.get(target)!.push(cb);
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
  state: T | State<T>,
  options?: { name?: string }
): [State<T>, SetStateFunction<T>] {
  const unwrappedState = unwrap<T>(state || {});
  const wrappedState = wrap(
    unwrappedState,
    "_SOLID_DEV_" && ((options && options.name) || hashValue(unwrappedState))
  );
  if ("_SOLID_DEV_") {
    const name = (options && options.name) || hashValue(unwrappedState);
    registerGraph(name, { value: unwrappedState });
  }
  function setState(...args: any[]): void {
    batch(() => updatePath(unwrappedState, args));
  }

  return [wrappedState, setState];
}
