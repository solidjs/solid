import { read, setSignal } from "../core/index.js";
import {
  $PROXY,
  $TARGET,
  $TRACK,
  getKeys,
  isWrappable,
  STORE_HAS,
  STORE_LOOKUP,
  STORE_NODE,
  STORE_OPTIMISTIC_OVERRIDE,
  STORE_OVERRIDE,
  STORE_VALUE,
  notifySelf,
  storeLookup,
  wrap
} from "./store.js";

function unwrap(value: any) {
  // Primitives can't be store proxies; skip the symbol lookups (which box the
  // primitive) for the common leaf case.
  if (value === null || typeof value !== "object") return value;
  return value[$TARGET]?.[STORE_NODE] ?? value;
}

function getOverrideValue(value: any, override: any, key: string, optOverride?: any) {
  if (optOverride && key in optOverride) return optOverride[key];
  return override && key in override ? override[key] : value[key];
}

function getAllKeys(value, override, next) {
  const keys = getKeys(value, override) as string[];
  const nextKeys = Object.keys(next);
  // Fast path: identical key sets in identical order (the overwhelmingly
  // common shape during reconcile) — no Set, no copies.
  if (keys.length === nextKeys.length) {
    let same = true;
    for (let i = 0; i < keys.length; i++) {
      if (keys[i] !== nextKeys[i]) {
        same = false;
        break;
      }
    }
    if (same) return keys;
  }
  const set = new Set(keys);
  for (let i = 0; i < nextKeys.length; i++) set.add(nextKeys[i]);
  return Array.from(set);
}

// Dispatcher: every applyState call (including recursion) checks for the
// presence of override / optimistic-override slots once and routes to the
// appropriate body. The fast body never calls `getOverrideValue` and never
// branches on a `fastPath` boolean, so V8 sees a tighter, more inlinable
// shape for the overwhelmingly common case of plain stores.
function applyState(next: any, state: any, keyFn: (item: NonNullable<any>) => any) {
  const target = state?.[$TARGET];
  if (!target) return;
  if (target[STORE_OVERRIDE] || target[STORE_OPTIMISTIC_OVERRIDE]) {
    applyStateSlow(next, target, keyFn);
  } else {
    applyStateFast(next, target, keyFn);
  }
}

function applyStateFast(next: any, target: any, keyFn: (item: NonNullable<any>) => any) {
  const previous = target[STORE_VALUE];
  if (next === previous) return;
  const arrayNodes = target[STORE_NODE];

  // swap
  (target[STORE_LOOKUP] || storeLookup).set(next, target[$PROXY]);
  target[STORE_VALUE] = next;

  // merge
  if (Array.isArray(previous)) {
    let changed = false;
    const prevLength = (previous as any).length;
    if (next.length && prevLength && next[0] && keyFn(next[0]) != null) {
      let i, j, start, end, newEnd, item, newIndicesNext, keyVal;

      for (
        start = 0, end = Math.min(prevLength, next.length);
        start < end &&
        ((item = previous[start]) === next[start] ||
          (item && next[start] && keyFn(item) === keyFn(next[start])));
        start++
      ) {
        applyState(next[start], wrap(item, target), keyFn);
      }

      const temp = new Array(next.length),
        newIndices = new Map();

      for (
        end = prevLength - 1, newEnd = next.length - 1;
        end >= start &&
        newEnd >= start &&
        ((item = previous[end]) === next[newEnd] ||
          (item && next[newEnd] && keyFn(item) === keyFn(next[newEnd])));
        end--, newEnd--
      ) {
        temp[newEnd] = item;
      }

      if (start > newEnd || start > end) {
        for (j = start; j <= newEnd; j++) {
          changed = true;
          arrayNodes?.[j] && setSignal(arrayNodes[j], wrap(next[j], target));
        }

        for (; j < next.length; j++) {
          changed = true;
          const wrapped = wrap(temp[j], target);
          arrayNodes?.[j] && setSignal(arrayNodes[j], wrapped);
          applyState(next[j], wrapped, keyFn);
        }

        changed && notifySelf(target);
        prevLength !== next.length &&
          arrayNodes?.length &&
          setSignal(arrayNodes.length, next.length);
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
          temp[j] = item;
          j = newIndicesNext[j];
          newIndices.set(keyVal, j);
        }
      }

      for (j = start; j < next.length; j++) {
        if (j in temp) {
          const wrapped = wrap(temp[j], target);
          arrayNodes?.[j] && setSignal(arrayNodes[j], wrapped);
          applyState(next[j], wrapped, keyFn);
        } else arrayNodes?.[j] && setSignal(arrayNodes[j], wrap(next[j], target));
      }
      if (start < next.length) changed = true;
    } else if (next.length) {
      for (let i = 0, len = next.length; i < len; i++) {
        const item = previous[i];
        if (isWrappable(item)) applyState(next[i], wrap(item, target), keyFn);
        else {
          if (item !== next[i]) changed = true;
          arrayNodes?.[i] && setSignal(arrayNodes[i], next[i]);
        }
      }
    }

    if (prevLength !== next.length) {
      changed = true;
      arrayNodes?.length && setSignal(arrayNodes.length, next.length);
    }
    changed && notifySelf(target);
    return;
  }

  // values
  let nodes = target[STORE_NODE];
  if (nodes) {
    const tracked = nodes[$TRACK];
    const keys = tracked ? getAllKeys(previous, undefined, next) : Object.keys(nodes);
    for (let i = 0, len = keys.length; i < len; i++) {
      const key = keys[i];
      const node = nodes[key];
      const previousValue = unwrap(previous[key]);
      let nextValue = unwrap(next[key]);
      if (previousValue === nextValue) continue;
      if (
        !previousValue ||
        !isWrappable(previousValue) ||
        !isWrappable(nextValue) ||
        (keyFn(previousValue) != null && keyFn(previousValue) !== keyFn(nextValue))
      ) {
        tracked && setSignal(tracked, void 0);
        node && setSignal(node, isWrappable(nextValue) ? wrap(nextValue, target) : nextValue);
      } else applyState(nextValue, wrap(previousValue, target), keyFn);
    }
  }

  // has
  if ((nodes = target[STORE_HAS])) {
    const keys = Object.keys(nodes);
    for (let i = 0, len = keys.length; i < len; i++) {
      const key = keys[i];
      setSignal(nodes[key], key in next);
    }
  }
}

function applyStateSlow(next: any, target: any, keyFn: (item: NonNullable<any>) => any) {
  const previous = target[STORE_VALUE];
  const override = target[STORE_OVERRIDE];
  const optOverride = target[STORE_OPTIMISTIC_OVERRIDE];
  let nodes = target[STORE_NODE];

  // swap
  (target[STORE_LOOKUP] || storeLookup).set(next, target[$PROXY]);
  target[STORE_VALUE] = next;
  target[STORE_OVERRIDE] = undefined;

  // merge
  if (Array.isArray(previous)) {
    let changed = false;
    const prevLength = getOverrideValue(previous, override, "length", optOverride);
    if (next.length && prevLength && next[0] && keyFn(next[0]) != null) {
      let i, j, start, end, newEnd, item, newIndicesNext, keyVal;

      for (
        start = 0, end = Math.min(prevLength, next.length);
        start < end &&
        ((item = getOverrideValue(previous, override, start, optOverride)) === next[start] ||
          (item && next[start] && keyFn(item) === keyFn(next[start])));
        start++
      ) {
        applyState(next[start], wrap(item, target), keyFn);
      }

      const temp = new Array(next.length),
        newIndices = new Map();

      for (
        end = prevLength - 1, newEnd = next.length - 1;
        end >= start &&
        newEnd >= start &&
        ((item = getOverrideValue(previous, override, end, optOverride)) === next[newEnd] ||
          (item && next[newEnd] && keyFn(item) === keyFn(next[newEnd])));
        end--, newEnd--
      ) {
        temp[newEnd] = item;
      }

      if (start > newEnd || start > end) {
        for (j = start; j <= newEnd; j++) {
          changed = true;
          nodes?.[j] && setSignal(nodes[j], wrap(next[j], target));
        }

        for (; j < next.length; j++) {
          changed = true;
          const wrapped = wrap(temp[j], target);
          nodes?.[j] && setSignal(nodes[j], wrapped);
          applyState(next[j], wrapped, keyFn);
        }

        const nextLength = next.length;
        changed && notifySelf(target);
        prevLength !== nextLength && nodes?.length && setSignal(nodes.length, nextLength);
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
        item = getOverrideValue(previous, override, i, optOverride);
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
          nodes?.[j] && setSignal(nodes[j], wrapped);
          applyState(next[j], wrapped, keyFn);
        } else nodes?.[j] && setSignal(nodes[j], wrap(next[j], target));
      }
      if (start < next.length) changed = true;
    } else if (next.length) {
      for (let i = 0, len = next.length; i < len; i++) {
        const item = getOverrideValue(previous, override, i as any, optOverride);
        if (isWrappable(item)) applyState(next[i], wrap(item, target), keyFn);
        else {
          if (item !== next[i]) changed = true;
          nodes?.[i] && setSignal(nodes[i], next[i]);
        }
      }
    }

    const nextLength = next.length;

    if (prevLength !== nextLength) {
      changed = true;
      nodes?.length && setSignal(nodes.length, nextLength);
    }
    changed && notifySelf(target);
    return;
  }

  // values
  if (nodes) {
    const tracked = nodes[$TRACK];
    const keys = tracked ? getAllKeys(previous, override, next) : Object.keys(nodes);
    for (let i = 0, len = keys.length; i < len; i++) {
      const key = keys[i];
      const node = nodes[key];
      const previousValue = unwrap(getOverrideValue(previous, override, key, optOverride));
      let nextValue = unwrap(next[key]);
      if (previousValue === nextValue) continue;
      if (
        !previousValue ||
        !isWrappable(previousValue) ||
        !isWrappable(nextValue) ||
        (keyFn(previousValue) != null && keyFn(previousValue) !== keyFn(nextValue))
      ) {
        tracked && setSignal(tracked, void 0);
        node && setSignal(node, isWrappable(nextValue) ? wrap(nextValue, target) : nextValue);
      } else applyState(nextValue, wrap(previousValue, target), keyFn);
    }
  }

  // has
  if ((nodes = target[STORE_HAS])) {
    const keys = Object.keys(nodes);
    for (let i = 0, len = keys.length; i < len; i++) {
      const key = keys[i];
      setSignal(nodes[key], key in next);
    }
  }
}

/**
 * Returns a draft-mutating function that smart-merges `value` into a store,
 * preserving the identity of items whose `key` field matches between old and
 * new states. Useful when applying server payloads or full-replacement data
 * onto an existing store without losing fine-grained reactivity.
 *
 * Items with the same key are updated in place (only changed properties
 * trigger updates). Items added or removed update the corresponding signals.
 *
 * @param value the next state to merge in
 * @param key property name (string) or extractor function for stable identity
 *
 * @example
 * ```ts
 * const [todos, setTodos] = createStore<Todo[]>([]);
 *
 * async function refresh() {
 *   const fresh = await api.getTodos();
 *   setTodos(reconcile(fresh, "id")); // diff-merge by `id`
 * }
 * ```
 */
export function reconcile<T extends U, U>(
  value: T,
  key: string | ((item: NonNullable<any>) => any)
) {
  return (state: U) => {
    if (state == null) throw new Error("Cannot reconcile null or undefined state");
    const keyFn = typeof key === "string" ? item => item[key] : key;
    const eq = keyFn(state);
    if (eq !== undefined && keyFn(value) !== eq)
      throw new Error("Cannot reconcile states with different identity");
    applyState(value, state, keyFn);
  };
}
