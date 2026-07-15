import { setSignal, untrack } from "../core/index.js";
import {
  $DELETED,
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
  symbolKeyedRecords,
  wrap
} from "./store.js";

// Enumerate a node record's keys. Keeps the common string-key path on the
// `Object.keys` fast path; only records currently holding a user symbol node
// (marked by `getNode`) pay for symbol enumeration. `$TRACK` is the only
// internal symbol a node record can hold and callers handle it separately.
function nodeKeys(nodes: Record<PropertyKey, any>): PropertyKey[] {
  const keys: PropertyKey[] = Object.keys(nodes);
  if (symbolKeyedRecords.has(nodes)) {
    const syms = Object.getOwnPropertySymbols(nodes);
    for (let i = 0, len = syms.length; i < len; i++) {
      if (syms[i] !== $TRACK) keys.push(syms[i]);
    }
  }
  return keys;
}

function unwrap(value: any) {
  // Primitives can't be store proxies; skip the symbol lookups (which box the
  // primitive) for the common leaf case.
  if (value === null || typeof value !== "object") return value;
  return value[$TARGET]?.[STORE_VALUE] ?? value;
}

function getOverrideValue(value: any, override: any, key: PropertyKey, optOverride?: any) {
  if (optOverride && key in optOverride) return optOverride[key];
  return override && key in override ? override[key] : value[key];
}

// Append `o`'s *enumerable* own symbol keys from a pre-fetched symbol list.
function addEnumSymbols(o: any, syms: symbol[], keys: Set<PropertyKey>) {
  for (let i = 0, len = syms.length; i < len; i++) {
    if (Object.prototype.propertyIsEnumerable.call(o, syms[i])) keys.add(syms[i]);
  }
}

function getAllKeys(value, override, next) {
  const keys = getKeys(value, override) as PropertyKey[];
  const nextKeys = Object.keys(next);
  // `value` can be a wrapped store (store-in-store) whose ownKeys trap tracks;
  // mirror `getKeys` and enumerate its symbols untracked in that case.
  const valueSyms = (value as any)[$TARGET]
    ? untrack(() => Object.getOwnPropertySymbols(value))
    : Object.getOwnPropertySymbols(value);
  const nextSyms = Object.getOwnPropertySymbols(next);
  // Symbol-free diff (the overwhelmingly common case) stays on the exact
  // pre-#2851 path, including the identical-key-sets fast path from #2756.
  if (valueSyms.length === 0 && nextSyms.length === 0) {
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
  // Symbol-aware diff (#2851): base symbols join the set, then override
  // adds/deletes are re-applied so a `$DELETED` symbol stays deleted, then
  // `next`'s keys (a key present in next is never deleted by the diff).
  const set = new Set<PropertyKey>(keys);
  addEnumSymbols(value, valueSyms, set);
  if (override) {
    for (const key of Reflect.ownKeys(override)) {
      override[key] === $DELETED ? set.delete(key) : set.add(key);
    }
  }
  for (let i = 0; i < nextKeys.length; i++) set.add(nextKeys[i]);
  addEnumSymbols(next, nextSyms, set);
  return Array.from(set);
}

// Array entries can be `null`/`undefined`/primitives, not just keyed objects.
// These helpers keep the keyed paths from passing a non-object to `keyFn` (which
// assumes an object) or to `wrap()` (which assumes a wrappable value).
function wrapValue(value: any, target: any) {
  return isWrappable(value) ? wrap(value, target) : value;
}

function itemKey(item: any, keyFn: (item: NonNullable<any>) => any) {
  return isWrappable(item) ? keyFn(item) : item;
}

function keyedMatch(a: any, b: any, keyFn: (item: NonNullable<any>) => any) {
  return a === b || (isWrappable(a) && isWrappable(b) && keyFn(a) === keyFn(b));
}

// Array reconciliation updates the slots it visits, then swaps STORE_VALUE.
// Previously tracked keys that are absent from `next` still need invalidating,
// and `in` dependencies should follow the new value's membership. Use
// membership rather than length arithmetic so sparse arrays and named array
// props behave like normal property reads.
function syncArrayNodeMembership(target: any, next: any) {
  let nodes = target[STORE_NODE];
  if (nodes) {
    const keys = nodeKeys(nodes);
    for (let i = 0, len = keys.length; i < len; i++) {
      const key = keys[i];
      key in next || setSignal(nodes[key], undefined);
    }
  }
  if ((nodes = target[STORE_HAS])) {
    const keys = nodeKeys(nodes);
    for (let i = 0, len = keys.length; i < len; i++) {
      const key = keys[i];
      setSignal(nodes[key], key in next);
    }
  }
}

// Reconcile a single array slot: recurse into a wrappable pair, otherwise replace
// the node's value outright (covers object→primitive and primitive→object).
function applyArrayItem(
  next: any,
  previous: any,
  target: any,
  node: any,
  keyFn: (item: NonNullable<any>) => any
) {
  if (isWrappable(next) && isWrappable(previous)) {
    const wrapped = wrap(previous, target);
    node && setSignal(node, wrapped);
    applyState(next, wrapped, keyFn);
  } else node && setSignal(node, wrapValue(next, target));
}

// Dispatcher: every applyState call (including recursion) checks for the
// presence of override / optimistic-override slots once and routes to the
// appropriate body. The fast body never calls `getOverrideValue` and never
// branches on a `fastPath` boolean, so V8 sees a tighter, more inlinable
// shape for the overwhelmingly common case of plain stores.
function applyState(next: any, state: any, keyFn: (item: NonNullable<any>) => any) {
  // Array items and root calls can pass a store proxy as `next`; normalize to
  // its raw value or the swap would set a store's STORE_VALUE to its own proxy.
  next = unwrap(next);
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
    if (next.length && prevLength && isWrappable(next[0]) && keyFn(next[0]) != null) {
      let i, j, start, end, newEnd, item, newIndicesNext, keyVal;

      for (
        start = 0, end = Math.min(prevLength, next.length);
        start < end && keyedMatch((item = previous[start]), next[start], keyFn);
        start++
      ) {
        isWrappable(item) &&
          isWrappable(next[start]) &&
          applyState(next[start], wrap(item, target), keyFn);
      }

      const temp = new Array(next.length),
        newIndices = new Map();

      for (
        end = prevLength - 1, newEnd = next.length - 1;
        end >= start && newEnd >= start && keyedMatch((item = previous[end]), next[newEnd], keyFn);
        end--, newEnd--
      ) {
        temp[newEnd] = item;
      }

      if (start > newEnd || start > end) {
        for (j = start; j <= newEnd; j++) {
          changed = true;
          arrayNodes?.[j] && setSignal(arrayNodes[j], wrapValue(next[j], target));
        }

        for (; j < next.length; j++) {
          changed = true;
          applyArrayItem(next[j], temp[j], target, arrayNodes?.[j], keyFn);
        }

        syncArrayNodeMembership(target, next);
        (changed || prevLength !== next.length) && notifySelf(target);
        prevLength !== next.length &&
          arrayNodes?.length &&
          setSignal(arrayNodes.length, next.length);
        return;
      }

      newIndicesNext = new Array(newEnd + 1);

      for (j = newEnd; j >= start; j--) {
        item = next[j];
        keyVal = itemKey(item, keyFn);
        i = newIndices.get(keyVal);
        newIndicesNext[j] = i === undefined ? -1 : i;
        newIndices.set(keyVal, j);
      }

      for (i = start; i <= end; i++) {
        item = previous[i];
        keyVal = itemKey(item, keyFn);
        j = newIndices.get(keyVal);

        if (j !== undefined && j !== -1) {
          temp[j] = item;
          j = newIndicesNext[j];
          newIndices.set(keyVal, j);
        }
      }

      for (j = start; j < next.length; j++) {
        if (j in temp) {
          applyArrayItem(next[j], temp[j], target, arrayNodes?.[j], keyFn);
        } else arrayNodes?.[j] && setSignal(arrayNodes[j], wrapValue(next[j], target));
      }
      if (start < next.length) changed = true;
    } else if (next.length) {
      for (let i = 0, len = next.length; i < len; i++) {
        const item = previous[i];
        if (isWrappable(item) && isWrappable(next[i]))
          applyState(next[i], wrap(item, target), keyFn);
        else {
          if (item !== next[i]) changed = true;
          arrayNodes?.[i] && setSignal(arrayNodes[i], wrapValue(next[i], target));
        }
      }
    }

    syncArrayNodeMembership(target, next);
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
    const keys = tracked ? getAllKeys(previous, undefined, next) : nodeKeys(nodes);
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
        Array.isArray(previousValue) !== Array.isArray(nextValue) ||
        (keyFn(previousValue) != null && keyFn(previousValue) !== keyFn(nextValue))
      ) {
        tracked && setSignal(tracked, void 0);
        node && setSignal(node, isWrappable(nextValue) ? wrap(nextValue, target) : nextValue);
      } else applyState(nextValue, wrap(previousValue, target), keyFn);
    }
  }

  // has
  if ((nodes = target[STORE_HAS])) {
    const keys = nodeKeys(nodes);
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
    if (next.length && prevLength && isWrappable(next[0]) && keyFn(next[0]) != null) {
      let i, j, start, end, newEnd, item, newIndicesNext, keyVal;

      for (
        start = 0, end = Math.min(prevLength, next.length);
        start < end &&
        keyedMatch(
          (item = getOverrideValue(previous, override, start, optOverride)),
          next[start],
          keyFn
        );
        start++
      ) {
        isWrappable(item) &&
          isWrappable(next[start]) &&
          applyState(next[start], wrap(item, target), keyFn);
      }

      const temp = new Array(next.length),
        newIndices = new Map();

      for (
        end = prevLength - 1, newEnd = next.length - 1;
        end >= start &&
        newEnd >= start &&
        keyedMatch(
          (item = getOverrideValue(previous, override, end, optOverride)),
          next[newEnd],
          keyFn
        );
        end--, newEnd--
      ) {
        temp[newEnd] = item;
      }

      if (start > newEnd || start > end) {
        for (j = start; j <= newEnd; j++) {
          changed = true;
          nodes?.[j] && setSignal(nodes[j], wrapValue(next[j], target));
        }

        for (; j < next.length; j++) {
          changed = true;
          applyArrayItem(next[j], temp[j], target, nodes?.[j], keyFn);
        }

        const nextLength = next.length;
        syncArrayNodeMembership(target, next);
        (changed || prevLength !== nextLength) && notifySelf(target);
        prevLength !== nextLength && nodes?.length && setSignal(nodes.length, nextLength);
        return;
      }

      newIndicesNext = new Array(newEnd + 1);

      for (j = newEnd; j >= start; j--) {
        item = next[j];
        keyVal = itemKey(item, keyFn);
        i = newIndices.get(keyVal);
        newIndicesNext[j] = i === undefined ? -1 : i;
        newIndices.set(keyVal, j);
      }

      for (i = start; i <= end; i++) {
        item = getOverrideValue(previous, override, i, optOverride);
        keyVal = itemKey(item, keyFn);
        j = newIndices.get(keyVal);

        if (j !== undefined && j !== -1) {
          temp[j] = item;
          j = newIndicesNext[j];
          newIndices.set(keyVal, j);
        }
      }

      for (j = start; j < next.length; j++) {
        if (j in temp) {
          applyArrayItem(next[j], temp[j], target, nodes?.[j], keyFn);
        } else nodes?.[j] && setSignal(nodes[j], wrapValue(next[j], target));
      }
      if (start < next.length) changed = true;
    } else if (next.length) {
      for (let i = 0, len = next.length; i < len; i++) {
        const item = getOverrideValue(previous, override, i as any, optOverride);
        if (isWrappable(item) && isWrappable(next[i]))
          applyState(next[i], wrap(item, target), keyFn);
        else {
          if (item !== next[i]) changed = true;
          nodes?.[i] && setSignal(nodes[i], wrapValue(next[i], target));
        }
      }
    }

    const nextLength = next.length;

    syncArrayNodeMembership(target, next);
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
    const keys = tracked ? getAllKeys(previous, override, next) : nodeKeys(nodes);
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
        Array.isArray(previousValue) !== Array.isArray(nextValue) ||
        (keyFn(previousValue) != null && keyFn(previousValue) !== keyFn(nextValue))
      ) {
        tracked && setSignal(tracked, void 0);
        node && setSignal(node, isWrappable(nextValue) ? wrap(nextValue, target) : nextValue);
      } else applyState(nextValue, wrap(previousValue, target), keyFn);
    }
  }

  // has
  if ((nodes = target[STORE_HAS])) {
    const keys = nodeKeys(nodes);
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
    if (state == null) throw new Error(__DEV__ ? "Cannot reconcile null or undefined state" : "");
    const keyFn = typeof key === "string" ? item => item[key] : key;
    const eq = keyFn(state);
    if (eq !== undefined && keyFn(value) !== eq)
      throw new Error(__DEV__ ? "Cannot reconcile states with different identity" : "");
    applyState(value, state, keyFn);
  };
}
