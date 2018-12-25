import S from 's-js';

export function pipe(input, ...fns) {
  return compose(...fns)(input);
}

export function compose(...fns) {
  if (!fns) return i => i;
  if (fns.length === 1) return fns[0];
  return input => fns.reduce(((prev, fn) => fn(prev)), input);
}

export function map(fn) {
  return input => () => {
    const value = input();
    if (value === void 0) return;
    return S.sample(() => fn(value));
  }
}

export function tap(fn) {
  return input => () => {
    const value = input();
    if (value !== void 0) S.sample(() => fn(value));
    return;
  }
}

// memoized map that handles falsey rejection
export function when(mapFn) {
  let mapped, value, disposable;
  S.cleanup(function dispose() {
    disposable && disposable();
  });
  return map(function mapper(newValue) {
    if (newValue == null || newValue === false) {
      disposable && disposable();
      return value = mapped = disposable = null;
    }
    if (value === newValue) return mapped;
    disposable && disposable();
    disposable = null;
    value = newValue;
    return mapped = S.root((d) => {
      disposable = d;
      return mapFn(value);
    });
  })
}

// Need to be able grab wrapped state internals so can't use S-Array
export function each(mapFn) {
  let mapped = [],
      list = [],
      disposables = [],
      length = 0;
  S.cleanup(function dispose() {
    for (let i = 0; i < disposables.length; i++) disposables[i]();
  });
  return map(function mapper(newList) {
    let i, j = 0,
      newLength = (newList && newList.length) || 0;
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
        list[j] = newList[j];
        mapped[j] = S.root(mappedFn);
        j++;
      }
      length = newLength;
    } else {
      const newMapped = new Array(newLength),
        tempDisposables = new Array(newLength),
        indexedItems = new Map();

      // reduce from both ends
      let end = Math.min(length, newLength),
        start = 0, item, itemIndex, newEnd;
      while (start < end && newList[start] === list[start]) start++;

      end = length - 1;
      newEnd = newLength - 1;
      while (end >= 0 && newEnd >= 0 && newList[newEnd] === list[end]) {
        newMapped[newEnd] = mapped[end];
        tempDisposables[newEnd] = disposables[end];
        end--;
        newEnd--;
      }

      // create indices
      j = newEnd;
      while (j >= start) {
        item = newList[j];
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
        list[j] = newList[j];
        if (newMapped.hasOwnProperty(j)) {
          mapped[j] = newMapped[j];
          disposables[j] = tempDisposables[j];
        } else mapped[j] = S.root(mappedFn);
        j++;
      }

      // truncate extra length
      length = list.length = mapped.length = disposables.length = newLength;
    }
    return mapped;

    function mappedFn(dispose) {
      disposables[j] = dispose;
      return mapFn(list[j], j);
    }
  });
}

// export observable
export function observable(input) {
  if (Symbol.observable in input) return input[Symbol.observable]();
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
    [Symbol.observable]() { return this; }
  };
}
