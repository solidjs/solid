import { createDeferred } from "solid-js";

export function defer<T>(options?: {
  timeoutMs: number;
}): (fn: () => T) => () => T;
export function defer<T>(fn: () => T, options: { timeoutMs: number }): () => T;
export function defer<T>(fn: any, options?: any): any {
  if (typeof fn === "function") {
    return createDeferred(fn, options);
  }
  options = fn;
  return (signal: () => T) => createDeferred(signal, options);
}