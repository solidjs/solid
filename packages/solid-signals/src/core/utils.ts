import { NotReadyError } from "./error.js";

export function isUndefined(value: any): value is undefined {
  return typeof value === "undefined";
}

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
