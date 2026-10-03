/**
 * Store — public surface. Plain stores (S1) are live; the derived form
 * (`createStore(fn, seed)`), projections, optimistic stores and reconcile
 * return on later steps (plan §31.5).
 */
export type {
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
export { storeIsShallow, storeHasFamily, storeHasOptimisticFamily } from "./store.js";
export { storePath } from "./storePath.js";
export type {
  StorePathRange,
  PathSetter,
  Part,
  CustomPartial,
  ArrayFilterFn
} from "./storePath.js";

import "./affects.js";
import { createOptimisticStore } from "./optimistic.js";
import { createProjection, createStoreDerived } from "./projection.js";
import { reconcileState } from "./reconcile.js";
import {
  createStore as createPlainStore,
  deep as deepStore,
  snapshot as snapshotStore
} from "./store.js";
import type {
  NoFn,
  ProjectionOptions,
  ProjectionStoreReturn,
  Store,
  StoreOptions,
  StoreReturn,
  StoreSetter
} from "./types.js";

export { createOptimisticStore, createProjection };
/** The store's internal record behind a proxy (`store[$TARGET]`). Kept
 * under `next`'s public name; its shape is the L2 target's (plan §31–§32:
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
 */
export function createStore<T extends object = {}>(
  initialValue: NoFn<T>,
  options?: StoreOptions
): StoreReturn<T>;
export function createStore<T extends object = {}>(
  fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  seed: Partial<T> | Store<NoFn<T>>,
  options?: ProjectionOptions
): ProjectionStoreReturn<T>;
export function createStore(first: any, second?: any, third?: any): any {
  if (typeof first === "function") return createStoreDerived(first, second, third);
  return createPlainStore(first, second) as [Store<any>, StoreSetter<any>];
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
  return (state: U): T => reconcileState(value, state, key) as any;
}

/** Non-tracking snapshot of a store's current value (source identity for
 * unmodified subtrees). */
export function snapshot<T>(value: T): T {
  return snapshotStore(value);
}

/** Tracking snapshot: subscribes to every reachable record. */
export function deep<T>(value: T): T {
  return deepStore(value);
}
