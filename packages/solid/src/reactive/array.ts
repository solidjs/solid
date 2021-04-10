import { onCleanup, createRoot, untrack, createSignal, Owner } from "./signal";

const FALLBACK = Symbol("fallback");

// Modified version of mapSample from S-array[https://github.com/adamhaile/S-array] by Adam Haile
export function mapArray<T, U>(
  list: () => readonly T[],
  mapFn: (v: T, i: () => number) => U,
  options: { fallback?: () => any } = {}
): () => U[] {
  let items: (T | typeof FALLBACK)[] = [],
    mapped: U[] = [],
    disposers: (() => void)[] = [],
    len = 0,
    indexes: ((v: number) => number)[] | null = mapFn.length > 1 ? [] : null,
    ctx = Owner!;

  onCleanup(() => {
    for (let i = 0, length = disposers.length; i < length; i++) disposers[i]();
  });
  return () => {
    let newItems = list() || [],
      i: number,
      j: number;
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
          for (i = 0; i < len; i++) disposers[i]();
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
          }, ctx);
          len = 1;
        }
      }
      // fast path for new create
      else if (len === 0) {
        for (j = 0; j < newLen; j++) {
          items[j] = newItems[j];
          mapped[j] = createRoot(mapper, ctx);
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
          } else mapped[j] = createRoot(mapper, ctx);
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
      if (indexes) {
        const [s, set] = createSignal(j);
        indexes[j] = set;
        return mapFn(newItems[j], s);
      }
      return (mapFn as any)(newItems[j]);
    }
  };
}

export function indexArray<T, U>(
  list: () => readonly T[],
  mapFn: (v: () => T, i: number) => U,
  options: { fallback?: () => any } = {}
): () => U[] {
  let items: (T | typeof FALLBACK)[] = [],
    mapped: U[] = [],
    disposers: (() => void)[] = [],
    signals: ((v: T) => T)[] = [],
    len = 0,
    i: number,
    ctx = Owner!;

  onCleanup(() => {
    for (let i = 0, length = disposers.length; i < length; i++) disposers[i]();
  });
  return () => {
    const newItems = list() || [];
    return untrack(() => {
      if (newItems.length === 0) {
        if (len !== 0) {
          for (i = 0; i < len; i++) disposers[i]();
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
          }, ctx);
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
          signals[i](newItems[i]);
        } else if (i >= items.length) {
          mapped[i] = createRoot(mapper, ctx);
        }
      }
      for (; i < items.length; i++) {
        disposers[i]();
      }
      len = mapped.length = signals.length = disposers.length = newItems.length;
      items = newItems.slice(0);
      return mapped;
    });
    function mapper(disposer: () => void) {
      disposers[i] = disposer;
      const [s, set] = createSignal(newItems[i], false);
      signals[i] = set;
      return mapFn(s, i);
    }
  };
}
