import { onCleanup, createRoot, sample } from './signal';

const FALLBACK = Symbol('fallback');

type Operator<T, U> = (seq: () => T) => () => U

export function pipe<T>(): Operator<T, T>;
export function pipe<T, A>(fn1: Operator<T, A>): Operator<T, A>;
export function pipe<T, A, B>(fn1: Operator<T, A>, fn2: Operator<A, B>): Operator<T, B>;
export function pipe<T, A, B, C>(fn1: Operator<T, A>, fn2: Operator<A, B>, fn3: Operator<B, C>): Operator<T, C>;
export function pipe<T, A, B, C, D>(fn1: Operator<T, A>, fn2: Operator<A, B>, fn3: Operator<B, C>, fn4: Operator<C, D>): Operator<T, D>;
export function pipe<T, A, B, C, D, E>(fn1: Operator<T, A>, fn2: Operator<A, B>, fn3: Operator<B, C>, fn4: Operator<C, D>, fn5: Operator<D, E>): Operator<T, E>;
export function pipe<T, A, B, C, D, E, F>(fn1: Operator<T, A>, fn2: Operator<A, B>, fn3: Operator<B, C>, fn4: Operator<C, D>, fn5: Operator<D, E>, fn6: Operator<E, F>): Operator<T, F>;
export function pipe<T, A, B, C, D, E, F, G>(fn1: Operator<T, A>, fn2: Operator<A, B>, fn3: Operator<B, C>, fn4: Operator<C, D>, fn5: Operator<D, E>, fn6: Operator<E, F>, fn7: Operator<F, G>): Operator<T, G>;
export function pipe<T, A, B, C, D, E, F, G, H>(fn1: Operator<T, A>, fn2: Operator<A, B>, fn3: Operator<B, C>, fn4: Operator<C, D>, fn5: Operator<D, E>, fn6: Operator<E, F>, fn7: Operator<F, G>, fn8: Operator<G, H>): Operator<T, H>;
export function pipe<T, A, B, C, D, E, F, G, H, I>(fn1: Operator<T, A>, fn2: Operator<A, B>, fn3: Operator<B, C>, fn4: Operator<C, D>, fn5: Operator<D, E>, fn6: Operator<E, F>, fn7: Operator<F, G>, fn8: Operator<G, H>, fn9: Operator<H, I>): Operator<T, I>;
export function pipe<T, A, B, C, D, E, F, G, H, I>(fn1: Operator<T, A>, fn2: Operator<A, B>, fn3: Operator<B, C>, fn4: Operator<C, D>, fn5: Operator<D, E>, fn6: Operator<E, F>, fn7: Operator<F, G>, fn8: Operator<G, H>, fn9: Operator<H, I>, ...fns: Operator<any, any>[]): Operator<T, {}>;
export function pipe(...fns: Array<Operator<any, any>>): Operator<any, any> {
  if (!fns) return i => i;
  if (fns.length === 1) return fns[0];
  return input => fns.reduce(((prev, fn) => fn(prev)), input);
}

// Modified version of mapSample from S-array[https://github.com/adamhaile/S-array] by Adam Haile
export function map<T, U>(
  mapFn: (v: T, i: number) => U,
  fallback?: () => U
) {
  return (list: () => T[]) => {
    let items = [] as T[],
      mapped = [] as U[],
      disposers = [] as (() => void)[],
      len = 0;
    onCleanup(() => {
      for (let i = 0, length = disposers.length; i < length; i++) disposers[i]();
    })
    return () => {
      let newItems = list() || [],
        i: number,
        j: number;
      return sample(() => {
        let newLen = newItems.length,
          newIndices: Map<T, number>,
          newIndicesNext: number[],
          temp: U[],
          tempdisposers: (() => void)[],
          start: number,
          end: number,
          newEnd: number,
          item: T;

        // fast path for empty arrays
        if (newLen === 0) {
          if (len !== 0) {
            for (i = 0; i < len; i++) disposers[i]();
            disposers = [];
            items = [];
            mapped = [];
            len = 0;
          }
          if (fallback) {
            items = [FALLBACK as unknown as any];
            mapped[0] = createRoot(disposer => {
              disposers[0] = disposer;
              return fallback();
            });
            len = 1;
          }
        }
        // fast path for new create
        else if (len === 0) {
          for (j = 0; j < newLen; j++) {
            items[j] = newItems[j];
            mapped[j] = createRoot(mapper);
          }
          len = newLen;
        }
        else {
          // skip common prefix
          for (start = 0, end = Math.min(len, newLen); start < end && items[start] === newItems[start]; start++)
            ;
          // fast path for addition
          if (start >= len && len <= newLen) {
            for (j = start; j < newLen; j++) {
              items[j] = newItems[j];
              mapped[j] = createRoot(mapper);
            }
            len = newLen;
            return mapped
          }

          newIndices = new Map<T, number>();
          temp = new Array(newLen);
          tempdisposers = new Array(newLen);

          // common suffix
          for (end = len - 1, newEnd = newLen - 1; end >= 0 && newEnd >= 0 && items[end] === newItems[newEnd]; end-- , newEnd--) {
            temp[newEnd] = mapped[end];
            tempdisposers[newEnd] = disposers[end];
          }
          // 0) prepare a map of all indices in newItems, scanning backwards so we encounter them in natural order
          newIndicesNext = new Array(newEnd + 1);
          for (j = newEnd; j >= start; j--) {
            item = newItems[j];
            i = newIndices.get(item)!;
            newIndicesNext[j] = i === undefined ? -1 : i;
            newIndices.set(item, j);
          }
          // 1) step through all old items and see if they can be found in the new set; if so, save them in a temp array and mark them moved; if not, exit them
          for (i = start; i <= end; i++) {
            item = items[i];
            j = newIndices.get(item)!;
            if (j !== undefined && j !== -1) {
              temp[j] = mapped[i];
              tempdisposers[j] = disposers[i];
              j = newIndicesNext[j];
              newIndices.set(item, j);
            }
            else disposers[i]();
          }
          // 2) set all the new values, pulling from the temp array if copied, otherwise entering the new value
          for (j = start; j < newLen; j++) {
            if (temp.hasOwnProperty(j)) {
              mapped[j] = temp[j];
              disposers[j] = tempdisposers[j];
            }
            else mapped[j] = createRoot(mapper);
          }
          // 3) in case the new set is shorter than the old, set the length of the mapped array
          len = mapped.length = newLen;
          // 4) save a copy of the mapped items for the next update
          items = newItems.slice(0);
        }
        return mapped;
      });
      function mapper(disposer: () => void) {
        disposers[j] = disposer;
        return mapFn(newItems[j], j);
      }
    };
  }
}

export function reduce<T, U>(fn: (memo: U | undefined, value: T, i: number) => U, seed?: U) {
  return (list: () => T[]) => () => {
    let newList = list() || [],
      result = seed;
    return sample(() => {
      for (let i = 0; i < newList.length; i++) {
        result = fn(result, newList[i], i);
      }
      return result;
    })
  };
}