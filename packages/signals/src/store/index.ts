export type {
  Store,
  StoreReturn,
  ProjectionStoreReturn,
  StoreSetter,
  StoreNode,
  StoreOptions,
  ProjectionOptions,
  NotWrappable,
  SolidStore
} from "./store.js";
export type { Merge, Omit } from "./utils.js";

export { isWrappable, $TRACK, $PROXY, $TARGET } from "./store.js";

import type { NoFn, ProjectionOptions, Store, StoreOptions, StoreSetter } from "./store.js";
import type { Refreshable } from "../core/index.js";
import {
  createStoreNext,
  deepNext,
  snapshotNext,
  type SetStoreNextFunction
} from "./next/store.js";
import { reconcileNextState } from "./next/reconcile.js";
import { createStoreDerivedNext } from "./next/projection.js";

export { createProjectionNext as createProjection } from "./next/projection.js";
// Compiler-contract surface (see src/compiler.ts — the sanctioned import is
// the `@solidjs/signals/compiler` subpath; root presence is a single-file
// dev-build artifact and is undocumented).
// Compiler-contract surface (DESIGN-PATCH-CHANNEL.md): what patch-mode
// compiled output links against. Undocumented as an application API.
export {
  registerPatch,
  registerRowOps,
  registerSlotPatchNext as registerSlotPatch,
  patchableRaw,
  patchCommittedRaw,
  patchProxyFor,
  patchVersion
} from "./next/patch.js";
export { storeIsShallow, storeHasFamily, storeHasOptimisticFamily } from "./next/store.js";
export { createOptimisticStoreNext as createOptimisticStore } from "./next/optimistic.js";

/** Public createStore: plain form `(init, options?)` and derived writable
 * form `(fn, seed, options?)`. */
export function createStore<T extends object = {}>(
  store: NoFn<T> | Store<NoFn<T>>,
  options?: StoreOptions & { shallow?: boolean }
): [get: Store<T>, set: StoreSetter<T>];
export function createStore<T extends object = {}>(
  fn: (store: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  store: Partial<T> | Store<NoFn<T>>,
  options?: ProjectionOptions
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
