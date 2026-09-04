/**
 * Store rewrite — projections (§7/§7b): a projection is a computed store.
 * The derive runs inside a computed whose recompute merges its output into
 * the projection's backing through the adoption channel (replace-mode root:
 * entity changes merge in place, the root proxy is stable for life). Children
 * wrap into the projection's own FAMILY (writes land here, never in a source
 * family), and every family node carries the projection computed as its
 * firewall — reads link the derive's status and lifecycle natively. The §6c
 * status gate in the traps makes an uninitialized async derive's seed
 * unobservable through every read surface.
 *
 * Mirrors the legacy runProjectionComputed shape (shadow runs for open
 * loading windows, handleAsync landings, commit-through-setter) on next
 * primitives; the generic draft write-traps are reused from the legacy
 * module unchanged.
 */
import { ext } from "../../core/core.js";
import {
  computed,
  CONFIG_AUTO_DISPOSE,
  getOwner,
  handleAsync,
  suppressComputedRecompute,
  type Computed,
  type Refreshable
} from "../../core/index.js";
import { STATUS_UNINITIALIZED } from "../../core/constants.js";

import { projectionWriteActive, setProjectionWriteActive } from "../../core/scheduler.js";
import {
  $TARGET,
  markRawIngest,
  setWriteOverride,
  STORE_VALUE,
  type NoArray,
  type NoFn,
  type ProjectionOptions,
  type SeededProjectionOptions,
  type Store
} from "../store.js";
import { reconcileNextState } from "./reconcile.js";
import { storeSetterNext, wrapNext } from "./store.js";
import type { StoreNextFamily } from "./target.js";

export function validateStoreValue(value: void | object): void {
  if (value === undefined) throw new Error("A seedless store projection must produce a value");
  if (value === null || typeof value !== "object")
    throw new Error("A seedless store projection must produce an object value");
  if (Array.isArray(value)) throw new Error("Array store projections require an explicit seed");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new Error("A seedless store projection must produce a plain object value");
}

export type ProjectionResultValidator<T extends object> = (
  value: void | T,
  owner: Computed<void | T>
) => void;

export function createReplayStoreValidator(
  replaying: () => boolean
): ProjectionResultValidator<any> {
  return (value, owner) => {
    if (!replaying() || owner._statusFlags & STATUS_UNINITIALIZED) validateStoreValue(value);
  };
}

/**
 * Wrap a store proxy as a projection DRAFT: every operation carries the write
 * override (the derive is the author — its ops must not hit the §6c firewall
 * gate, even in a continuation after an `await`/`yield` where the sync write
 * scope has closed).
 *
 * FAKE TARGET, not the store proxy itself (#3060): after a proxy trap
 * returns, the engine runs spec invariant validation against the proxy's
 * TARGET — [[OwnPropertyKeys]] after ownKeys, [[GetOwnProperty]] after
 * set/getOwnPropertyDescriptor/defineProperty. With the store proxy as
 * target those checks re-enter the store's traps OUTSIDE the override
 * bracket (the trap's finally has already run), so `Object.keys(state)` in
 * a derive continuation fired the firewall gate and re-threw the
 * projection's own pending NotReadyError into the derive. A dummy of
 * matching kind (array/object, same trick as the store's own TargetShape)
 * keeps invariant validation away from the store entirely; the traps
 * forward to the closed-over inner proxy inside the bracket.
 *
 * Save/restore projectionWriteActive, never hard-reset: the draft can be
 * driven from inside an enclosing authoritative-write scope (next-store
 * optimistic derives), and a hard `false` would clobber it mid-derive.
 */
function wrapDraft(
  inner: any,
  isActive?: () => boolean,
  aroundWrite?: (op: () => void) => void
): any {
  const write = (op: () => void) => (aroundWrite ? aroundWrite(op) : op());
  const traps: ProxyHandler<any> = {
    get(_, prop) {
      let value;
      const was = projectionWriteActive;
      setWriteOverride(true);
      setProjectionWriteActive(true);
      try {
        value = inner[prop];
      } finally {
        setWriteOverride(false);
        setProjectionWriteActive(was);
      }
      if (prop === $TARGET) return value;
      return typeof value === "object" && value !== null
        ? wrapDraft(value, isActive, aroundWrite)
        : value;
    },
    has(_, prop) {
      let value;
      const was = projectionWriteActive;
      setWriteOverride(true);
      setProjectionWriteActive(true);
      try {
        value = prop in inner;
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
        write(() => {
          inner[prop] = value;
        });
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
        write(() => {
          delete inner[prop];
        });
      } finally {
        setWriteOverride(false);
        setProjectionWriteActive(was);
      }
      return true;
    },
    ownKeys() {
      const was = projectionWriteActive;
      setWriteOverride(true);
      setProjectionWriteActive(true);
      try {
        return Reflect.ownKeys(inner);
      } finally {
        setWriteOverride(false);
        setProjectionWriteActive(was);
      }
    },
    getOwnPropertyDescriptor(_, prop) {
      let d;
      const was = projectionWriteActive;
      setWriteOverride(true);
      setProjectionWriteActive(true);
      try {
        d = Reflect.getOwnPropertyDescriptor(inner, prop);
      } finally {
        setWriteOverride(false);
        setProjectionWriteActive(was);
      }
      // The dummy target doesn't hold the key, so a non-configurable report
      // would violate the proxy invariant. Store descriptors are already
      // normalized configurable; enforce it for raw leaves too.
      if (d) d.configurable = true;
      return d;
    },
    defineProperty(_, prop, desc) {
      if (isActive && !isActive()) return true;
      const was = projectionWriteActive;
      setWriteOverride(true);
      setProjectionWriteActive(true);
      try {
        write(() => {
          Reflect.defineProperty(inner, prop, desc);
        });
      } finally {
        setWriteOverride(false);
        setProjectionWriteActive(was);
      }
      return true;
    }
  };
  // Matching-kind dummy so Array.isArray(draft) answers like the store.
  return new Proxy(Array.isArray(inner) ? [] : {}, traps);
}

function createProjectionNextInternal<T extends object = {}>(
  fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  initialValue: T,
  options?: SeededProjectionOptions,
  validateResult?: ProjectionResultValidator<T>
) {
  const fam: StoreNextFamily = {
    map: new WeakMap(),
    node: null,
    shallow: !!(options as any)?.shallow
  };
  const store = wrapNext(initialValue as any, null, null, fam) as Store<T>;
  if (fam.shallow) {
    // Shallow projection: the root is the only wrapped level — slot values
    // serve raw, ingests sticky raw-mark (same t.s machinery as plain).
    ((store as any)[$TARGET] as any).s = true;
    markRawIngest(initialValue);
  }

  let nodeOptions: { name?: string; loadingValue?: void } | undefined;
  if (options?.seedLoadingValue) nodeOptions = { loadingValue: undefined };
  if (__DEV__ && options?.name) nodeOptions = { ...nodeOptions, name: options.name };
  const node = computed(() => {
    if (!fam.node) fam.node = getOwner() as Computed<any>;
    runProjectionComputedNext(
      store,
      fn,
      options?.key === undefined ? "id" : options.key,
      undefined,
      undefined,
      validateResult
    );
  }, nodeOptions);
  node._config &= ~CONFIG_AUTO_DISPOSE;
  fam.node = node;

  return { store, node } as {
    store: Refreshable<Store<T>>;
    node: Computed<void | T>;
  };
}

export function createProjectionNext<T extends object = {}>(
  fn: (() => T | Promise<T> | AsyncIterable<T>) & NoArray<T> & NoFn<T>,
  seed?: null,
  options?: ProjectionOptions
): Refreshable<Store<T>>;
export function createProjectionNext<T extends object = {}>(
  fn: ((draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>) & NoFn<T>,
  seed: T,
  options?: SeededProjectionOptions
): Refreshable<Store<T>>;
export function createProjectionNext<T extends object = {}>(
  fn:
    | ((draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>)
    | (() => T | Promise<T> | AsyncIterable<T>),
  seed: T | null | undefined,
  options?: SeededProjectionOptions
): Refreshable<Store<T>> {
  const seeded = seed != null;
  if (!seeded && options?.seedLoadingValue)
    throw new Error("seedLoadingValue requires an explicit store seed");
  const derive = seeded ? fn : () => (fn as () => T | Promise<T> | AsyncIterable<T>)();
  return createProjectionNextInternal(
    derive,
    (seed ?? {}) as T,
    options,
    seeded ? undefined : validateStoreValue
  ).store;
}

/** @internal Hydration replay starts with a complete snapshot, then mutates a private draft. */
export function createProjectionHydrationReplayNext<T extends object = {}>(
  fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  replaying: () => boolean,
  options?: ProjectionOptions
): Refreshable<Store<T>> {
  return createProjectionNextInternal(fn, {} as T, options, createReplayStoreValidator(replaying))
    .store;
}

/** Derived writable store (legacy parity): a projection whose public setter
 * masks the recompute for the tick (core R31 — the manual write wins over a
 * same-flush dependency change). */
export function createStoreDerivedNext<T extends object = {}>(
  fn:
    | ((draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>)
    | (() => T | Promise<T> | AsyncIterable<T>),
  seed: T | null | undefined,
  options?: SeededProjectionOptions
): [Refreshable<Store<T>>, (f: (draft: T) => T | void) => void] {
  const seeded = seed != null;
  if (!seeded && options?.seedLoadingValue)
    throw new Error("seedLoadingValue requires an explicit store seed");
  const derive = seeded ? fn : () => (fn as () => T | Promise<T> | AsyncIterable<T>)();
  return createStoreDerivedNextInternal(
    derive,
    (seed ?? {}) as T,
    options,
    seeded ? undefined : validateStoreValue
  );
}

function createStoreDerivedNextInternal<T extends object = {}>(
  fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  initialValue: T,
  options?: SeededProjectionOptions,
  validateResult?: ProjectionResultValidator<T>
): [Refreshable<Store<T>>, (f: (draft: T) => T | void) => void] {
  const { store, node } = createProjectionNextInternal(fn, initialValue, options, validateResult);
  return [
    store,
    (f: (draft: T) => T | void): void => {
      // Mark the projection as manually written before notifying nodes.
      suppressComputedRecompute(node as Computed<unknown>);
      storeSetterNext(store, f);
    }
  ];
}

/** @internal Hydration replay starts with a complete snapshot, then mutates a private draft. */
export function createStoreHydrationReplayNext<T extends object = {}>(
  fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  replaying: () => boolean,
  options?: ProjectionOptions
): [Refreshable<Store<T>>, (f: (draft: T) => T | void) => void] {
  return createStoreDerivedNextInternal(
    fn,
    {} as T,
    options,
    createReplayStoreValidator(replaying)
  );
}

export function runProjectionComputedNext<T extends object>(
  wrappedStore: Store<T>,
  fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  key: string | ((item: NonNullable<any>) => any) | null,
  wrapCommit?: (write: () => void, value: T) => void,
  aroundDraftWrite?: (op: () => void) => void,
  validateResult?: ProjectionResultValidator<T>
): Computed<void | T> {
  const owner = getOwner() as Computed<void | T>;
  let settled = false;
  let result: void | T | Promise<void | T> | AsyncIterable<void | T>;
  // Open loading window (seedLoadingValue): the observable store IS commit #0
  // for the whole first flight — the derive works a detached shadow of the
  // seed so draft writes cannot tear through to readers (#2988). Every commit
  // point reconciles the shadow through the normal commit path.
  const shadow = owner._loading
    ? (JSON.parse(JSON.stringify((wrappedStore as any)[$TARGET][STORE_VALUE])) as T)
    : null;
  const draft = wrapDraft(
    wrappedStore,
    () => !settled || owner._x?._inFlight === result,
    aroundDraftWrite
  );
  storeSetterNext(
    draft,
    s => {
      result = fn((shadow ?? s) as T);
      settled = true;
      const commit = (v: void | T) => {
        validateResult?.(v, owner);
        // Shadow run: commit a detached snapshot, never the shadow itself
        // (adoption takes the value by identity — handing it the live shadow
        // would fuse the draft to the observable store).
        if (shadow && (v === undefined || v === (shadow as any)))
          v = JSON.parse(JSON.stringify(shadow)) as T;
        if (v === (s as any) || v === undefined) return;
        const write = () =>
          storeSetterNext(wrappedStore, st => reconcileNextState(v, st, key, true), false);
        wrapCommit ? wrapCommit(write, v as T) : write();
      };
      const sync = handleAsync(owner, result, commit);
      if (!owner._loading) commit(sync as void | T);
    },
    false
  );
  return owner;
}
