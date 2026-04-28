import { computed, getOwner, handleAsync, type Computed, type Refreshable } from "../core/index.js";
import { setProjectionWriteActive } from "../core/scheduler.js";
import { reconcile } from "./reconcile.js";
import {
  $TARGET,
  createStoreProxy,
  setWriteOverride,
  STORE_FIREWALL,
  STORE_LOOKUP,
  STORE_WRAP,
  storeSetter,
  storeTraps,
  type ProjectionOptions,
  type Store
} from "./store.js";

export function createProjectionInternal<T extends object = {}>(
  fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  seed: Partial<T>,
  options?: ProjectionOptions
) {
  let node;
  const wrappedMap = new WeakMap();
  const wrapper = s => {
    s[STORE_WRAP] = wrapProjection;
    s[STORE_LOOKUP] = wrappedMap;
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
  const wrappedStore = wrapProjection(seed) as Store<T>;

  node = computed(
    () => {
      if (!node) node = getOwner();
      runProjectionComputed(wrappedStore, fn, options?.key || "id");
    },
    __DEV__ && options?.name ? { name: options.name } : undefined
  );
  (node as any)._preventAutoDisposal = true;

  return { store: wrappedStore, node } as {
    store: Refreshable<Store<T>>;
    node: Computed<void | T>;
  };
}

/**
 * Creates a derived (projected) store. Like `createMemo` but for stores: the
 * derive function receives a mutable draft and either mutates it in place
 * (canonical) or returns a new value. Either way the result is reconciled
 * against the previous draft by `options.key` (default `"id"`), so surviving
 * items keep their proxy identity — only added/removed items are
 * created/disposed.
 *
 * Returns the projected store directly (no setter — reads only).
 *
 * Use this when you want the structural-sharing / per-property tracking
 * behaviour of a store on top of a derived computation. For simple read-only
 * derivations, `createMemo` is lighter.
 *
 * @param fn receives the current draft; mutate it in place or return new
 *   data. Return is convenient for filter/derive shapes where mutation is
 *   awkward.
 * @param seed the backing store value to wrap and reconcile into
 * @param options `ProjectionOptions` — `name`, `key`. `key` defaults to
 *   `"id"`; specify it only when your data uses a different identity field
 *   (e.g. `{ key: "uuid" }` or `{ key: u => u.slug }`).
 *
 * @example
 * ```ts
 * // Mutation form — update individual fields on the draft.
 * const summary = createProjection<{ total: number; active: number }>(
 *   draft => {
 *     draft.total = users().length;
 *     draft.active = users().filter(u => u.active).length;
 *   },
 *   { total: 0, active: 0 }
 * );
 *
 * // Return form — produce a derived collection. Reconciled by `id` so each
 * // surviving user keeps the same store identity across recomputes.
 * const activeUsers = createProjection<User[]>(
 *   () => allUsers().filter(u => u.active),
 *   []
 * );
 * ```
 *
 * @see {@link https://github.com/solidjs/x-reactivity#createprojection}
 */
export function createProjection<T extends object = {}>(
  fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  seed: Partial<T>,
  options?: ProjectionOptions
): Refreshable<Store<T>> {
  return createProjectionInternal(fn, seed, options).store;
}

/**
 * Shared projection computed body used by both `createProjection` and the derived
 * form of `createOptimisticStore`. Encapsulates the write-trap draft, `storeSetter`
 * wrapping, the `handleAsync` subscription with a setter callback, and the commit
 * path (which must always go through `storeSetter` so the `writeOnly` guard is
 * engaged during `reconcile`'s property reads).
 *
 * `wrapCommit` is invoked for every commit (sync return and each async yield) and
 * lets callers layer extra context around the write — e.g. the optimistic store
 * re-enters `setProjectionWriteActive` so reconciles target `STORE_OVERRIDE`
 * instead of `STORE_OPTIMISTIC_OVERRIDE` even when an async yield fires outside
 * the outer `setProjectionWriteActive` scope.
 */
export function runProjectionComputed<T extends object>(
  wrappedStore: Store<T>,
  fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  key: string | ((item: NonNullable<any>) => any),
  wrapCommit?: (write: () => void) => void
): Computed<void | T> {
  const owner = getOwner() as Computed<void | T>;
  let settled = false;
  let result: void | T | Promise<void | T> | AsyncIterable<void | T>;
  const draft = new Proxy(
    wrappedStore,
    createWriteTraps(() => !settled || owner._inFlight === result)
  );
  storeSetter<T>(draft, s => {
    result = fn(s);
    settled = true;
    const commit = (v: void | T) => {
      if (v === s || v === undefined) return;
      const write = () => storeSetter(wrappedStore, reconcile(v, key));
      wrapCommit ? wrapCommit(write) : write();
    };
    commit(handleAsync(owner, result, commit));
  });
  return owner;
}

export function createWriteTraps(isActive?: () => boolean): ProxyHandler<any> {
  const traps: ProxyHandler<any> = {
    get(_, prop) {
      let value;
      setWriteOverride(true);
      setProjectionWriteActive(true);
      try {
        value = _[prop];
      } finally {
        setWriteOverride(false);
        setProjectionWriteActive(false);
      }
      return typeof value === "object" && value !== null ? new Proxy(value, traps) : value;
    },
    has(_, prop) {
      let value;
      setWriteOverride(true);
      setProjectionWriteActive(true);
      try {
        value = prop in _;
      } finally {
        setWriteOverride(false);
        setProjectionWriteActive(false);
      }
      return value;
    },
    set(_, prop, value) {
      if (isActive && !isActive()) return true;
      setWriteOverride(true);
      setProjectionWriteActive(true);
      try {
        _[prop] = value;
      } finally {
        setWriteOverride(false);
        setProjectionWriteActive(false);
      }
      return true;
    },
    deleteProperty(_, prop) {
      if (isActive && !isActive()) return true;
      setWriteOverride(true);
      setProjectionWriteActive(true);
      try {
        delete _[prop];
      } finally {
        setWriteOverride(false);
        setProjectionWriteActive(false);
      }
      return true;
    }
  };
  return traps;
}

export const writeTraps: ProxyHandler<any> = createWriteTraps();
