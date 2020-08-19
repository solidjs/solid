import { untrack } from "solid-js";

export function map<T, U>(fn: (v: T) => U): (v: () => T) => () => U;
export function map<T, U>(input: () => T, fn: (v: T) => U): () => U;
export function map<T, U>(input: any, fn?: (v: T) => U): any {
  if (arguments.length === 1) {
    fn = input;
    return map;
  }
  return map(input);

  function map(input: () => T) {
    return () => {
      const value = input();
      return untrack(() => fn!(value));
    };
  }
}
