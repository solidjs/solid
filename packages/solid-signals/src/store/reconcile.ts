import {
  $PROXY,
  $TARGET,
  $TRACK,
  isWrappable,
  STORE_HAS,
  STORE_NODE,
  STORE_VALUE,
  unwrap,
  wrap,
} from './store.js';

function applyState(next: any, state: any, keyFn: (item: NonNullable<any>) => any) {
  const target = state?.[$TARGET];
  if (!target) return;
  const previous = target[STORE_VALUE];
  if (next === previous) return;

  // swap
  Object.defineProperty(next, $PROXY, {
    value: previous[$PROXY],
    writable: true,
  });
  previous[$PROXY] = null;
  target[STORE_VALUE] = next;

  // merge
  if (Array.isArray(previous)) {
    let changed = false;
    if (
      next.length &&
      previous.length &&
      (next[0] && keyFn(next[0]) != null)
    ) {
      let i, j, start, end, newEnd, item, newIndicesNext, keyVal; // common prefix

      for (
        start = 0, end = Math.min(previous.length, next.length);
        start < end &&
        (previous[start] === next[start] ||
          (previous[start] &&
            next[start] &&
            keyFn(previous[start]) === keyFn(next[start])));
        start++
      ) {
        applyState(next[start], wrap(previous[start]), keyFn);
      }

      const temp = new Array(next.length),
        newIndices = new Map();

      for (
        end = previous.length - 1, newEnd = next.length - 1;
        end >= start &&
        newEnd >= start &&
        (previous[end] === next[newEnd] ||
          (previous[end] &&
            next[newEnd] &&
            keyFn(previous[end]) === keyFn(next[newEnd])));
        end--, newEnd--
      ) {
        temp[newEnd] = previous[end];
      }

      if (start > newEnd || start > end) {
        for (j = start; j <= newEnd; j++) {
          changed = true;
          target[STORE_NODE][j]?.write(wrap(next[j]));
        }

        for (; j < next.length; j++) {
          changed = true;
          const wrapped = wrap(temp[j]);
          target[STORE_NODE][j]?.write(wrapped);
          applyState(next[j], wrapped, keyFn);
        }

        changed && target[STORE_NODE][$TRACK]?.write(void 0);
        previous.length !== next.length &&
          target[STORE_NODE].length?.write(next.length);
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
        item = previous[i];
        keyVal = item ? keyFn(item) : item;
        j = newIndices.get(keyVal);

        if (j !== undefined && j !== -1) {
          temp[j] = previous[i];
          j = newIndicesNext[j];
          newIndices.set(keyVal, j);
        }
      }

      for (j = start; j < next.length; j++) {
        if (j in temp) {
          const wrapped = wrap(temp[j]);
          target[STORE_NODE][j]?.write(wrapped);
          applyState(next[j], wrapped, keyFn);
        } else target[STORE_NODE][j]?.write(wrap(next[j]));
      }
      if (start < next.length) changed = true;
    } else if (previous.length && next.length) {
      for (let i = 0, len = next.length; i < len; i++) {
        isWrappable(previous[i]) &&
          applyState(next[i], wrap(previous[i]), keyFn);
      }
    }

    if (previous.length !== next.length) {
      changed = true;
      target[STORE_NODE].length?.write(next.length);
    }
    changed && target[STORE_NODE][$TRACK]?.write(void 0);
    return;
  }

  // values
  let nodes = target[STORE_NODE];
  if (nodes) {
    const keys = Object.keys(nodes);
    for (let i = 0, len = keys.length; i < len; i++) {
      const node = nodes[keys[i]];
      const previousValue = unwrap(previous[keys[i]], false);
      let nextValue = unwrap(next[keys[i]], false);
      if (previousValue === nextValue) continue;
      if (
        !previousValue ||
        !isWrappable(previousValue) ||
        (keyFn(previousValue) != null && keyFn(previousValue) !== keyFn(nextValue))
      )
        node.write(isWrappable(nextValue) ? wrap(nextValue) : nextValue);
      else applyState(nextValue, wrap(previousValue), keyFn);
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
) {
  return (state: U) => {
    const keyFn = typeof key === "string" ? (item) => item[key] : key
    if (keyFn(value) !== keyFn(state)) throw new Error("Cannot reconcile states with different identity")
    applyState(value, state, keyFn)
  }
}
