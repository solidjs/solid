import {
  computed,
  CONFIG_AUTO_DISPOSE,
  getOwner,
  handleAsync,
  type Computed,
  type Refreshable
} from "../core/index.js";
import { projectionWriteActive, setProjectionWriteActive } from "../core/scheduler.js";
import { reconcileState } from "./reconcile.js";
import {
  $TARGET,
  createStoreProxy,
  setWriteOverride,
  STORE_FIREWALL,
  STORE_LOOKUP,
  STORE_SHALLOW,
  STORE_VALUE,
  STORE_WRAP,
  markRawIngest,
  storeSetter,
  storeTraps,
  type NoFn,
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
  // A shallow projection's children are raw and never wrapped, so the
  // wrapper only ever runs for the root — flagging unconditionally is safe.
  const shallow = !!(options as any)?.shallow;
  const wrapper = s => {
    s[STORE_WRAP] = wrapProjection;
    s[STORE_LOOKUP] = wrappedMap;
    if (shallow) {
      s[STORE_SHALLOW] = true;
      markRawIngest(s[STORE_VALUE]);
    }
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

  // seedLoadingValue: the firewall is born committed (the seed is commit #0);
  // the internal handleAsync serves it during the derive's first flight. The
  // node's own value channel is void, so the loading value itself is
  // `undefined` — presence of the key is what flips the mode.
  let nodeOptions: { name?: string; loadingValue?: void } | undefined;
  if (options?.seedLoadingValue) nodeOptions = { loadingValue: undefined };
  if (__DEV__ && options?.name) nodeOptions = { ...nodeOptions, name: options.name };
  node = computed(() => {
    if (!node) node = getOwner();
    runProjectionComputed(wrappedStore, fn, options?.key === undefined ? "id" : options.key);
  }, nodeOptions);
  node._config &= ~CONFIG_AUTO_DISPOSE;

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
 * If the derive returns a different entity than the one currently held (the
 * `/users/1` → `/users/2` shape), the store swaps to it rather than merging,
 * and nothing below it is treated as surviving.
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
 *   (e.g. `{ key: "uuid" }` or `{ key: u => u.slug }`), or `null` to merge
 *   positionally with no keyed pass.
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
  seed: Partial<T> | Store<NoFn<T>>,
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
  key: string | ((item: NonNullable<any>) => any) | null,
  wrapCommit?: (write: () => void) => void,
  onDraftWrite?: () => void
): Computed<void | T> {
  const owner = getOwner() as Computed<void | T>;
  let settled = false;
  let result: void | T | Promise<void | T> | AsyncIterable<void | T>;
  // Open loading window (seedLoadingValue): the observable store IS commit #0
  // for the whole first flight, so the derive works a detached shadow of the
  // seed — draft writes (pre-await, or between yields) land on the shadow and
  // cannot tear through to readers (#2988; store reads resolve from the live
  // backing, and the born-committed firewall removed the status gate that hid
  // windowless drafts). Every commit point — sync return, each yield, the
  // async landing — reconciles the shadow through the normal commit path, so
  // a fully-sync derive still lands immediately (commit #0 superseded before
  // any observer runs, same as a sync answer superseding loadingValue). The
  // JSON round-trip matches the server's frozen-seed copy (seedLock): a
  // loading-window seed is renderable data by contract. Optimistic note:
  // onDraftWrite (override clearing) shifts from write-time to commit-time
  // for the shadow run — an invisible draft write must not clobber a visible
  // optimistic override mid-window.
  const shadow = owner._loading
    ? (JSON.parse(JSON.stringify((wrappedStore as any)[$TARGET][STORE_VALUE])) as T)
    : null;
  const draft = new Proxy(
    wrappedStore,
    createWriteTraps(() => !settled || owner._inFlight === result, onDraftWrite)
  );
  storeSetter<T>(draft, s => {
    result = fn(shadow ?? s);
    settled = true;
    const commit = (v: void | T) => {
      // Shadow run: a void/self return is the mutation form — the shadow
      // carries the writes and is what commits. Commit a detached snapshot,
      // never the shadow itself: reconcile adopts a new root value by
      // identity, and handing it the live shadow would fuse the draft to the
      // observable store — later shadow writes would mutate the backing
      // silently and the next yield would diff the shadow against itself.
      if (shadow && (v === undefined || v === shadow)) v = JSON.parse(JSON.stringify(shadow)) as T;
      if (v === s || v === undefined) return;
      const write = () => storeSetter(wrappedStore, s => reconcileState(v, s, key, true));
      wrapCommit ? wrapCommit(write) : write();
    };
    const sync = handleAsync(owner, result, commit);
    // A still-open window after handleAsync means the return was the
    // commit-#0 fall-through, not a landing — real landings arrive through
    // the setter. A closed one is a genuine sync landing (windowless nodes
    // were never open); commit it.
    if (!owner._loading) commit(sync);
  });
  return owner;
}

export function createWriteTraps(
  isActive?: () => boolean,
  onDraftWrite?: () => void
): ProxyHandler<any> {
  // Save/restore, never hard-reset: the draft can be driven from inside an
  // enclosing authoritative-write scope (next-store optimistic derives), and
  // a hard `false` would clobber it mid-derive.
  const traps: ProxyHandler<any> = {
    get(_, prop) {
      let value;
      const was = projectionWriteActive;
      setWriteOverride(true);
      setProjectionWriteActive(true);
      try {
        value = _[prop];
      } finally {
        setWriteOverride(false);
        setProjectionWriteActive(was);
      }
      if (prop === $TARGET) return value;
      return typeof value === "object" && value !== null ? new Proxy(value, traps) : value;
    },
    has(_, prop) {
      let value;
      const was = projectionWriteActive;
      setWriteOverride(true);
      setProjectionWriteActive(true);
      try {
        value = prop in _;
      } finally {
        setWriteOverride(false);
        setProjectionWriteActive(was);
      }
      return value;
    },
    set(_, prop, value) {
      if (isActive && !isActive()) return true;
      const was = projectionWriteActive;
      setWriteOverride(true);
      setProjectionWriteActive(true);
      try {
        _[prop] = value;
        onDraftWrite?.();
      } finally {
        setWriteOverride(false);
        setProjectionWriteActive(was);
      }
      return true;
    },
    deleteProperty(_, prop) {
      if (isActive && !isActive()) return true;
      const was = projectionWriteActive;
      setWriteOverride(true);
      setProjectionWriteActive(true);
      try {
        delete _[prop];
        onDraftWrite?.();
      } finally {
        setWriteOverride(false);
        setProjectionWriteActive(was);
      }
      return true;
    }
  };
  return traps;
}
