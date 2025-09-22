import { Accessor, NotReadyError, Signal, Store, StoreSetter } from "@solidjs/signals";

/**
 * Runs the given function and returns a tuple with the result or an error.
 * If the function throws an error, it will be caught and returned as the first element of the tuple.
 * If the function returns a promise, it will resolve to a tuple with the result or an error.
 *
 * @param fn The function to run.
 * @returns A tuple with either [undefined, result] or [error].
 *
 * @description https://docs.solidjs.com/reference/reactive-utilities/try-catch
 */
export type TryCatchResult<T, E> = [undefined, T] | [E];
export function tryCatch<T, E = Error>(fn: () => Promise<T>): Promise<TryCatchResult<T, E>>;
export function tryCatch<T, E = Error>(fn: () => T): TryCatchResult<T, E>;
export function tryCatch<T, E = Error>(
  fn: () => T | Promise<T>
): TryCatchResult<T, E> | Promise<TryCatchResult<T, E>> {
  try {
    const v = fn();
    if (v instanceof Promise) {
      return v.then(
        v => [undefined, v],
        e => {
          if (e instanceof NotReadyError) throw e;
          return [e as E];
        }
      );
    }
    return [undefined, v];
  } catch (e) {
    if (e instanceof NotReadyError) throw e;
    return [e as E];
  }
}

/**
 * Simple reducer utility for Signals and Stores
 * ```typescript
 * const [state, dispatch] = reducer(createSignal({ count: 0 }), (state, action) => {
 *   switch (action.type) {
 *     case "increment":
 *       return { count: state.count + 1 };
 *     case "decrement":
 *       return { count: state.count - 1 };
 *     default:
 *       return state;
 *   }
 * });
 * ```
 * @param source Signal or Store tuple
 * @param reducerFn reducer function that receives the current value and an action, and returns the new value for signals or void for stores
 * @returns a tuple with the current value accessor and a dispatch function to send actions to the reducer
 *
 * @description https://docs.solidjs.com/reference/reactive-utilities/reducer
 */
export function reducer<T, A>(
  source: Signal<T>,
  reducerFn: (value: T, action: A) => T
): [Accessor<T>, (action: A) => void];
export function reducer<T, A>(
  source: [Store<T>, StoreSetter<T>],
  reducerFn: (value: T, action: A) => T | void
): [Store<T>, (action: A) => void];
export function reducer<T, A>(
  source: Signal<T> | [Store<T>, StoreSetter<T>],
  reducerFn: (value: T, action: A) => T | void
): [Accessor<T> | Store<T>, (action: A) => void] {
  return [
    source[0],
    (action: A) => {
      source[1]((s: T) => reducerFn(s, action) as any);
    }
  ] as [Accessor<T> | Store<T>, (action: A) => void];
}
