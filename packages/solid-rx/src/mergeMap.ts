import { untrack, createMemo } from "solid-js";

export function mergeMap<T, U>(fn: (v: T) => () => U): (v: () => T) => () => U;
export function mergeMap<T, U>(input: () => T, fn: (v: T) => () => U): () => U;
export function mergeMap<T, U>(input: any, fn?: (v: T) => () => U): any {
  if (arguments.length === 1) {
    fn = input;
    return mergeMap;
  }
  return mergeMap(input);

  function mergeMap(input: () => T) {
    const mapped = createMemo(() => {
      const value = input();
      return untrack(() => fn!(value));
    });
    return () => {
      const m = mapped();
      return m ? m() : undefined;
    };
  }
}
