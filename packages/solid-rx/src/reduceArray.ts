import { untrack } from "solid-js";

export function reduceArray<T, U>(
  fn: (memo: U, value: T, i: number) => U,
  seed: U
): (list: () => T[]) => () => U;
export function reduceArray<T, U>(
  list: () => T[],
  fn: (memo: U, value: T, i: number) => U,
  seed: U
): () => U;
export function reduceArray<T, U>(list: any, fn: any, seed?: any): any {
  if (arguments.length < 3) {
    seed = fn;
    fn = list;
    return reducer;
  }
  return reducer(list);

  function reducer(list: () => T[]) {
    return () => {
      let newList = list() || [],
        result = seed;
      return untrack(() => {
        for (let i = 0; i < newList.length; i++) {
          result = fn(result, newList[i], i);
        }
        return result;
      });
    };
  }
}