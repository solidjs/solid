import { sample } from "solid-js";

export function tap<T>(fn: (v: T) => void): (v: () => T) => () => T;
export function tap<T>(input: () => T, fn: (v: T) => void): () => T;
export function tap<T>(input: any, fn?: any): any {
  if (arguments.length === 1) {
    fn = input;
    return tap;
  }
  return tap(input);

  function tap(input: () => T) {
    return () => {
      const value = input();
      sample(() => fn(value));
      return value;
    }
  }
}