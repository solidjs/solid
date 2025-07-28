import {
  $PROXY,
  $TARGET,
  $TRACK,
  getKeys,
  isWrappable,
  STORE_HAS,
  STORE_LOOKUP,
  STORE_NODE,
  STORE_OVERRIDE,
  STORE_VALUE,
  storeLookup,
  wrap
} from "./store.js";

function unwrap(value: any) {
  return value?.[$TARGET]?.[STORE_NODE] ?? value;
}

function getOverrideValue(value: any, override: any, key: string) {
  return override && key in override ? override[key] : value[key];
}

function getAllKeys(value, override, next) {
  const keys = getKeys(value, override) as string[];
  const nextKeys = Object.keys(next);
  return Array.from(new Set([...keys, ...nextKeys]));
}

function applyState(next: any, state: any, keyFn: (item: NonNullable<any>) => any, all: boolean) {
  const target = state?.[$TARGET];
  if (!target) return;
  const previous = target[STORE_VALUE];
  const override = target[STORE_OVERRIDE];
  if (next === previous && !override) return;

  // swap
  (target[STORE_LOOKUP] || storeLookup).set(next, target[$PROXY]);
  target[STORE_VALUE] = next;
  target[STORE_OVERRIDE] = undefined;

  // merge
  if (Array.isArray(previous)) {
    let changed = false;
    const prevLength = getOverrideValue(previous, override, "length");
    if (next.length && prevLength && next[0] && keyFn(next[0]) != null) {
      let i, j, start, end, newEnd, item, newIndicesNext, keyVal; // common prefix

      for (
        start = 0, end = Math.min(prevLength, next.length);
        start < end &&
        ((item = getOverrideValue(previous, override, start)) === next[start] ||
          (item && next[start] && keyFn(item) === keyFn(next[start])));
        start++
      ) {
        applyState(next[start], wrap(item, target), keyFn, all);
      }

      const temp = new Array(next.length),
        newIndices = new Map();

      for (
        end = prevLength - 1, newEnd = next.length - 1;
        end >= start &&
        newEnd >= start &&
        ((item = getOverrideValue(previous, override, end)) === next[newEnd] ||
          (item && next[newEnd] && keyFn(item) === keyFn(next[newEnd])));
        end--, newEnd--
      ) {
        temp[newEnd] = item;
      }

      if (start > newEnd || start > end) {
        for (j = start; j <= newEnd; j++) {
          changed = true;
          target[STORE_NODE][j]?.write(wrap(next[j], target));
        }

        for (; j < next.length; j++) {
          changed = true;
          const wrapped = wrap(temp[j], target);
          target[STORE_NODE][j]?.write(wrapped);
          applyState(next[j], wrapped, keyFn, all);
        }

        changed && target[STORE_NODE][$TRACK]?.write(void 0);
        prevLength !== next.length && target[STORE_NODE].length?.write(next.length);
        return;
      }

      newIndicesNext = new Array(newEnd + 1);

      for (j = newEnd; j >= start; j--) {
        item = next[j];
        keyVal = item ? keyFn(item) : item;
        i = newIndices.get(keyVal);
        newIndicesNext[j] = i === undefined ? -1 : i;
        newIndices.set(keyVal, j);
      }

      for (i = start; i <= end; i++) {
        item = getOverrideValue(previous, override, i);
        keyVal = item ? keyFn(item) : item;
        j = newIndices.get(keyVal);

        if (j !== undefined && j !== -1) {
          temp[j] = item;
          j = newIndicesNext[j];
          newIndices.set(keyVal, j);
        }
      }

      for (j = start; j < next.length; j++) {
        if (j in temp) {
          const wrapped = wrap(temp[j], target);
          target[STORE_NODE][j]?.write(wrapped);
          applyState(next[j], wrapped, keyFn, all);
        } else target[STORE_NODE][j]?.write(wrap(next[j], target));
      }
      if (start < next.length) changed = true;
    } else if (prevLength && next.length) {
      for (let i = 0, len = next.length; i < len; i++) {
        const item = getOverrideValue(previous, override, i as any);
        isWrappable(item) && applyState(next[i], wrap(item, target), keyFn, all);
      }
    }

    if (prevLength !== next.length) {
      changed = true;
      target[STORE_NODE].length?.write(next.length);
    }
    changed && target[STORE_NODE][$TRACK]?.write(void 0);
    return;
  }

  // values
  let nodes = target[STORE_NODE];
  if (nodes) {
    const tracked = nodes[$TRACK];
    const keys = tracked || all ? getAllKeys(previous, override, next) : Object.keys(nodes);
    for (let i = 0, len = keys.length; i < len; i++) {
      const key = keys[i];
      const node = nodes[key];
      const previousValue = unwrap(getOverrideValue(previous, override, key));
      let nextValue = unwrap(next[key]);
      if (previousValue === nextValue) continue;
      if (
        !previousValue ||
        !isWrappable(previousValue) ||
        (keyFn(previousValue) != null && keyFn(previousValue) !== keyFn(nextValue))
      ) {
        tracked?.write(void 0);
        node?.write(isWrappable(nextValue) ? wrap(nextValue, target) : nextValue);
      } else applyState(nextValue, wrap(previousValue, target), keyFn, all);
    }
  }

  // has
  if ((nodes = target[STORE_HAS])) {
    const keys = Object.keys(nodes);
    for (let i = 0, len = keys.length; i < len; i++) {
      nodes[keys[i]].write(keys[i] in next);
    }
  }
}

export function reconcile<T extends U, U>(
  value: T,
  key: string | ((item: NonNullable<any>) => any),
  all = false
) {
  return (state: U) => {
    const keyFn = typeof key === "string" ? item => item[key] : key;
    const eq = keyFn(state);
    if (eq !== undefined && keyFn(value) !== keyFn(state))
      throw new Error("Cannot reconcile states with different identity");
    applyState(value, state, keyFn, all);
  };
}
