import { createMemo, untrack } from "solid-js";

export function filter<T>(fn: (v: T) => boolean): (v: () => T) => () => T;
export function filter<T>(input: () => T, fn: (v: T) => boolean): () => T;
export function filter<T>(input: any, fn?: (v: T) => boolean): any {
  if (arguments.length === 1) {
    fn = input;
    return filter;
  }
  return filter(input);

  function filter(input: () => T) {
    let value: T;
    const trigger = createMemo<boolean>(
      () => {
        value = input();
        return untrack(() => fn!(value));
      },
      undefined,
      { equals: (_: boolean, next: boolean) => next === false }
    );
    return () => trigger() && value;
  }
}
