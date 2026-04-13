import { STATUS_PENDING } from "../core/constants.js";
import { snapshotCaptureActive, snapshotSources, strictRead } from "../core/core.js";
import { DEV, emitDiagnostic, registerGraph } from "../core/dev.js";
import {
  $REFRESH,
  getObserver,
  getOwner,
  isEqual,
  NO_SNAPSHOT,
  NOT_PENDING,
  read,
  setSignal,
  signal,
  STORE_SNAPSHOT_PROPS,
  trackOptimisticStore,
  untrack,
  type Computed,
  type Signal
} from "../core/index.js";
import { globalQueue, projectionWriteActive } from "../core/scheduler.js";
import { createProjectionInternal } from "./projection.js";

export type Store<T> = Readonly<T>;
export type StoreSetter<T> = (fn: (state: T) => T | void) => void;
/** Base options for store primitives. */
export interface StoreOptions {
  /** Debug name (dev mode only) */
  name?: string;
}
/** Options for derived/projected stores created with `createStore(fn)`, `createProjection`, or `createOptimisticStore(fn)`. */
export interface ProjectionOptions extends StoreOptions {
  /** Key property name or function for reconciliation identity */
  key?: string | ((item: NonNullable<any>) => any);
}
export type NoFn<T> = T extends Function ? never : T;

type DataNode = Signal<any>;
type DataNodes = Record<PropertyKey, DataNode>;

export const $TRACK = Symbol(__DEV__ ? "STORE_TRACK" : 0),
  $TARGET = Symbol(__DEV__ ? "STORE_TARGET" : 0),
  $PROXY = Symbol(__DEV__ ? "STORE_PROXY" : 0),
  $DELETED = Symbol(__DEV__ ? "STORE_DELETED" : 0);

export const STORE_VALUE = "v",
  STORE_OVERRIDE = "o",
  STORE_OPTIMISTIC_OVERRIDE = "x",
  STORE_NODE = "n",
  STORE_HAS = "h",
  STORE_WRAP = "w",
  STORE_LOOKUP = "l",
  STORE_FIREWALL = "f",
  STORE_OPTIMISTIC = "p";

export type StoreNode = {
  [$PROXY]: any;
  [STORE_VALUE]: Record<PropertyKey, any>;
  [STORE_OVERRIDE]?: Record<PropertyKey, any>;
  [STORE_OPTIMISTIC_OVERRIDE]?: Record<PropertyKey, any>;
  [STORE_NODE]?: DataNodes;
  [STORE_HAS]?: DataNodes;
  [STORE_WRAP]?: (value: any, target?: StoreNode) => any;
  [STORE_LOOKUP]?: WeakMap<any, any>;
  [STORE_FIREWALL]?: Computed<any>;
  [STORE_OPTIMISTIC]?: boolean;
  [STORE_SNAPSHOT_PROPS]?: Record<PropertyKey, any>;
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
  extend?: (target: StoreNode) => void
) {
  let newTarget;
  if (Array.isArray(value)) {
    newTarget = [];
    newTarget.v = value;
  } else newTarget = { v: value };
  extend && extend(newTarget);
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
  return (
    obj != null &&
    typeof obj === "object" &&
    !Object.isFrozen(obj) &&
    !(typeof Node !== "undefined" && obj instanceof Node)
  );
}
let writeOverride = false;
export function setWriteOverride(value: boolean) {
  writeOverride = value;
}

function writeOnly(proxy: any) {
  return writeOverride || !!Writing?.has(proxy);
}

function getNodes(target: StoreNode, type: typeof STORE_NODE | typeof STORE_HAS): DataNodes {
  let nodes = target[type];
  if (!nodes) target[type] = nodes = Object.create(null) as DataNodes;
  return nodes;
}

function getNode<T>(
  nodes: DataNodes,
  property: PropertyKey,
  value: T,
  firewall?: Computed<T>,
  equals: false | ((a: any, b: any) => boolean) = isEqual,
  optimistic?: boolean,
  snapshotProps?: Record<PropertyKey, any>
): DataNode {
  if (nodes[property]) return nodes[property]!;
  const s = signal<T>(
    value,
    {
      equals: equals,
      unobserved() {
        delete nodes[property];
      }
    },
    firewall
  );
  if (optimistic) {
    s._overrideValue = NOT_PENDING;
  }
  if (snapshotProps && property in snapshotProps) {
    const sv = snapshotProps[property];
    s._snapshotValue = sv === undefined ? NO_SNAPSHOT : sv;
    snapshotSources?.add(s);
  }
  return (nodes[property] = s);
}

export function trackSelf(target: StoreNode, symbol: symbol = $TRACK) {
  getObserver() &&
    read(
      getNode(
        getNodes(target, STORE_NODE),
        symbol,
        undefined,
        target[STORE_FIREWALL],
        false,
        target[STORE_OPTIMISTIC]
      )
    );
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
    if (property === $REFRESH) return target[STORE_FIREWALL];
    if (property === $TRACK) {
      trackSelf(target);
      return receiver;
    }
    const nodes = getNodes(target, STORE_NODE);
    const tracked = nodes[property];
    // Check optimistic override first, then regular override, then base value
    const optOverridden =
      target[STORE_OPTIMISTIC_OVERRIDE] && property in target[STORE_OPTIMISTIC_OVERRIDE];
    const overridden =
      optOverridden || (target[STORE_OVERRIDE] && property in target[STORE_OVERRIDE]);
    const proxySource = !!target[STORE_VALUE][$TARGET];
    const storeValue = optOverridden
      ? target[STORE_OPTIMISTIC_OVERRIDE]!
      : target[STORE_OVERRIDE] && property in target[STORE_OVERRIDE]
        ? target[STORE_OVERRIDE]!
        : target[STORE_VALUE];
    if (!tracked) {
      const desc = Object.getOwnPropertyDescriptor(storeValue, property);
      if (desc && desc.get) return desc.get.call(receiver);
    }
    if (writeOnly(receiver)) {
      let value =
        tracked && (overridden || !proxySource)
          ? tracked._overrideValue !== undefined && tracked._overrideValue !== NOT_PENDING
            ? tracked._overrideValue
            : tracked._pendingValue !== NOT_PENDING
              ? tracked._pendingValue
              : tracked._value
          : storeValue[property];
      value === $DELETED && (value = undefined);
      if (!isWrappable(value)) return value;
      const wrapped = wrap(value, target);
      Writing?.add(wrapped);
      return wrapped;
    }
    let value = tracked
      ? overridden || !proxySource
        ? read(nodes[property])
        : (read(nodes[property]), storeValue[property])
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
        return read(
          getNode(
            nodes,
            property,
            isWrappable(value) ? wrap(value, target) : value,
            target[STORE_FIREWALL],
            isEqual,
            target[STORE_OPTIMISTIC],
            target[STORE_SNAPSHOT_PROPS]
          )
        );
      }
    }
    if (__DEV__ && strictRead && typeof property === "string") {
      const message =
        `Reactive value read directly in ${strictRead} will not update. ` +
        `Move it into a tracking scope (JSX, a memo, or an effect's compute function).`;
      emitDiagnostic({
        code: "STRICT_READ_UNTRACKED",
        kind: "strict-read",
        severity: "warn",
        message,
        nodeName: String(property),
        data: { strictRead, property: String(property), source: "store" }
      });
      console.warn(message);
    }
    return isWrappable(value) ? wrap(value, target) : value;
  },

  has(target, property) {
    if (property === $PROXY || property === $TRACK || property === "__proto__") return true;
    // Check optimistic override first
    const has =
      target[STORE_OPTIMISTIC_OVERRIDE] && property in target[STORE_OPTIMISTIC_OVERRIDE]
        ? target[STORE_OPTIMISTIC_OVERRIDE][property] !== $DELETED
        : target[STORE_OVERRIDE] && property in target[STORE_OVERRIDE]
          ? target[STORE_OVERRIDE][property] !== $DELETED
          : property in target[STORE_VALUE];

    if (!writeOnly(target[$PROXY])) {
      getObserver() &&
        read(
          getNode(
            getNodes(target, STORE_HAS),
            property,
            has,
            target[STORE_FIREWALL],
            isEqual,
            target[STORE_OPTIMISTIC]
          )
        );
    }
    return has;
  },

  set(target, property, rawValue) {
    const store = target[$PROXY];
    if (writeOnly(store)) {
      // For optimistic stores, restore firewall's transition for async writes
      // This ensures async writes complete in the correct transition context
      if (target[STORE_OPTIMISTIC]) {
        const firewall = target[STORE_FIREWALL];
        if (firewall?._transition) {
          globalQueue.initTransition(firewall._transition);
        }
      }
      untrack(() => {
        const state = target[STORE_VALUE];
        const base = state[property];
        if (
          snapshotCaptureActive &&
          typeof property !== "symbol" &&
          !((target[STORE_FIREWALL]?._statusFlags ?? 0) & STATUS_PENDING)
        ) {
          if (!target[STORE_SNAPSHOT_PROPS]) {
            target[STORE_SNAPSHOT_PROPS] = Object.create(null);
            snapshotSources?.add(target);
          }
          if (!(property in target[STORE_SNAPSHOT_PROPS]!)) {
            target[STORE_SNAPSHOT_PROPS]![property] = base;
          }
        }
        // Choose override target: optimistic overlay for user setter on optimistic stores
        const useOptimistic = target[STORE_OPTIMISTIC] && !projectionWriteActive;
        const overrideKey = useOptimistic ? STORE_OPTIMISTIC_OVERRIDE : STORE_OVERRIDE;
        // Track store for reversion when writing optimistically
        if (useOptimistic) trackOptimisticStore(store);
        // Get prev from optimistic -> regular -> base
        const prev =
          target[STORE_OPTIMISTIC_OVERRIDE] && property in target[STORE_OPTIMISTIC_OVERRIDE]
            ? target[STORE_OPTIMISTIC_OVERRIDE][property]
            : target[STORE_OVERRIDE] && property in target[STORE_OVERRIDE]
              ? target[STORE_OVERRIDE][property]
              : base;
        const value = rawValue?.[$TARGET]?.[STORE_VALUE] ?? rawValue;
        const isArrayIndexWrite = Array.isArray(state) && property !== "length";
        const nextIndex = isArrayIndexWrite ? parseInt(property as string) + 1 : 0;
        const len =
          isArrayIndexWrite &&
          (target[STORE_OPTIMISTIC_OVERRIDE] && "length" in target[STORE_OPTIMISTIC_OVERRIDE]
            ? target[STORE_OPTIMISTIC_OVERRIDE].length
            : target[STORE_OVERRIDE] && "length" in target[STORE_OVERRIDE]
              ? target[STORE_OVERRIDE].length
              : state.length);
        const nextLength = isArrayIndexWrite && nextIndex > len ? nextIndex : undefined;

        if (prev === value && nextLength === undefined) return true;
        if (value !== undefined && value === base && nextLength === undefined)
          delete target[overrideKey]?.[property];
        else {
          const override = target[overrideKey] || (target[overrideKey] = Object.create(null));
          override[property] = value;
          if (nextLength !== undefined) override.length = nextLength;
        }
        const wrappable = isWrappable(value);
        target[STORE_HAS]?.[property] && setSignal(target[STORE_HAS]![property], true);
        const nodes = getNodes(target, STORE_NODE);
        nodes[property] &&
          setSignal(nodes[property], () => (wrappable ? wrap(value, target) : value));
        // notify length change
        if (Array.isArray(state)) {
          const lengthValue = property === "length" ? value : nextLength;
          lengthValue !== undefined && nodes.length && setSignal(nodes.length, lengthValue);
        }
        // notify self
        nodes[$TRACK] && setSignal(nodes[$TRACK], undefined);
        if (__DEV__) DEV.hooks.onStoreNodeUpdate?.(target[$PROXY], property, value, prev);
      });
    }
    return true;
  },

  deleteProperty(target, property) {
    // Check both optimistic and regular override for existing $DELETED
    const optDeleted = target[STORE_OPTIMISTIC_OVERRIDE]?.[property] === $DELETED;
    const regDeleted = target[STORE_OVERRIDE]?.[property] === $DELETED;
    if (writeOnly(target[$PROXY]) && !optDeleted && !regDeleted) {
      untrack(() => {
        const useOptimistic = target[STORE_OPTIMISTIC] && !projectionWriteActive;
        const overrideKey = useOptimistic ? STORE_OPTIMISTIC_OVERRIDE : STORE_OVERRIDE;
        // Track store for reversion when writing optimistically
        if (useOptimistic) trackOptimisticStore(target[$PROXY]);
        const prev =
          target[STORE_OPTIMISTIC_OVERRIDE] && property in target[STORE_OPTIMISTIC_OVERRIDE]
            ? target[STORE_OPTIMISTIC_OVERRIDE][property]
            : target[STORE_OVERRIDE] && property in target[STORE_OVERRIDE]
              ? target[STORE_OVERRIDE][property]
              : target[STORE_VALUE][property];
        if (
          property in target[STORE_VALUE] ||
          (target[STORE_OVERRIDE] && property in target[STORE_OVERRIDE])
        ) {
          (target[overrideKey] || (target[overrideKey] = Object.create(null)))[property] = $DELETED;
        } else if (target[overrideKey] && property in target[overrideKey]) {
          delete target[overrideKey][property];
        } else return true;
        if (target[STORE_HAS]?.[property]) setSignal(target[STORE_HAS]![property], false);
        const nodes = getNodes(target, STORE_NODE);
        nodes[property] && setSignal(nodes[property], undefined);
        nodes[$TRACK] && setSignal(nodes[$TRACK], undefined);
      });
    }
    return true;
  },

  ownKeys(target: StoreNode) {
    trackSelf(target);
    // Merge optimistic override with regular override for key enumeration
    let keys = getKeys(target[STORE_VALUE], target[STORE_OVERRIDE], false);
    if (target[STORE_OPTIMISTIC_OVERRIDE]) {
      const keySet = new Set(keys);
      for (const key of Reflect.ownKeys(target[STORE_OPTIMISTIC_OVERRIDE])) {
        if (target[STORE_OPTIMISTIC_OVERRIDE][key] !== $DELETED) keySet.add(key);
        else keySet.delete(key);
      }
      keys = Array.from(keySet);
    }
    return keys as ArrayLike<string | symbol>;
  },

  getOwnPropertyDescriptor(target: StoreNode, property: PropertyKey) {
    if (property === $PROXY) return { value: target[$PROXY], writable: true, configurable: true };
    // Check optimistic override first, but use base descriptor structure for compatibility
    if (target[STORE_OPTIMISTIC_OVERRIDE] && property in target[STORE_OPTIMISTIC_OVERRIDE]) {
      if (target[STORE_OPTIMISTIC_OVERRIDE][property] === $DELETED) return undefined;
      // Get base descriptor structure, override just the value
      const baseDesc = getPropertyDescriptor(target[STORE_VALUE], target[STORE_OVERRIDE], property);
      if (baseDesc) {
        return { ...baseDesc, value: target[STORE_OPTIMISTIC_OVERRIDE][property] };
      }
      return {
        value: target[STORE_OPTIMISTIC_OVERRIDE][property],
        writable: true,
        enumerable: true,
        configurable: true
      };
    }
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

/**
 * Creates a deeply reactive store with proxy-based tracking.
 *
 * When called with a plain value, wraps it in a reactive proxy.
 * When called with a function, creates a derived projection store with `ProjectionOptions` (name, key, all).
 *
 * ```typescript
 * // Plain store
 * const [store, setStore] = createStore<T>(initialValue);
 * // Derived store (projection)
 * const [store, setStore] = createStore<T>(fn, initialValue?, options?: ProjectionOptions);
 * ```
 * @param store initial value to wrap in a reactive proxy, or a derive function
 * @param options `ProjectionOptions` -- name, key, all (only for derived stores)
 *
 * @returns `[store: Store<T>, setStore: StoreSetter<T>]`
 */
export function createStore<T extends object = {}>(
  store: NoFn<T> | Store<NoFn<T>>
): [get: Store<T>, set: StoreSetter<T>];
export function createStore<T extends object = {}>(
  fn: (store: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  store?: NoFn<T> | Store<NoFn<T>>,
  options?: ProjectionOptions
): [get: Store<T> & { [$REFRESH]: any }, set: StoreSetter<T>];
export function createStore<T extends object = {}>(
  first: T | ((store: T) => void | T | Promise<void | T> | AsyncIterable<void | T>),
  second?: NoFn<T> | Store<NoFn<T>>,
  options?: ProjectionOptions
): [get: Store<T>, set: StoreSetter<T>] {
  const derived = typeof first === "function",
    wrappedStore = derived ? createProjectionInternal(first, second, options).store : wrap(first);

  if (__DEV__) registerGraph(wrappedStore, getOwner());

  return [wrappedStore, (fn: (draft: T) => void): void => storeSetter(wrappedStore, fn)];
}
