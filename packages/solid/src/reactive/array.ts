import {
  onCleanup,
  createRoot,
  untrack,
  createSignal,
  Accessor,
  Setter,
  $TRACK
} from "./signal.js";

const FALLBACK = Symbol("fallback");
function dispose(d: (() => void)[]) {
  for (let i = 0; i < d.length; i++) d[i]();
}

// Modified version of mapSample from S-array[https://github.com/adamhaile/S-array] by Adam Haile
/**
The MIT License (MIT)

Copyright (c) 2017 Adam Haile

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
/**
 * reactively transforms an array with a callback function - underlying helper for the `<For>` control flow
 *
 * similar to `Array.prototype.map`, but gets the index as accessor, transforms only values that changed and returns an accessor and reactively tracks changes to the list.
 *
 * @description https://www.solidjs.com/docs/latest/api#maparray
 */
export function mapArray<T, U>(
  list: Accessor<readonly T[] | undefined | null | false>,
  mapFn: (v: T, i: Accessor<number>) => U,
  options: { fallback?: Accessor<any> } = {}
): () => U[] {
  let items: (T | typeof FALLBACK)[] = [],
    mapped: U[] = [],
    disposers: (() => void)[] = [],
    len = 0,
    indexes: ((v: number) => number)[] | null = mapFn.length > 1 ? [] : null;

  onCleanup(() => dispose(disposers));
  return () => {
    let newItems = list() || [],
      i: number,
      j: number;
    (newItems as any)[$TRACK]; // top level tracking
    return untrack(() => {
      let newLen = newItems.length,
        newIndices: Map<T | typeof FALLBACK, number>,
        newIndicesNext: number[],
        temp: U[],
        tempdisposers: (() => void)[],
        tempIndexes: ((v: number) => number)[],
        start: number,
        end: number,
        newEnd: number,
        item: T | typeof FALLBACK;

      // fast path for empty arrays
      if (newLen === 0) {
        if (len !== 0) {
          dispose(disposers);
          disposers = [];
          items = [];
          mapped = [];
          len = 0;
          indexes && (indexes = []);
        }
        if (options.fallback) {
          items = [FALLBACK];
          mapped[0] = createRoot(disposer => {
            disposers[0] = disposer;
            return options.fallback!();
          });
          len = 1;
        }
      }
      // fast path for new create
      else if (len === 0) {
        mapped = new Array(newLen);
        for (j = 0; j < newLen; j++) {
          items[j] = newItems[j];
          mapped[j] = createRoot(mapper);
        }
        len = newLen;
      } else {
        temp = new Array(newLen);
        tempdisposers = new Array(newLen);
        indexes && (tempIndexes = new Array(newLen));

        // skip common prefix
        for (
          start = 0, end = Math.min(len, newLen);
          start < end && items[start] === newItems[start];
          start++
        );

        // common suffix
        for (
          end = len - 1, newEnd = newLen - 1;
          end >= start && newEnd >= start && items[end] === newItems[newEnd];
          end--, newEnd--
        ) {
          temp[newEnd] = mapped[end];
          tempdisposers[newEnd] = disposers[end];
          indexes && (tempIndexes![newEnd] = indexes[end]);
        }

        // 0) prepare a map of all indices in newItems, scanning backwards so we encounter them in natural order
        newIndices = new Map<T, number>();
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
            indexes && (tempIndexes![j] = indexes[i]);
            j = newIndicesNext[j];
            newIndices.set(item, j);
          } else disposers[i]();
        }
        // 2) set all the new values, pulling from the temp array if copied, otherwise entering the new value
        for (j = start; j < newLen; j++) {
          if (j in temp) {
            mapped[j] = temp[j];
            disposers[j] = tempdisposers[j];
            if (indexes) {
              indexes[j] = tempIndexes![j];
              indexes[j](j);
            }
          } else mapped[j] = createRoot(mapper);
        }
        // 3) in case the new set is shorter than the old, set the length of the mapped array
        mapped = mapped.slice(0, (len = newLen));
        // 4) save a copy of the mapped items for the next update
        items = newItems.slice(0);
      }
      return mapped;
    });
    function mapper(disposer: () => void) {
      disposers[j] = disposer;
      if (indexes) {
        const [s, set] = "_SOLID_DEV_" ? createSignal(j, { name: "index" }) : createSignal(j);
        indexes[j] = set;
        return mapFn(newItems[j], s);
      }
      return (mapFn as any)(newItems[j]);
    }
  };
}

/**
 * reactively maps arrays by index instead of value - underlying helper for the `<Index>` control flow
 *
 * similar to `Array.prototype.map`, but gets the value as an accessor, transforms only changed items of the original arrays anew and returns an accessor.
 *
 * @description https://www.solidjs.com/docs/latest/api#indexarray
 */
export function indexArray<T, U>(
  list: Accessor<readonly T[] | undefined | null | false>,
  mapFn: (v: Accessor<T>, i: number) => U,
  options: { fallback?: Accessor<any> } = {}
): () => U[] {
  let items: (T | typeof FALLBACK)[] = [],
    mapped: U[] = [],
    disposers: (() => void)[] = [],
    signals: Setter<T>[] = [],
    len = 0,
    i: number;

  onCleanup(() => dispose(disposers));
  return () => {
    const newItems = list() || [];
    (newItems as any)[$TRACK]; // top level tracking
    return untrack(() => {
      if (newItems.length === 0) {
        if (len !== 0) {
          dispose(disposers);
          disposers = [];
          items = [];
          mapped = [];
          len = 0;
          signals = [];
        }
        if (options.fallback) {
          items = [FALLBACK];
          mapped[0] = createRoot(disposer => {
            disposers[0] = disposer;
            return options.fallback!();
          });
          len = 1;
        }
        return mapped;
      }
      if (items[0] === FALLBACK) {
        disposers[0]();
        disposers = [];
        items = [];
        mapped = [];
        len = 0;
      }

      for (i = 0; i < newItems.length; i++) {
        if (i < items.length && items[i] !== newItems[i]) {
          signals[i](() => newItems[i]);
        } else if (i >= items.length) {
          mapped[i] = createRoot(mapper);
        }
      }
      for (; i < items.length; i++) {
        disposers[i]();
      }
      len = signals.length = disposers.length = newItems.length;
      items = newItems.slice(0);
      return (mapped = mapped.slice(0, len));
    });
    function mapper(disposer: () => void) {
      disposers[i] = disposer;
      const [s, set] = "_SOLID_DEV_"
        ? createSignal(newItems[i], { name: "value" })
        : createSignal(newItems[i]);
      signals[i] = set;
      return mapFn(s, i);
    }
  };
}
