import S from 's-js';
import { unwrap, from }  from './utils';

export function map(fn) {
  return function mapper(input) {
    input = from(input);
    return () => {
      const value = input();
      if (value === void 0) return;
      return S.sample(() => fn(value));
    };
  };
}

export function pipe(...fns) {
  if (!fns) return i => i;
  if (fns.length === 1) return fns[0];
  return (input) => {
    input = from(input);
    return fns.reduce(((prev, fn) => fn(prev)), input);
  };
}

// Need to be able grab wrapped state internals so can't use S-Array
// handles non arrays as well, and falsey rejection
export function memo(mapFn) {
  let mapped = [],
      list = [],
      disposables = [],
      length = 0;
  S.cleanup(function dispose() {
    for (let i = 0; i < disposables.length; i++) disposables[i]();
  });
  return map(function mapper(newList) {
    let newListUnwrapped = unwrap(newList),
        i, j = 0, newLength, start, end, newEnd, item, itemIndex, newMapped,
        indexedItems, tempDisposables;
    // Non-Arrays
    if (!Array.isArray(newListUnwrapped)) {
      if (newListUnwrapped == null || newListUnwrapped === false) {
        for (i = 0; i < length; i++) disposables[i]();
        list = [];
        mapped = [];
        disposables = [];
        length = 0;
        return null;
      }
      if (list[0] === newListUnwrapped) return mapped[0];
      for (i = 0; i < length; i++) disposables[i]();
      disposables = [];
      length = 1;
      list[0] = newListUnwrapped;
      return mapped[0] = S.root(mappedFn);
    }

    newLength = newListUnwrapped.length;
    if (newLength === 0) {
      if (length !== 0) {
        for (i = 0; i < length; i++) disposables[i]();
        list = [];
        mapped = [];
        disposables = [];
        length = 0;
      }
    } else if (length === 0) {
      j = 0;
      while (j < newLength) {
        list[j] = newListUnwrapped[j];
        mapped[j] = S.root(mappedFn);
        j++;
      }
      length = newLength;
    } else {
      newMapped = new Array(newLength);
      tempDisposables = new Array(newLength);
      indexedItems = new Map();

      // reduce from both ends
      end = Math.min(length, newLength);
      start = 0;
      while (start < end && newListUnwrapped[start] === list[start]) start++;

      end = length - 1;
      newEnd = newLength - 1;
      while (end >= 0 && newEnd >= 0 && newListUnwrapped[newEnd] === list[end]) {
        newMapped[newEnd] = mapped[end];
        tempDisposables[newEnd] = disposables[end];
        end--;
        newEnd--;
      }

      // create indices
      j = newEnd;
      while (j >= start) {
        item = newListUnwrapped[j];
        itemIndex = indexedItems.get(item);
        if (itemIndex != null) itemIndex.push(j);
        else indexedItems.set(item, [j]);
        j--;
      }

      // find old items
      i = start;
      while (i <= end) {
        item = list[i];
        itemIndex = indexedItems.get(item);
        if (itemIndex != null && itemIndex.length > 0) {
          j = itemIndex.pop();
          newMapped[j] = mapped[i];
          tempDisposables[j] = disposables[i];
        } else disposables[i]();
        i++;
      }

      // set all new values
      j = start;
      while (j < newLength) {
        if (newMapped.hasOwnProperty(j)) {
          mapped[j] = newMapped[j];
          disposables[j] = tempDisposables[j];
        } else mapped[j] = S.root(mappedFn);
        j++;
      }

      // truncate extra length
      length = mapped.length = disposables.length = newLength;
      // save list for next iteration
      list = newListUnwrapped.slice(0);
    }
    return mapped;

    function mappedFn(dispose) {
      let ref;
      disposables[j] = dispose;
      const row = (ref = newList.sample) ? ref(j) : newList[j];
      return mapFn(row, j);
    }
  });
}

// export observable
export function observable(input) {
  if ($$observable in input) return input[$$observable]();
  return {
    subscribe(observer) {
      if (!(observer instanceof Object) || observer == null) {
        throw new TypeError('Expected the observer to be an object.');
      }
      observer = observer.next || observer;
      let complete = false;
      S.on(input, function next() {
        if (complete) return;
        observer(input());
      });
      return {
        unsubscribe() { complete = true; }
      };
    },
    [$$observable]() { return this; }
  };
}
