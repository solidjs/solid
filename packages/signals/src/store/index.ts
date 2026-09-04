export type {
  Store,
  StoreReturn,
  ProjectionStoreReturn,
  StoreSetter,
  StoreNode,
  StoreOptions,
  ProjectionOptions,
  SeededProjectionOptions,
  NotWrappable,
  SolidStore
} from "./store.js";
export type { Merge, Omit } from "./utils.js";

export { isWrappable, $TRACK, $PROXY, $TARGET } from "./store.js";

import type {
  NoFn,
  NoArray,
  ProjectionOptions,
  SeededProjectionOptions,
  Store,
  StoreOptions,
  StoreSetter
} from "./store.js";
import type { Refreshable } from "../core/index.js";
import {
  createStoreNext,
  deepNext,
  snapshotNext,
  type SetStoreNextFunction
} from "./next/store.js";
import { reconcileNextState } from "./next/reconcile.js";
import { createStoreDerivedNext } from "./next/projection.js";

export {
  createProjectionNext as createProjection,
  createProjectionHydrationReplayNext as createProjectionHydrationReplay,
  createStoreHydrationReplayNext as createStoreHydrationReplay
} from "./next/projection.js";
export { storeIsShallow, storeHasFamily, storeHasOptimisticFamily } from "./next/store.js";
export {
  createOptimisticStoreNext as createOptimisticStore,
  createOptimisticStoreHydrationReplayNext as createOptimisticStoreHydrationReplay
} from "./next/optimistic.js";

/** Public createStore: plain form `(initialValue, options?)` and derived writable
 * forms `(fn)` / `(fn, seed, options?)`. */
export function createStore<T extends object = {}>(
  initialValue: T & NoFn<T>,
  options?: StoreOptions
): [get: Store<T>, set: StoreSetter<T>];
export function createStore<T extends object = {}>(
  fn: (() => T | Promise<T> | AsyncIterable<T>) & NoArray<T> & NoFn<T>,
  seed?: null,
  options?: ProjectionOptions
): [get: Refreshable<Store<T>>, set: StoreSetter<T>];
export function createStore<T extends object = {}>(
  fn: ((draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>) & NoFn<T>,
  seed: T,
  options?: SeededProjectionOptions
): [get: Refreshable<Store<T>>, set: StoreSetter<T>];
export function createStore(first: any, second?: any, third?: any): any {
  if (typeof first === "function") return createStoreDerivedNext(first, second, third);
  return createStoreNext(first, !!second?.shallow);
}

export function reconcile<T extends U, U>(
  value: T,
  key: string | ((item: NonNullable<any>) => any) | null = "id"
) {
  return (state: U): T => reconcileNextState(value, state, key) as any;
}

export function snapshot<T>(value: T): T {
  return snapshotNext(value);
}

export function deep<T>(value: T): T {
  return deepNext(value);
}

export { storePath } from "./storePath.js";
export type {
  PathSetter,
  Part,
  StorePathRange,
  ArrayFilterFn,
  CustomPartial
} from "./storePath.js";

export { merge, omit } from "./utils.js";
