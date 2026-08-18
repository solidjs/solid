/**
 * Transitional dispatchers while the rewrite lands increment by increment:
 * next proxies route to the rewrite, everything else (derived, shallow,
 * optimistic — not yet ported) falls through to the legacy implementation.
 * Deleted when the swap completes.
 */
import { reconcile as legacyReconcile } from "../reconcile.js";
import { $TARGET, createStore as legacyCreateStore } from "../store.js";
import { deep as legacyDeep, snapshot as legacySnapshot } from "../utils.js";
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

export function createStore(first: any, second?: any, third?: any): any {
  if (
    second === undefined &&
    third === undefined &&
    typeof first !== "function" &&
    first !== null &&
    typeof first === "object"
  ) {
    return createStoreNext(first);
  }
  return (legacyCreateStore as any)(first, second, third);
}
