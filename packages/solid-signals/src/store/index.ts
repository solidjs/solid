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
// Store rewrite (INTERNALS-STORE-STATE.md): plain stores + reconcile serve
// from src/store/next/ — the phase-1 hot path. Derived/shallow/optimistic
// forms still route to the legacy implementation until their increments land.
export { createStore } from "./next/dispatch.js";

export { createProjection } from "./next/dispatch.js";

export { createOptimisticStore } from "./optimistic.js";

export { reconcile } from "./next/dispatch.js";
export { snapshot, deep } from "./next/dispatch.js";

export { storePath } from "./storePath.js";
export type {
  PathSetter,
  Part,
  StorePathRange,
  ArrayFilterFn,
  CustomPartial
} from "./storePath.js";

export { merge, omit } from "./utils.js";
