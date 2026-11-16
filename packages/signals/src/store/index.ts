/**
 * Store — public surface. Plain stores (S1) are live; the derived form
 * (`createStore(fn, seed)`), projections, optimistic stores and reconcile
 * return on later steps (plan sec. 31.5).
 */
export type {
  NoArray,
  NoFn,
  NotWrappable,
  ProjectionOptions,
  ProjectionStoreReturn,
  SolidStore,
  Store,
  StoreOptions,
  StoreReturn,
  StoreSetter
} from "./types.js";
export { $PROXY, $RECORD, $TARGET, $TRACK, isWrappable, markRaw } from "./types.js";
export { storePath } from "./storePath.js";
export type {
  StorePathRange,
  PathSetter,
  Part,
  CustomPartial,
  ArrayFilterFn
} from "./storePath.js";

import { $THIN } from "./types.js";
import { isThin, createThinStore, thinDeep, thinReconcile, thinSnapshot } from "./thin.js";
import { createThinProjection, createThinStoreDerived } from "./thinProjection.js";
import { createThinOptimisticStore } from "./thinOptimistic.js";
import type { Refreshable } from "../core/index.js";
import type {
  NoArray,
  NoFn,
  ProjectionOptions,
  ProjectionStoreReturn,
  Store,
  StoreOptions,
  StoreReturn,
  StoreSetter
} from "./types.js";

/** True when `proxy` is a SHALLOW store (children served verbatim, slots
 * replaced by reference — #2932). */
export function storeIsShallow(proxy: any): boolean {
  return isThin(proxy) && proxy[$THIN].s === true;
}
/** True when `proxy` belongs to a projection family (S3). */
export function storeHasFamily(proxy: any): boolean {
  return isThin(proxy) && proxy[$THIN]._fam != null;
}
/** True when `proxy` belongs to an OPTIMISTIC family (S4). */
export function storeHasOptimisticFamily(proxy: any): boolean {
  return isThin(proxy) && !!proxy[$THIN]._fam?.opt;
}

/**
 * An optimistic store: a store whose setter writes are guesses over the
 * truth (its seed, or its derive's answers) until the action that wrote
 * them settles (F-11).
 */
export function createOptimisticStore<T extends object = {}>(
  initialValue: NoFn<T> | Store<NoFn<T>>,
  options?: StoreOptions
): [get: Store<T>, set: StoreSetter<T>];
export function createOptimisticStore<T extends object = {}>(
  fn: (() => T | Promise<T> | AsyncIterable<T>) & NoArray<T>,
  seed?: null,
  options?: Omit<ProjectionOptions, "seedLoadingValue">
): [get: Refreshable<Store<T>>, set: StoreSetter<T>];
export function createOptimisticStore<T extends object = {}>(
  fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  seed: NoFn<T> | Store<NoFn<T>>,
  options?: ProjectionOptions
): [get: Refreshable<Store<T>>, set: StoreSetter<T>];
export function createOptimisticStore(a: any, b?: any, c?: any): any {
  return createThinOptimisticStore(a, b, c);
}

/**
 * A derived store: `fn` runs in a computed and writes its draft; readers of
 * the store's keys re-run only when the keys they read change (the
 * firewall). `fn` may be async or an async iterator; the seed is a draft,
 * never an observable value, until the first landing (A25).
 */
export function createProjection<T extends object = {}>(
  fn: (() => T | Promise<T> | AsyncIterable<T>) & NoArray<T>,
  seed?: null,
  options?: Omit<ProjectionOptions, "seedLoadingValue">
): Refreshable<Store<T>>;
export function createProjection<T extends object = {}>(
  fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  seed: NoFn<T> | Store<NoFn<T>>,
  options?: ProjectionOptions
): Refreshable<Store<T>>;
export function createProjection(fn: any, seed?: any, options?: any): any {
  return createThinProjection(fn, seed, options);
}
/** The store's internal record behind a proxy (`store[$TARGET]`). Kept
 * under `next`'s public name; its shape is the L2 target's (plan plan sec. 31–32:
 * the symbol-keyed legacy record is gone with the representation). */
export type { StoreTarget as StoreNode } from "./target.js";
export type { Merge, Omit } from "./utils.js";
export {
  mergeSources,
  mergeView,
  viewOf,
  omitView,
  sourceKeys,
  sourceHas,
  sourceGet,
  hasStaticKeys,
  isStatic,
  resolvedTable,
  OmitView,
  MergeView,
  SOURCE_PLAIN,
  SOURCE_OMIT,
  SOURCE_PROXY,
  SOURCE_MEMO,
  SOURCE_MERGE,
  sourceOwners,
  merge,
  omit
} from "./utils.js";
export type { SourceKind } from "./utils.js";

/**
 * Create a reactive store: a proxy over plain data with fine-grained
 * subscriptions per read path, written through its setter's draft — or, in
 * the derived form, a projection with a setter.
 *
 * The derived form comes in two shapes. Seedless, `createStore(fn)`: `fn`
 * takes no draft and every answer is a complete `T` (plain-object roots only;
 * pass `undefined` for the seed to reach the options). Seeded,
 * `createStore(fn, seed)`: the seed is a complete `T` the derive drafts
 * against — `[]` for an array.
 */
export function createStore<T extends object = {}>(
  initialValue: NoFn<T>,
  options?: StoreOptions
): StoreReturn<T>;
export function createStore<T extends object = {}>(
  fn: (() => T | Promise<T> | AsyncIterable<T>) & NoArray<T>,
  seed?: null,
  options?: Omit<ProjectionOptions, "seedLoadingValue">
): ProjectionStoreReturn<T>;
export function createStore<T extends object = {}>(
  fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  seed: NoFn<T> | Store<NoFn<T>>,
  options?: ProjectionOptions
): ProjectionStoreReturn<T>;
export function createStore(first: any, second?: any, third?: any): any {
  if (typeof first === "function") {
    return createThinStoreDerived(first, second, third) as any;
  }
  return createThinStore(first, second?.shallow, second) as any;
}

/**
 * A setter transform that reconciles `value` into the store by key
 * (`"id"` by default; `null` positional), preserving store identity for
 * surviving rows.
 */
export function reconcile<T extends U, U>(
  value: T,
  key: string | ((item: NonNullable<any>) => any) | null = "id"
): (state: U) => T {
  return (state: U): T => {
    if (isThin(state)) {
      const k: any = key;
      thinReconcile(
        state,
        value,
        k === null ? null : typeof k === "string" ? Object.assign((i: any) => i?.[k], { k }) : k,
        2
      );
      return undefined as any;
    }
    return value;
  };
}

/** Non-tracking snapshot of a store's current value (source identity for
 * unmodified subtrees). */
export function snapshot<T>(value: T): T {
  return isThin(value) ? thinSnapshot(value) : value;
}

/** Tracking snapshot: subscribes to every reachable record. */
export function deep<T>(value: T): T {
  return isThin(value) ? thinDeep(value) : value;
}
