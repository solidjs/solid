import { createMemo, sample } from "solid-js";

export function filter<T>(fn: (v: T) => boolean): (v: () => T) => () => T
export function filter<T>(input: () => T, fn: (v: T) => boolean): () => T;
export function filter<T>(input: any, fn?: (v: T) => boolean): any {
  if (arguments.length === 1) {
    fn = input;
    return filter;
  }
  return filter(input);

  function filter(input: () => T) {
    let value: T;
    const trigger = createMemo(
      () => {
        value = input();
        return sample(() => fn!(value));
      },
      undefined,
      (_, next) => next === false
    );
    return () => trigger() && value
  }
}
