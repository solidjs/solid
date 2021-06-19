import {
  setProperty,
  unwrap,
  isWrappable,
  State,
  NotWrappable,
  StateNode,
  DeepReadonly,
  $RAW,
} from "./state";

export type ReconcileOptions = {
  key?: string | null;
  merge?: boolean;
};

function applyState(
  target: any,
  parent: any,
  property: string | number,
  merge: boolean | undefined,
  key: string | null
) {
  let previous = parent[property];
  if (target === previous) return;
  if (!isWrappable(target) || !isWrappable(previous) || (key && target[key] !== previous[key])) {
    target !== previous && setProperty(parent, property, target);
    return;
  }

  if (Array.isArray(target)) {
    if (target.length && previous.length && (!merge || (key && target[0][key] != null))) {
      let i, j, start, end, newEnd, item, newIndicesNext, keyVal;
      // common prefix
      for (
        start = 0, end = Math.min(previous.length, target.length);
        start < end &&
        (previous[start] === target[start] || (key && previous[start][key] === target[start][key]));
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
        (previous[end] === target[newEnd] || (key && previous[end][key] === target[newEnd][key]));
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
        keyVal = key ? item[key] : item;
        i = newIndices.get(keyVal);
        newIndicesNext[j] = i === undefined ? -1 : i;
        newIndices.set(keyVal, j);
      }
      // step through all old items to check reuse
      for (i = start; i <= end; i++) {
        item = previous[i];
        keyVal = key ? item[key] : item;
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

// Diff method for setState
export function reconcile<T>(
  value: T | State<T>,
  options: ReconcileOptions = {}
): (
  state: T extends NotWrappable ? T : State<DeepReadonly<T>>
) => T extends NotWrappable ? T : State<T> {
  const { merge, key = "id" } = options,
    v = unwrap(value);
  return s => {
    const state = s as T extends NotWrappable ? T : State<T>;
    if (!isWrappable(state) || !isWrappable(v)) return v as T extends NotWrappable ? T : State<T>;
    applyState(v, { state }, "state", merge, key);
    return state;
  };
}

const setterTraps: ProxyHandler<StateNode> = {
  get(target, property): any {
    if (property === $RAW) return target;
    const value = target[property as string | number];
    return isWrappable(value) ? new Proxy(value, setterTraps) : value;
  },

  set(target, property, value) {
    setProperty(target, property as string, unwrap(value));
    return true;
  },

  deleteProperty(target, property) {
    setProperty(target, property as string, undefined);
    return true;
  }
};

// Immer style mutation style
export function produce<T>(
  fn: (state: T) => void
): (
  state: T extends NotWrappable ? T : State<DeepReadonly<T>>
) => T extends NotWrappable ? T : State<T> {
  return s => {
    const state = s as T extends NotWrappable ? T : State<T>;
    if (isWrappable(state)) fn(new Proxy(state as object, setterTraps) as unknown as T);
    return state;
  };
}
