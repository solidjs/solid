import { ActiveTransition, cloneGraph } from "../core/scheduler.js";
import { createProjectionInternal } from "./projection.js";
import { reconcile } from "./reconcile.js";
import {
  storeSetter,
  type Store,
  type StoreSetter
} from "./store.js";

/**
 * Creates an optimistic store that can be used to optimistically update a value
 * and then revert it back to the previous value at end of transition.
 * ```typescript
 * export function createOptimistic<T>(
 *   fn: (store: T) => void,
 *   initial: T,
 *   options?: { key?: string | ((item: NonNullable<any>) => any); all?: boolean }
 * ): [get: Store<T>, set: StoreSetter<T>];
 * ```
 * @param fn a function that receives the current store and can be used to mutate it directly inside a transition
 * @param initial The initial value of the signal.
 * @param options Optional signal options.
 *
 * @returns A tuple containing an accessor for the current value and a setter function to apply changes.
 */
export function createOptimistic<T extends object = {}>(
  initial: T | Store<T>
): [get: Store<T>, set: StoreSetter<T>];
export function createOptimistic<T extends object = {}>(
  fn: (store: T) => T | void,
  initial: T | Store<T>,
  options?: { key?: string | ((item: NonNullable<any>) => any); all?: boolean }
): [get: Store<T>, set: StoreSetter<T>];
export function createOptimistic<T extends object = {}>(
  first: T | ((store: T) => T | void),
  second?: T | Store<T>,
  options?: { key?: string | ((item: NonNullable<any>) => any); all?: boolean }
): [get: Store<T>, set: StoreSetter<T>] {
  const derived = typeof first === "function";
  const { store, node } = derived ? createProjectionInternal(first, second, options) : createProjectionInternal(() => {}, first);
  const reset = () =>
    storeSetter(
      store,
      reconcile(
        derived ? first(store) || store : (first as T),
        options?.key || "id",
        options?.all
      )
    );
  const write = (v: (v?: T) => T) => {
    if (!ActiveTransition)
      throw new Error("createOptimistic can only be updated inside a transition");
    ActiveTransition.addOptimistic(reset);
    cloneGraph(node, true);
    queueMicrotask(() => (reset as any)._transition && storeSetter(store, v));
  };
  return [store, write] as any;
}
