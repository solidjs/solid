import { sample } from "solid-js";

export function scan<T, U>(fn: (a: U, v: T) => U, seed: U): (v: () => T) => () => U;
export function scan<T, U>(input: () => T, fn: (a: U, v: T) => U, seed: U): () => U;
export function scan<T, U>(input: any, fn: any, seed?: U): any {
  if (arguments.length === 2) {
    seed = fn;
    fn = input;
    return scan;
  }
  return scan(input);

  function scan(input: () => T) {
    return () => {
      const value = input();
      return sample(() => (seed = fn(seed, value)));
    };
  }
}
