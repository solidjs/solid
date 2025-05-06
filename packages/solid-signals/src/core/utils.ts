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

export function flatten(
  children: any,
  options?: { skipNonRendered?: boolean; doNotUnwrap?: boolean }
): any {
  if (typeof children === "function" && !children.length) {
    if (options?.doNotUnwrap) return children;
    do {
      children = children();
    } while (typeof children === "function" && !children.length);
  }
  if (
    options?.skipNonRendered &&
    (children == null || children === true || children === false || children === "")
  )
    return;

  if (Array.isArray(children)) {
    let results: any[] = [];
    if (flattenArray(children, results, options)) {
      return () => {
        let nested = [];
        flattenArray(results, nested, { ...options, doNotUnwrap: false });
        return nested;
      };
    }
    return results;
  }
  return children;
}

function flattenArray(
  children: Array<any>,
  results: any[] = [],
  options?: { skipNonRendered?: boolean; doNotUnwrap?: boolean }
): boolean {
  let notReady: NotReadyError | null = null;
  let needsUnwrap = false;
  for (let i = 0; i < children.length; i++) {
    try {
      let child = children[i];
      if (typeof child === "function" && !child.length) {
        if (options?.doNotUnwrap) {
          results.push(child);
          needsUnwrap = true;
          continue;
        }
        do {
          child = child();
        } while (typeof child === "function" && !child.length);
      }
      if (Array.isArray(child)) {
        needsUnwrap = flattenArray(child, results, options);
      } else if (
        options?.skipNonRendered &&
        (child == null || child === true || child === false || child === "")
      ) {
        // skip
      } else results.push(child);
    } catch (e) {
      if (!(e instanceof NotReadyError)) throw e;
      notReady = e;
    }
  }
  if (notReady) throw notReady;
  return needsUnwrap;
}

