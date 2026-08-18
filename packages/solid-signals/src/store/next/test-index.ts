/**
 * Alias shim (comparison method §5c / implementation method 2026-08-16e):
 * `vite.next.config.ts` aliases `src/store/index.ts` to this file, running
 * the UNMODIFIED legacy suites against the rewrite as capabilities land.
 * Everything not yet ported re-exports from the legacy modules directly
 * (concrete files, not the barrel — the barrel is what's aliased).
 */
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
} from "../store.js";
export type { Merge, Omit } from "../utils.js";

export { isWrappable, $TRACK, $PROXY, $TARGET } from "../store.js";

export { createProjection } from "../projection.js";
export { createOptimisticStore } from "../optimistic.js";
export { reconcile } from "../reconcile.js";

export { storePath } from "../storePath.js";
export type {
  PathSetter,
  Part,
  StorePathRange,
  ArrayFilterFn,
  CustomPartial
} from "../storePath.js";

export { snapshot, deep, merge, omit } from "../utils.js";

// --- rewrite overrides (grow as increments land) ---
export { createStoreNext as createStore } from "./store.js";
