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

import {
  createStore as createPlainStore,
  deep as deepStore,
  snapshot as snapshotStore
} from "./store.js";
import type { NoFn, Store, StoreOptions, StoreReturn, StoreSetter } from "./types.js";

/**
 * Create a reactive store: a proxy over plain data with fine-grained
 * subscriptions per read path, written through its setter's draft.
 */
export function createStore<T extends object = {}>(
  initialValue: NoFn<T>,
  options?: StoreOptions
): StoreReturn<T>;
export function createStore(first: any, second?: any, third?: any): any {
  if (typeof first === "function")
    throw new Error("[CARVED] createStore(fn, seed) was removed on the measurement branch");
  return createPlainStore(first, second) as [Store<any>, StoreSetter<any>];
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
