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
  type Refreshable,
  type Signal
} from "../core/index.js";
import {
  globalQueue,
  projectionWriteActive,
  registerTransientStoreNode
} from "../core/scheduler.js";
import { createProjectionInternal } from "./projection.js";

/** A read-only view of a store's value as seen by consumers. Mutate it via the paired `StoreSetter`. */
export type Store<T> = Readonly<T>;
/**
 * A store setter. The callback receives a writable **draft** of the store.
 *
 * - **Mutate in place (canonical):** `s.foo = 1`, `s.list.push(x)`,
 *   `s.list.splice(i, 1)`. This is the default form for most updates.
 * - **Return a new value:** for shapes where mutation is awkward, most
 *   commonly removing items (`s => s.list.filter(...)`). Arrays are replaced
 *   by index (length adjusted); objects are shallow-diffed at the top level
 *   (keys present in the returned value are written, missing keys deleted).
 *
 * The setter does **not** perform keyed reconciliation. If you need surviving
 * items to keep their store identity across full-array replacement, use the
 * projection form — `createStore(fn, seed, { key })` or `createProjection` —
 * whose derive function reconciles its return by `options.key`.
 */
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

/**
 * Brand symbols used internally by the store proxy / projection plumbing.
 * Cross-package wiring; not part of the user-facing API.
 *
 * @internal
 */
export const $TRACK = Symbol(__DEV__ ? "STORE_TRACK" : 0),
  $TARGET = Symbol(__DEV__ ? "STORE_TARGET" : 0),
  $PROXY = Symbol(__DEV__ ? "STORE_PROXY" : 0),
  $DELETED = Symbol(__DEV__ ? "STORE_DELETED" : 0);

export const STORE_VALUE = "v",
  STORE_OVERRIDE = "o",
  STORE_OPTIMISTIC_OVERRIDE = "x",
  STORE_NODE = "n",
  STORE_HAS = "h",
  STORE_CUSTOM_PROTO = "c",
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
  [STORE_CUSTOM_PROTO]?: boolean;
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
  newTarget[STORE_CUSTOM_PROTO] = hasCustomPrototype(unwrapStoreValue(value));
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

function unwrapStoreValue(value: any) {
  return value?.[$TARGET]?.[STORE_VALUE] ?? value;
}

function hasCustomPrototype(value: any): boolean {
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto !== null && proto !== Object.prototype;
}

function hasInheritedAccessor(source: Record<PropertyKey, any>, property: PropertyKey): boolean {
  let current = Object.getPrototypeOf(source);
  while (current && current !== Object.prototype) {
    const desc = Reflect.getOwnPropertyDescriptor(current, property);
    if (desc) return !!desc.get;
    current = Object.getPrototypeOf(current);
  }
  return false;
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
        if (nodes[property] === s) delete nodes[property];
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
  if (override && property in override) {
    if (override[property] === $DELETED) return void 0;
    const overrideDesc = Reflect.getOwnPropertyDescriptor(override, property);
    if (overrideDesc?.get || overrideDesc?.set || !(property in source)) return overrideDesc;
  }
  return Reflect.getOwnPropertyDescriptor(source, property);
}

function prepareStoreWrite(target: StoreNode, store: any, property: PropertyKey) {
  if (target[STORE_OPTIMISTIC]) {
    const firewall = target[STORE_FIREWALL];
    if (firewall?._transition) {
      globalQueue.initTransition(firewall._transition);
    }
  }
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
  const useOptimistic = target[STORE_OPTIMISTIC] && !projectionWriteActive;
  const overrideKey = useOptimistic ? STORE_OPTIMISTIC_OVERRIDE : STORE_OVERRIDE;
  if (useOptimistic) trackOptimisticStore(store);
  return { base, overrideKey, state };
}

function upsertStoreNode(
  target: StoreNode,
  nodes: DataNodes,
  property: PropertyKey,
  prev: any,
  snapshotProps?: Record<PropertyKey, any>
): DataNode {
  if (nodes[property]) return nodes[property]!;
  const initial = isWrappable(prev) ? wrap(prev, target) : prev;
  const node = getNode(
    nodes,
    property,
    initial,
    target[STORE_FIREWALL],
    isEqual,
    target[STORE_OPTIMISTIC],
    snapshotProps
  );
  registerTransientStoreNode(node);
  return node;
}

function notifyStoreProperty(
  target: StoreNode,
  property: PropertyKey,
  mode: "set" | "invalidate" | "delete",
  value?: any,
  prev?: any,
  prevHas?: boolean
) {
  // Cold writes upsert a transient pending node so untracked reads batch like signals.
  // Skip for projection writes (different commit semantics) and for optimistic stores
  // (whose whole purpose is immediate visibility via STORE_OPTIMISTIC_OVERRIDE).
  const skipUpsert = projectionWriteActive || target[STORE_OPTIMISTIC];
  const newHas = mode !== "delete";
  const existingHas = target[STORE_HAS]?.[property];
  if (existingHas) {
    setSignal(existingHas, newHas);
  } else if (!skipUpsert && mode !== "invalidate" && prevHas !== newHas) {
    const hasNode = upsertStoreNode(target, getNodes(target, STORE_HAS), property, prevHas);
    setSignal(hasNode, newHas);
  }
  const nodes = getNodes(target, STORE_NODE);
  if (mode === "set") {
    if (nodes[property]) {
      setSignal(nodes[property], () => (isWrappable(value) ? wrap(value, target) : value));
    } else if (!skipUpsert) {
      const node = upsertStoreNode(target, nodes, property, prev, target[STORE_SNAPSHOT_PROPS]);
      setSignal(node, () => (isWrappable(value) ? wrap(value, target) : value));
    }
  } else if (mode === "invalidate") {
    if (nodes[property]) {
      setSignal(nodes[property], {} as any);
      delete nodes[property];
    }
  } else {
    if (nodes[property]) {
      setSignal(nodes[property], undefined);
    } else if (!skipUpsert) {
      const node = upsertStoreNode(target, nodes, property, prev, target[STORE_SNAPSHOT_PROPS]);
      setSignal(node, undefined);
    }
  }
  nodes[$TRACK] && setSignal(nodes[$TRACK], undefined);
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
      if (!desc && !overridden && target[STORE_CUSTOM_PROTO]) {
        const source = unwrapStoreValue(storeValue);
        if (hasInheritedAccessor(source, property)) {
          return Reflect.get(storeValue, property, receiver);
        }
      }
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
        `[STRICT_READ_UNTRACKED] Reactive value read directly in ${strictRead} will not update. ` +
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

    if (writeOnly(target[$PROXY])) return has;
    const nodes = getNodes(target, STORE_HAS);
    // If a has-node already exists, it carries the batched presence — `read()`
    // returns `_value` (committed) for untracked reads and the pending value for
    // downstream computes. This keeps `in` consistent with value reads.
    if (nodes[property]) return read(nodes[property]);
    // No node yet: `has` reflects committed presence (no pending write could change
    // it without first upserting a has-node at the write site). Create + read only
    // when tracking; leave untracked reads node-free.
    if (getObserver()) {
      return read(
        getNode(nodes, property, has, target[STORE_FIREWALL], isEqual, target[STORE_OPTIMISTIC])
      );
    }
    return has;
  },

  set(target, property, rawValue) {
    const store = target[$PROXY];
    if (writeOnly(store)) {
      untrack(() => {
        const { base, overrideKey, state } = prepareStoreWrite(target, store, property);
        // Get prev from optimistic -> regular -> base
        const prev =
          target[STORE_OPTIMISTIC_OVERRIDE] && property in target[STORE_OPTIMISTIC_OVERRIDE]
            ? target[STORE_OPTIMISTIC_OVERRIDE][property]
            : target[STORE_OVERRIDE] && property in target[STORE_OVERRIDE]
              ? target[STORE_OVERRIDE][property]
              : base;
        const prevHas =
          target[STORE_OPTIMISTIC_OVERRIDE] && property in target[STORE_OPTIMISTIC_OVERRIDE]
            ? target[STORE_OPTIMISTIC_OVERRIDE][property] !== $DELETED
            : target[STORE_OVERRIDE] && property in target[STORE_OVERRIDE]
              ? target[STORE_OVERRIDE][property] !== $DELETED
              : property in target[STORE_VALUE];
        const value = unwrapStoreValue(rawValue);
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
        notifyStoreProperty(target, property, "set", value, prev, prevHas);
        // notify length change
        if (Array.isArray(state) && property !== "length" && nextLength !== undefined) {
          const nodes = getNodes(target, STORE_NODE);
          if (nodes.length) {
            setSignal(nodes.length, nextLength);
          } else if (!projectionWriteActive && !target[STORE_OPTIMISTIC]) {
            const node = upsertStoreNode(
              target,
              nodes,
              "length",
              len,
              target[STORE_SNAPSHOT_PROPS]
            );
            setSignal(node, nextLength);
          }
        }
        if (__DEV__) DEV.hooks.onStoreNodeUpdate?.(target[$PROXY], property, value, prev);
      });
    }
    return true;
  },

  defineProperty(target, property, descriptor) {
    const store = target[$PROXY];
    if (writeOnly(store)) {
      untrack(() => {
        const { base, overrideKey } = prepareStoreWrite(target, store, property);
        const normalizedDescriptor =
          "value" in descriptor
            ? {
                ...descriptor,
                value: unwrapStoreValue(descriptor.value)
              }
            : descriptor;
        Object.defineProperty(
          target[overrideKey] || (target[overrideKey] = Object.create(null)),
          property,
          normalizedDescriptor
        );

        notifyStoreProperty(target, property, "invalidate");

        if (__DEV__) {
          const next =
            "value" in normalizedDescriptor
              ? normalizedDescriptor.value
              : normalizedDescriptor.get?.call(store);
          DEV.hooks.onStoreNodeUpdate?.(target[$PROXY], property, next, base);
        }
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
        notifyStoreProperty(target, property, "delete", undefined, prev, true);
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
      const optDesc = Reflect.getOwnPropertyDescriptor(target[STORE_OPTIMISTIC_OVERRIDE], property);
      if (optDesc?.get || optDesc?.set || !(property in target[STORE_VALUE])) return optDesc;
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
 * Creates a deeply-reactive store backed by a Proxy. Reads track each property
 * accessed; only the parts that change trigger updates.
 *
 * Store properties hold **plain values**, not accessors. The proxy already
 * tracks reads per-property — wrapping a value in `() => state.foo` produces
 * a getter that *won't* track when called, which looks like a reactivity bug
 * but is just a category error. If you have a signal-shaped piece of state,
 * make it a property of the store (`{ foo: 1 }`) rather than nesting an
 * accessor inside (`{ foo: () => signal() }`).
 *
 * The setter takes a **draft-mutating** function — mutate the draft in place
 * (canonical). The callback may also return a new value: arrays are replaced
 * by index (length adjusted), objects are shallow-diffed at the top level
 * (keys present in the returned value are written, missing keys deleted). Use
 * the return form for shapes where mutation is awkward — most commonly
 * removing items via `filter`. The setter does **not** do keyed reconciliation;
 * for that, use the derived/projection form (or `createProjection`).
 *
 * - Plain form: `createStore(initialValue)` — wraps a value in a reactive
 *   proxy.
 * - Derived form: `createStore(fn, seed, options?)` — a *projection store*
 *   whose contents are computed by `fn(draft)`. `fn` may be sync, async, or
 *   an `AsyncIterable`; the projection's result reconciles against the
 *   existing store by `options.key` (default `"id"`) for stable identity.
 *
 * @example
 * ```ts
 * const [state, setState] = createStore({
 *   user: { name: "Ada", age: 36 },
 *   todos: [] as { id: string; text: string; done: boolean }[]
 * });
 *
 * // Canonical: mutate the draft in place.
 * setState(s => { s.user.age = 37; });
 * setState(s => { s.todos.push({ id: "1", text: "x", done: false }); });
 *
 * // Return form: reach for it when mutation is awkward.
 * setState(s => s.todos.filter(t => !t.done));               // remove items
 * setState(s => ({ ...s, user: { name: "Grace", age: 85 } })); // shallow replace
 * ```
 *
 * @example
 * ```ts
 * // Derived store — auto-fetches & reconciles by `id`.
 * const [users] = createStore(
 *   async () => fetch("/users").then(r => r.json()),
 *   [] as User[]
 * );
 * ```
 *
 * @returns `[store: Store<T>, setStore: StoreSetter<T>]`
 */
export function createStore<T extends object = {}>(
  store: NoFn<T> | Store<NoFn<T>>
): [get: Store<T>, set: StoreSetter<T>];
export function createStore<T extends object = {}>(
  fn: (store: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  store: Partial<T> | Store<NoFn<T>>,
  options?: ProjectionOptions
): [get: Refreshable<Store<T>>, set: StoreSetter<T>];
export function createStore<T extends object = {}>(
  first: T | ((store: T) => void | T | Promise<void | T> | AsyncIterable<void | T>),
  second?: NoFn<T> | Store<NoFn<T>>,
  options?: ProjectionOptions
): [get: Store<T>, set: StoreSetter<T>] {
  const derived = typeof first === "function",
    wrappedStore = derived
      ? createProjectionInternal(first, second as NoFn<T> | Store<NoFn<T>>, options).store
      : wrap(first);

  if (__DEV__) registerGraph(wrappedStore, getOwner());

  return [wrappedStore, (fn: (draft: T) => void): void => storeSetter(wrappedStore, fn)];
}
