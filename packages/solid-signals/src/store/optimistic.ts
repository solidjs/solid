import {
  computed,
  CONFIG_AUTO_DISPOSE,
  NOT_PENDING,
  type Computed,
  type Refreshable
} from "../core/index.js";
import { installOptimisticEngine } from "../core/optimistic.js";
import {
  GlobalQueue,
  insertSubs,
  projectionWriteActive,
  schedule,
  setProjectionWriteActive
} from "../core/scheduler.js";
import { runProjectionComputed } from "./projection.js";
import {
  $DELETED,
  $TARGET,
  $TRACK,
  createStoreProxy,
  getOverlayLayer,
  isWrappable,
  STORE_FIREWALL,
  STORE_LOOKUP,
  STORE_NODE,
  STORE_OPTIMISTIC,
  STORE_OPTIMISTIC_OVERRIDE,
  STORE_VALUE,
  STORE_WRAP,
  notifySelf,
  storeSetter,
  storeTraps,
  visibleNodeValue,
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
 * `options.key` defaults to `"id"`; specify it only when your data uses a
 * different identity field (e.g. `{ key: "uuid" }` or `{ key: t => t.slug }`).
 * Restating the default just adds noise.
 *
 * @example
 * ```ts
 * const [todos, setTodos] = createOptimisticStore<Todo[]>([]);
 *
 * // Mutation: optimistic add, then in-place reconcile to the saved row.
 * const addTodo = action(function* (text: string) {
 *   const tempId = crypto.randomUUID();
 *   setTodos(t => { t.push({ id: tempId, text, pending: true }); });
 *   const saved = yield api.createTodo(text);
 *   setTodos(t => {
 *     const i = t.findIndex(x => x.id === tempId);
 *     if (i >= 0) t[i] = saved;
 *   });
 * });
 *
 * // Return form: filter is the natural shape for removal.
 * const removeTodo = action(function* (id: string) {
 *   setTodos(t => t.filter(x => x.id !== id));
 *   yield api.removeTodo(id);
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
): [get: Refreshable<Store<T>>, set: StoreSetter<T>];
export function createOptimisticStore<T extends object = {}>(
  first: T | ((store: T) => void | T | Promise<void | T> | AsyncIterable<void | T>),
  second?: NoFn<T> | Store<NoFn<T>>,
  options?: ProjectionOptions
): [get: Store<T>, set: StoreSetter<T>] {
  // Register clear function with scheduler; store nodes marked
  // STORE_OPTIMISTIC take the engine's write path, so install it before any
  // node can be created.
  installOptimisticEngine();
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
  if (!target?.[STORE_OPTIMISTIC_OVERRIDE]) return;

  clearOptimisticOverride(target);
}

function clearOptimisticOverride(target: StoreNode): void {
  const override = target[STORE_OPTIMISTIC_OVERRIDE];
  if (!override) return;
  const nodes = target[STORE_NODE];
  delete target[STORE_OPTIMISTIC_OVERRIDE];

  // Notify signals for all overridden properties
  // Use projectionWriteActive to bypass optimistic signal behavior (no lane creation)
  // This ensures reversion effects go to regular queues, not lane queues
  const wasProjectionWriteActive = projectionWriteActive;
  setProjectionWriteActive(true);
  try {
    if (nodes) {
      for (const key of Reflect.ownKeys(override)) {
        if (nodes[key]) {
          const node = nodes[key];
          // Clear lane association so effects go to regular queue
          node._optimisticLane = undefined;
          // Re-read from base — the optimistic layer was deleted above, so the
          // overlay resolves to STORE_OVERRIDE or STORE_VALUE.
          const layer = getOverlayLayer(target, key);
          const baseValue = layer ? layer[key] : target[STORE_VALUE][key];
          const value = baseValue === $DELETED ? undefined : baseValue;
          const next = isWrappable(value) ? wrap(value, target) : value;
          const prev = visibleNodeValue(node);
          node._overrideValue = NOT_PENDING;
          node._pendingValue = NOT_PENDING;
          node._value = next;
          if (!node._equals || !node._equals(prev, next)) {
            insertSubs(node, true);
            schedule();
          }
        }
      }
      // Notify $TRACK
      if (nodes[$TRACK]) {
        nodes[$TRACK]._optimisticLane = undefined;
        notifySelf(target);
      }
    }
  } finally {
    setProjectionWriteActive(wasProjectionWriteActive);
  }
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
    // async yields because they fire outside any enclosing try/finally. It also
    // consumes stale optimistic overlays once fresh projected data lands.
    const clearProjectionOverride = () => {
      const target = wrappedStore[$TARGET] as StoreNode | undefined;
      if (target?.[STORE_OPTIMISTIC_OVERRIDE]) clearOptimisticOverride(target);
    };
    const wrapCommit = (write: () => void) => {
      const wasProjectionWriteActive = projectionWriteActive;
      setProjectionWriteActive(true);
      try {
        write();
        clearProjectionOverride();
      } finally {
        setProjectionWriteActive(wasProjectionWriteActive);
      }
    };
    node = computed(
      () => {
        setProjectionWriteActive(true);
        try {
          runProjectionComputed(
            wrappedStore,
            fn,
            options?.key || "id",
            wrapCommit,
            clearProjectionOverride
          );
        } finally {
          setProjectionWriteActive(false);
        }
      },
      __DEV__ && options?.name ? { name: options.name } : undefined
    ) as Computed<void>;
    node._config &= ~CONFIG_AUTO_DISPOSE;
  }

  return { store: wrappedStore, node } as {
    store: Refreshable<Store<T>>;
    node: Computed<void> | undefined;
  };
}
