import { setProperty, unwrap, isWrappable, StoreNode, $RAW } from "./store.js";

const $ROOT = Symbol("store-root");

export type ReconcileOptions = {
  key?: string | null;
  merge?: boolean;
};

function applyState(
  target: any,
  parent: any,
  property: PropertyKey,
  merge: boolean | undefined,
  key: string | null
) {
  const previous = parent[property];
  if (target === previous) return;
  const isArray = Array.isArray(target);
  if (
    property !== $ROOT &&
    (!isWrappable(target) ||
      !isWrappable(previous) ||
      isArray !== Array.isArray(previous) ||
      (key && target[key] !== previous[key]))
  ) {
    setProperty(parent, property, target);
    return;
  }

  if (isArray) {
    if (
      target.length &&
      previous.length &&
      (!merge || (key && target[0] && target[0][key] != null))
    ) {
      let i, j, start, end, newEnd, item, newIndicesNext, keyVal;
      // common prefix
      for (
        start = 0, end = Math.min(previous.length, target.length);
        start < end &&
        (previous[start] === target[start] ||
          (key && previous[start] && target[start] && previous[start][key] === target[start][key]));
        start++
      ) {
        applyState(target[start], previous, start, merge, key);
      }

      const temp = new Array(target.length),
        newIndices = new Map();
      // common suffix
      for (
        end = previous.length - 1, newEnd = target.length - 1;
        end >= start &&
        newEnd >= start &&
        (previous[end] === target[newEnd] ||
          (key && previous[start] && target[start] && previous[end][key] === target[newEnd][key]));
        end--, newEnd--
      ) {
        temp[newEnd] = previous[end];
      }

      // insert any remaining updates and remove any remaining nodes and we're done
      if (start > newEnd || start > end) {
        for (j = start; j <= newEnd; j++) setProperty(previous, j, target[j]);
        for (; j < target.length; j++) {
          setProperty(previous, j, temp[j]);
          applyState(target[j], previous, j, merge, key);
        }
        if (previous.length > target.length) setProperty(previous, "length", target.length);
        return;
      }

      // prepare a map of all indices in target
      newIndicesNext = new Array(newEnd + 1);
      for (j = newEnd; j >= start; j--) {
        item = target[j];
        keyVal = key && item ? item[key] : item;
        i = newIndices.get(keyVal);
        newIndicesNext[j] = i === undefined ? -1 : i;
        newIndices.set(keyVal, j);
      }
      // step through all old items to check reuse
      for (i = start; i <= end; i++) {
        item = previous[i];
        keyVal = key && item ? item[key] : item;
        j = newIndices.get(keyVal);
        if (j !== undefined && j !== -1) {
          temp[j] = previous[i];
          j = newIndicesNext[j];
          newIndices.set(keyVal, j);
        }
      }
      // set all the new values
      for (j = start; j < target.length; j++) {
        if (j in temp) {
          setProperty(previous, j, temp[j]);
          applyState(target[j], previous, j, merge, key);
        } else setProperty(previous, j, target[j]);
      }
    } else {
      for (let i = 0, len = target.length; i < len; i++) {
        applyState(target[i], previous, i, merge, key);
      }
    }
    if (previous.length > target.length) setProperty(previous, "length", target.length);
    return;
  }

  const targetKeys = Object.keys(target);
  for (let i = 0, len = targetKeys.length; i < len; i++) {
    applyState(target[targetKeys[i]], previous, targetKeys[i], merge, key);
  }
  const previousKeys = Object.keys(previous);
  for (let i = 0, len = previousKeys.length; i < len; i++) {
    if (target[previousKeys[i]] === undefined) setProperty(previous, previousKeys[i], undefined);
  }
}

// Diff method for setStore
export function reconcile<T extends U, U>(
  value: T,
  options: ReconcileOptions = {}
): (state: U) => T {
  const { merge, key = "id" } = options,
    v = unwrap(value);
  return state => {
    if (!isWrappable(state) || !isWrappable(v)) return v;
    const res = applyState(v, { [$ROOT]: state }, $ROOT, merge, key);
    return res === undefined ? (state as T) : res;
  };
}

const producers = new WeakMap();
const setterTraps: ProxyHandler<StoreNode> = {
  get(target, property): any {
    if (property === $RAW) return target;
    const value = target[property];
    let proxy;
    return isWrappable(value)
      ? producers.get(value) ||
          (producers.set(value, (proxy = new Proxy(value, setterTraps))), proxy)
      : value;
  },

  set(target, property, value) {
    setProperty(target, property, unwrap(value));
    return true;
  },

  deleteProperty(target, property) {
    setProperty(target, property, undefined, true);
    return true;
  }
};

// Immer style mutation style
export function produce<T>(fn: (state: T) => void): (state: T) => T {
  return state => {
    if (isWrappable(state)) {
      let proxy;
      if (!(proxy = producers.get(state as Record<keyof T, T[keyof T]>))) {
        producers.set(
          state as Record<keyof T, T[keyof T]>,
          (proxy = new Proxy(state as Extract<T, object>, setterTraps))
        );
      }
      fn(proxy);
    }
    return state;
  };
}
