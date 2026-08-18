/**
 * Transitional dispatchers while the rewrite lands increment by increment:
 * next proxies route to the rewrite, everything else (derived, shallow,
 * optimistic — not yet ported) falls through to the legacy implementation.
 * Deleted when the swap completes.
 */
import { createOptimisticStore as legacyCreateOptimisticStore } from "../optimistic.js";
import { reconcile as legacyReconcile } from "../reconcile.js";
import { $TARGET, createStore as legacyCreateStore } from "../store.js";
import { deep as legacyDeep, snapshot as legacySnapshot } from "../utils.js";
import { createOptimisticStoreNext } from "./optimistic.js";
import { reconcileNextState } from "./reconcile.js";
import { createStoreNext, deepNext, isNextProxy, snapshotNext } from "./store.js";

export function reconcile<T extends U, U>(
  value: T,
  key: string | ((item: NonNullable<any>) => any) | null = "id"
) {
  return (state: U) => {
    if (isNextProxy(state)) return reconcileNextState(value, state, key) as any;
    return legacyReconcile(value, key)(state) as any;
  };
}

/**
 * Transitional createStore: bare plain-object/array stores (the phase-1 hot
 * path) serve from the rewrite; derived (fn), seeded, and option-carrying
 * forms (shallow, key, …) route to legacy until their increments land.
 */
export function snapshot<T>(value: T): T {
  const t = (value as any)?.[$TARGET];
  if (t !== undefined && !isNextProxy(value)) return legacySnapshot(value as any);
  return snapshotNext(value);
}

export function deep<T>(value: T): T {
  if (isNextProxy(value)) return deepNext(value);
  return legacyDeep(value as any);
}

export { createProjectionNext as createProjection } from "./projection.js";
import { createStoreDerivedNext } from "./projection.js";

export function createStore(first: any, second?: any, third?: any): any {
  const derived = typeof first === "function";
  if (derived) {
    // Derived writable store: projection internals + masking setter
    // (fam.shallow covers the shallow variant).
    return createStoreDerivedNext(first, second, third);
  }
  if (first !== null && typeof first === "object") {
    // Plain form; `second` carries only options (name/shallow) here.
    return createStoreNext(first, !!second?.shallow);
  }
  return (legacyCreateStore as any)(first, second, third);
}

/** All optimistic store forms serve from the rewrite (fam.shallow covers
 * the shallow variants). */
export function createOptimisticStore(first: any, second?: any, options?: any): any {
  return (createOptimisticStoreNext as any)(first, second, options);
}
