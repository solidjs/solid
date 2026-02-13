import {
  $REFRESH,
  computed,
  getOwner,
  handleAsync,
  setSignal,
  type Computed
} from "../core/index.js";
import { GlobalQueue, setProjectionWriteActive } from "../core/scheduler.js";
import { writeTraps } from "./projection.js";
import { reconcile } from "./reconcile.js";
import {
  $DELETED,
  $TARGET,
  $TRACK,
  createStoreProxy,
  isWrappable,
  STORE_FIREWALL,
  STORE_LOOKUP,
  STORE_NODE,
  STORE_OPTIMISTIC,
  STORE_OPTIMISTIC_OVERRIDE,
  STORE_OVERRIDE,
  STORE_VALUE,
  STORE_WRAP,
  storeSetter,
  storeTraps,
  wrap,
  type NoFn,
  type ProjectionOptions,
  type Store,
  type StoreNode,
  type StoreSetter
} from "./store.js";

/**
 * Creates an optimistic store that can be used to optimistically update a value
 * and then revert it back to the previous value at end of transition.
 *
 * When called with a plain value, creates an optimistic store.
 * When called with a function, creates a derived optimistic store with `ProjectionOptions` (name, key, all).
 *
 * @param fn a function that receives the current store and can be used to mutate it directly inside a transition
 * @param initial The initial value of the store.
 * @param options Optional projection options for reconciliation.
 *
 * @returns A tuple containing a store accessor and a setter function to apply changes.
 */
export function createOptimisticStore<T extends object = {}>(
  store: NoFn<T> | Store<NoFn<T>>
): [get: Store<T>, set: StoreSetter<T>];
export function createOptimisticStore<T extends object = {}>(
  fn: (store: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  store?: NoFn<T> | Store<NoFn<T>>,
  options?: ProjectionOptions
): [get: Store<T> & { [$REFRESH]: any }, set: StoreSetter<T>];
export function createOptimisticStore<T extends object = {}>(
  first: T | ((store: T) => void | T | Promise<void | T> | AsyncIterable<void | T>),
  second?: NoFn<T> | Store<NoFn<T>>,
  options?: ProjectionOptions
): [get: Store<T>, set: StoreSetter<T>] {
  // Register clear function with scheduler
  GlobalQueue._clearOptimisticStore ||= clearOptimisticStore;
  const derived = typeof first === "function";
  const initialValue = ((derived ? second : first) as T) ?? ({} as T);
  const fn = derived
    ? (first as (store: T) => void | T | Promise<void | T> | AsyncIterable<void | T>)
    : undefined;

  // Create optimistic projection store
  const { store: wrappedStore } = createOptimisticProjectionInternal(fn, initialValue, options);

  return [wrappedStore, (fn: (draft: T) => void): void => storeSetter(wrappedStore, fn)];
}

// Clear optimistic override for a store and notify signals
function clearOptimisticStore(store: any): void {
  const target = store[$TARGET] as StoreNode | undefined;
  if (!target || !target[STORE_OPTIMISTIC_OVERRIDE]) return;

  const override = target[STORE_OPTIMISTIC_OVERRIDE];
  const nodes = target[STORE_NODE];

  // Notify signals for all overridden properties
  // Use projectionWriteActive to bypass optimistic signal behavior (no lane creation)
  // This ensures reversion effects go to regular queues, not lane queues
  setProjectionWriteActive(true);
  try {
    if (nodes) {
      for (const key of Reflect.ownKeys(override)) {
        if (nodes[key]) {
          // Clear lane association so effects go to regular queue
          nodes[key]._optimisticLane = undefined;
          // Re-read from base (STORE_OVERRIDE or STORE_VALUE)
          const baseValue =
            target[STORE_OVERRIDE] && key in target[STORE_OVERRIDE]
              ? target[STORE_OVERRIDE][key]
              : target[STORE_VALUE][key];
          const value = baseValue === $DELETED ? undefined : baseValue;
          setSignal(nodes[key], isWrappable(value) ? wrap(value, target) : value);
        }
      }
      // Notify $TRACK
      if (nodes[$TRACK]) {
        nodes[$TRACK]._optimisticLane = undefined;
        setSignal(nodes[$TRACK], undefined);
      }
    }
  } finally {
    setProjectionWriteActive(false);
  }

  // Clear the optimistic override
  delete target[STORE_OPTIMISTIC_OVERRIDE];
}

function createOptimisticProjectionInternal<T extends object = {}>(
  fn: ((draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>) | undefined,
  initialValue: T = {} as T,
  options?: ProjectionOptions
) {
  let node: Computed<void> | undefined;
  const wrappedMap = new WeakMap();

  const wrapper = (s: any) => {
    s[STORE_WRAP] = wrapProjection;
    s[STORE_LOOKUP] = wrappedMap;
    s[STORE_OPTIMISTIC] = true; // Mark as optimistic store
    Object.defineProperty(s, STORE_FIREWALL, {
      get() {
        return node;
      },
      configurable: true
    });
  };

  const wrapProjection = (source: T) => {
    if (wrappedMap.has(source)) return wrappedMap.get(source);
    if (source[$TARGET]?.[STORE_WRAP] === wrapProjection) return source;
    const wrapped = createStoreProxy(source, storeTraps, wrapper);
    wrappedMap.set(source, wrapped);
    return wrapped;
  };

  const wrappedStore: Store<T> = wrapProjection(initialValue);

  // If there's a projection function, create a computed to drive it
  if (fn) {
    node = computed(() => {
      const owner = getOwner() as Computed<void | T>;
      // All writes inside firewall recompute go to STORE_OVERRIDE (base), not STORE_OPTIMISTIC_OVERRIDE
      setProjectionWriteActive(true);
      try {
        storeSetter<T>(new Proxy(wrappedStore, writeTraps), s => {
          const value = handleAsync(owner, fn(s), value => {
            // Async callback still needs projectionWriteActive for reconcile
            setProjectionWriteActive(true);
            try {
              value !== s &&
                value !== undefined &&
                storeSetter(wrappedStore, reconcile(value, options?.key || "id", options?.all));
            } finally {
              setProjectionWriteActive(false);
            }
          });
          value !== s &&
            value !== undefined &&
            reconcile(value, options?.key || "id", options?.all)(wrappedStore);
        });
      } finally {
        setProjectionWriteActive(false);
      }
    });
    (node as any)._preventAutoDisposal = true;
  }

  return { store: wrappedStore, node } as {
    store: Store<T> & { [$REFRESH]: any };
    node: Computed<void> | undefined;
  };
}
