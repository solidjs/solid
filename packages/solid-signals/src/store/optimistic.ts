import {
  $REFRESH,
  getOwner,
  handleAsync,
  setSignal,
  type Computed
} from "../core/index.js";
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
  // const derived = typeof first === "function";
  // let temp: T;
  // const { store, node } = derived
  //   ? createProjectionInternal(
  //       draft => {
  //         const n = getOwner() as Computed<T>;
  //         const value = (first as any)(draft);
  //         if (n._statusFlags & STATUS_UNINITIALIZED) return value;
  //         temp = value as T;
  //         return;
  //       },
  //       second,
  //       options
  //     )
  //   : createProjectionInternal(() => {}, first);
  // (node as any)._reset = () =>
  //   derived
  //     ? handleAsync(node as Computed<T>, temp, value => {
  //         value !== store &&
  //           value !== undefined &&
  //           storeSetter(store, reconcile(value as any, options?.key || "id", options?.all));
  //         setSignal(node as any, undefined);
  //       })
  //     : storeSetter(store, reconcile<T, T>(first as T, options?.key || "id", options?.all));
  // node._optimistic = true;
  // return [store, v => storeSetter(store, v)];
}
