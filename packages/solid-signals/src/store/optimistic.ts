import { $REFRESH, getOwner, handleAsync, setSignal, type Computed } from "../core/index.js";
import { createProjectionInternal } from "./projection.js";
import { reconcile } from "./reconcile.js";
import {
  createStore,
  storeSetter,
  type NoFn,
  type Store,
  type StoreOptions,
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
export function createOptimisticStore<T extends object = {}>(
  store: NoFn<T> | Store<NoFn<T>>
): [get: Store<T>, set: StoreSetter<T>];
export function createOptimisticStore<T extends object = {}>(
  fn: (store: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  store?: NoFn<T> | Store<NoFn<T>>,
  options?: StoreOptions
): [get: Store<T> & { [$REFRESH]: any }, set: StoreSetter<T>];
export function createOptimisticStore<T extends object = {}>(
  first: T | ((store: T) => void | T | Promise<void | T> | AsyncIterable<void | T>),
  second?: NoFn<T> | Store<NoFn<T>>,
  options?: StoreOptions
): [get: Store<T>, set: StoreSetter<T>] {
  // TODO OPTIMISTIC STORE IMPLEMENTATION
  return createStore(first as any, second, options);
}
