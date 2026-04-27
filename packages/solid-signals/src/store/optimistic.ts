import {
  $REFRESH,
  computed,
  getOwner,
  handleAsync,
  setSignal,
  type Computed
} from "../core/index.js";
import { GlobalQueue, setProjectionWriteActive } from "../core/scheduler.js";
import { runProjectionComputed } from "./projection.js";
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
 * The store equivalent of `createOptimistic`. Writes inside an `action`
 * transition are tentative — they show up immediately but auto-revert (or
 * reconcile to the action's resolved value) once the transition finishes.
 *
 * Use this for optimistic UI on collection-shaped data. For single-value
 * optimistic state, prefer `createOptimistic`.
 *
 * - Plain form: `createOptimisticStore(initialValue)`.
 * - Derived form: `createOptimisticStore(fn, seed, options?)` — a projection
 *   store whose authoritative value is recomputed by `fn` and whose
 *   optimistic overlay reverts after each transition.
 *
 * @example
 * ```ts
 * const [todos, setTodos] = createOptimisticStore<Todo[]>([]);
 *
 * const addTodo = action(function* (text: string) {
 *   const tempId = crypto.randomUUID();
 *   setTodos(t => { t.push({ id: tempId, text, pending: true }); }); // optimistic
 *   const saved = yield api.createTodo(text);
 *   setTodos(t => {
 *     const i = t.findIndex(x => x.id === tempId);
 *     if (i >= 0) t[i] = saved;
 *   });
 * });
 * ```
 *
 * @returns `[store: Store<T>, setStore: StoreSetter<T>]`
 */
export function createOptimisticStore<T extends object = {}>(
  store: NoFn<T> | Store<NoFn<T>>
): [get: Store<T>, set: StoreSetter<T>];
export function createOptimisticStore<T extends object = {}>(
  fn: (store: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  store: Partial<T> | Store<NoFn<T>>,
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
  const initialValue = (derived ? second : first) as T;
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
  initialValue: Partial<T>,
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

  const wrapProjection = (source: Partial<T>) => {
    if (wrappedMap.has(source)) return wrappedMap.get(source);
    if (source[$TARGET]?.[STORE_WRAP] === wrapProjection) return source;
    const wrapped = createStoreProxy(source, storeTraps, wrapper);
    wrappedMap.set(source, wrapped);
    return wrapped;
  };

  const wrappedStore = wrapProjection(initialValue) as Store<T>;

  // If there's a projection function, create a computed to drive it
  if (fn) {
    // All writes inside firewall recompute must go to STORE_OVERRIDE (base), not
    // STORE_OPTIMISTIC_OVERRIDE. The outer wrap covers the sync body (including
    // `fn(draft)` and the initial commit); `wrapCommit` re-applies the flag for
    // async yields because they fire outside any enclosing try/finally.
    const wrapCommit = (write: () => void) => {
      setProjectionWriteActive(true);
      try {
        write();
      } finally {
        setProjectionWriteActive(false);
      }
    };
    node = computed(
      () => {
        setProjectionWriteActive(true);
        try {
          runProjectionComputed(wrappedStore, fn, options?.key || "id", wrapCommit);
        } finally {
          setProjectionWriteActive(false);
        }
      },
      __DEV__ && options?.name ? { name: options.name } : undefined
    ) as Computed<void>;
    (node as any)._preventAutoDisposal = true;
  }

  return { store: wrappedStore, node } as {
    store: Store<T> & { [$REFRESH]: any };
    node: Computed<void> | undefined;
  };
}
