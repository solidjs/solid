import {
  computed,
  CONFIG_AUTO_DISPOSE,
  NOT_PENDING,
  type Computed,
  type Refreshable
} from "../core/index.js";
import { installOptimisticEngine } from "../core/optimistic.js";
import {
  currentTransition,
  GlobalQueue,
  insertSubs,
  projectionWriteActive,
  schedule,
  setProjectionWriteActive,
  type Transition
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
  STORE_OPTIMISTIC_OWNERS,
  STORE_VALUE,
  STORE_SHALLOW,
  STORE_WRAP,
  markRawIngest,
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
  store: NoFn<T> | Store<NoFn<T>>,
  options?: ProjectionOptions
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
  GlobalQueue._clearOptimisticStores ||= clearOptimisticStores;
  const derived = typeof first === "function";
  // Plain form: the second slot carries options.
  if (!derived && options === undefined) options = second as ProjectionOptions | undefined;
  const initialValue = (derived ? second : first) as T;
  const fn = derived
    ? (first as (store: T) => void | T | Promise<void | T> | AsyncIterable<void | T>)
    : undefined;

  // Create optimistic projection store
  const { store: wrappedStore } = createOptimisticProjectionInternal(fn, initialValue, options);

  return [wrappedStore, (fn: (draft: T) => void): void => storeSetter(wrappedStore, fn)];
}

// Clear the optimistic overrides of a settling batch of stores and notify
// signals. Owns the whole batch (iterate + clear + reschedule) so the
// scheduler's flush tail carries only a size-guarded hook call. The
// completing transition scopes each clear to its own layer keys (#2899).
function clearOptimisticStores(stores: Set<any>, completing: Transition | null): void {
  for (const store of stores) {
    const target = store[$TARGET] as StoreNode | undefined;
    if (target?.[STORE_OPTIMISTIC_OVERRIDE]) clearOptimisticOverride(target, completing);
  }
  stores.clear();
  schedule();
}

/**
 * Consume optimistic layer entries and reset their backing nodes to base.
 * With `completing` (settle path, #2899) only entries the settling
 * transaction owns are consumed — the layer is store-wide but concurrent
 * actions revert independently, so keys stamped by a still-in-flight
 * transition survive (node-level overrides already have this granularity via
 * _optimisticNodes; this is the layer's half). `null` consumes ambient
 * (transaction-less) entries at plain flush end. Omitted (projection landing:
 * fresh authoritative data) consumes everything — the correction supersedes
 * every tentative layer.
 */
function clearOptimisticOverride(target: StoreNode, completing?: Transition | null): void {
  const override = target[STORE_OPTIMISTIC_OVERRIDE];
  if (!override) return;
  const nodes = target[STORE_NODE];
  const owners = target[STORE_OPTIMISTIC_OWNERS];
  const scoped = completing !== undefined;
  let cleared = false;
  let remaining = false;

  // Use projectionWriteActive to bypass optimistic signal behavior (no lane creation)
  // This ensures reversion effects go to regular queues, not lane queues
  const wasProjectionWriteActive = projectionWriteActive;
  setProjectionWriteActive(true);
  try {
    for (const key of Reflect.ownKeys(override)) {
      if (scoped) {
        let owner = owners?.[key] ?? null;
        // Resolve merge chains (entangled actions settle as one); path-compress
        // so later keys skip the walk. A dead owner (`_done === true`) settled
        // through some other path — never strand its entry. A null owner is an
        // ambient write: its batch belongs to whichever transaction adopted it
        // (initTransition mid-batch) or to the plain flush, so it clears on
        // whichever clear call reaches this store first.
        if (owner) {
          if (typeof owner._done === "object") owner = owners![key] = currentTransition(owner);
          if (owner !== completing && owner._done !== true) {
            remaining = true;
            continue;
          }
        }
      }
      delete override[key];
      if (owners) delete owners[key];
      cleared = true;
      const node = nodes?.[key];
      if (node) {
        // Clear lane association so effects go to regular queue
        node._optimisticLane = undefined;
        // Re-read from base — this key left the optimistic layer above, so the
        // overlay resolves to STORE_OVERRIDE or STORE_VALUE.
        const layer = getOverlayLayer(target, key);
        const baseValue = layer ? layer[key] : target[STORE_VALUE][key];
        const value = baseValue === $DELETED ? undefined : baseValue;
        const next = isWrappable(value) ? wrap(value, target) : value;
        const prev = visibleNodeValue(node);
        node._overrideValue = NOT_PENDING;
        node._overrideOwner = null;
        node._pendingValue = NOT_PENDING;
        node._value = next;
        if (!node._equals || !node._equals(prev, next)) {
          insertSubs(node, true);
          schedule();
        }
      }
    }
    if (!remaining) {
      // Assignment, not delete: StoreNode targets share one pre-initialized
      // hidden class (see createStoreProxy) and a delete would demote it.
      target[STORE_OPTIMISTIC_OVERRIDE] = undefined;
      target[STORE_OPTIMISTIC_OWNERS] = undefined;
    }
    // Notify $TRACK
    if (cleared && nodes?.[$TRACK]) {
      nodes[$TRACK]._optimisticLane = undefined;
      notifySelf(target);
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

  const shallow = !!(options as any)?.shallow;
  const wrapper = (s: any) => {
    s[STORE_WRAP] = wrapProjection;
    s[STORE_LOOKUP] = wrappedMap;
    if (shallow) {
      s[STORE_SHALLOW] = true;
      markRawIngest(s[STORE_VALUE]);
    }
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
