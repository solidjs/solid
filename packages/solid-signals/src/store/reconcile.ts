import { setSignal, untrack } from "../core/index.js";
import {
  $DELETED,
  $PROXY,
  $TARGET,
  $TRACK,
  getKeys,
  getStoreSymbols,
  isWrappable,
  STORE_DESC,
  STORE_HAS,
  STORE_LOOKUP,
  STORE_NODE,
  STORE_OPTIMISTIC_OVERRIDE,
  STORE_OVERRIDE,
  STORE_SHALLOW,
  STORE_VALUE,
  STORE_WRAP,
  notifySelf,
  storeLookup,
  lookupTarget,
  markRawIngest,
  isRawValue,
  rawValuesUsed,
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
  // Symbols are merged explicitly below; keep the common string-key path on
  // Object.keys() and avoid reflecting the base symbols twice.
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
// Inline key iteration on purpose: these loops run per array target per
// reconcile pass, and a shared helper means a closure + per-key call in
// instruction counts. String-only records (the common case) iterate in
// place; symbol-bearing records take the nodeKeys array path.
function syncArrayNodeMembership(target: any, next: any) {
  let nodes = target[STORE_NODE];
  if (nodes) {
    if (symbolKeyedRecords.has(nodes)) {
      const keys = nodeKeys(nodes);
      for (let i = 0, len = keys.length; i < len; i++) {
        keys[i] in next || setSignal(nodes[keys[i]], undefined);
      }
    } else {
      for (const key in nodes) {
        key in next || setSignal(nodes[key], undefined);
      }
    }
  }
  if ((nodes = target[STORE_HAS])) {
    if (symbolKeyedRecords.has(nodes)) {
      const keys = nodeKeys(nodes);
      for (let i = 0, len = keys.length; i < len; i++) {
        setSignal(nodes[keys[i]], keys[i] in next);
      }
    } else {
      for (const key in nodes) {
        setSignal(nodes[key], key in next);
      }
    }
  }
}

// Recurse into a matched wrappable child pair without manufacturing a proxy:
// resolve the child's target through the lookup and dispatch directly. A
// lookup miss means the child was never observed — no proxy, no nodes, no
// subscribers anywhere below — so the parent's swap making `next`
// authoritative IS the whole update; a later read wraps next's child on
// demand. This turns the diff from O(previous graph) into O(observed graph)
// and drops the wrap()/$PROXY/$TARGET round-trip per visited child.
// Wrap-family stores (projections/optimistic) own child proxy creation and
// keep the proxy-based recursion.
function applyStateChild(
  next: any,
  prevRaw: any,
  target: any,
  keyFn: (item: NonNullable<any>) => any
) {
  if (target[STORE_WRAP] !== undefined) {
    applyState(next, wrap(prevRaw, target), keyFn);
    return;
  }
  const childTarget = prevRaw[$TARGET] ?? storeLookup.get(prevRaw);
  if (childTarget === undefined) return;
  next = unwrap(next);
  if (childTarget[STORE_SHALLOW]) {
    applyStateShallow(next, childTarget, keyFn);
  } else if (childTarget[STORE_OVERRIDE] || childTarget[STORE_OPTIMISTIC_OVERRIDE]) {
    applyStateSlow(next, childTarget, keyFn);
  } else {
    applyStateFast(next, childTarget, keyFn);
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
  if (
    isWrappable(next) &&
    isWrappable(previous) &&
    !(rawValuesUsed && (isRawValue(previous) || isRawValue(next)))
  ) {
    const wrapped = wrap(previous, target);
    node && setSignal(node, wrapped);
    applyState(next, wrapped, keyFn);
  } else node && setSignal(node, wrapValue(next, target));
}

/**
 * The captured-proxy half of the object diff (#2902): descend into keyed-
 * matching children that have NO node at this level but shelter subscribers
 * somewhere below (their target's sticky `STORE_DESC` flag, bubbled up by
 * `getNode`). Without this, a proxy captured through untracked reads — a
 * `<For>` row handed to a child component — detaches from the diff the
 * moment no intermediate level happens to be tracked, and its live
 * subscribers go permanently stale. Never-subscribed branches have no flag
 * and stay pruned exactly as before; keys the main loop already visited
 * (node present) are skipped. Callers gate on the parent's own flag and on
 * `$TRACK` absence (an enumeration-tracked record already diffs every key).
 */
function applyDescendants(
  previous: any,
  next: any,
  target: any,
  nodes: any,
  keyFn: (item: NonNullable<any>) => any,
  override?: any,
  optOverride?: any
) {
  const lookup = target[STORE_LOOKUP] || storeLookup;
  if (override) {
    const keys = getKeys(previous, override).concat(getStoreSymbols(previous, override));
    for (let i = 0, len = keys.length; i < len; i++) {
      const key = keys[i];
      if (nodes?.[key]) continue; // main loop already diffed this slot
      const previousValue = unwrap(getOverrideValue(previous, override, key, optOverride));
      if (!isWrappable(previousValue)) continue;
      descendInto(previousValue, next[key], lookup, keyFn);
    }
    return;
  }
  // No-override path (every applyStateFast call): iterate in place instead of
  // building keys + symbols + concat arrays per object per pass. The cheap
  // bails (noded key, primitive value) stay inline — only genuine descent
  // candidates pay a call.
  for (const key in previous) {
    if (nodes?.[key]) continue; // main loop already diffed this slot
    const previousValue = unwrap(previous[key]);
    if (!isWrappable(previousValue)) continue;
    descendInto(previousValue, next[key], lookup, keyFn);
  }
  const syms = Object.getOwnPropertySymbols(previous);
  for (let i = 0, len = syms.length; i < len; i++) {
    if (Object.prototype.propertyIsEnumerable.call(previous, syms[i])) {
      if (nodes?.[syms[i]]) continue;
      const previousValue = unwrap(previous[syms[i]]);
      if (!isWrappable(previousValue)) continue;
      descendInto(previousValue, next[syms[i]], lookup, keyFn);
    }
  }
}

function descendInto(
  previousValue: any,
  rawNext: any,
  lookup: any,
  keyFn: (item: NonNullable<any>) => any
) {
  const childTarget = lookupTarget(previousValue, lookup);
  if (!childTarget?.[STORE_DESC]) return;
  const nextValue = unwrap(rawNext);
  if (
    previousValue === nextValue ||
    !isWrappable(nextValue) ||
    Array.isArray(previousValue) !== Array.isArray(nextValue) ||
    (keyFn(previousValue) != null && keyFn(previousValue) !== keyFn(nextValue))
  )
    return;
  if (childTarget[STORE_SHALLOW]) {
    applyStateShallow(nextValue, childTarget, keyFn);
  } else if (childTarget[STORE_OVERRIDE] || childTarget[STORE_OPTIMISTIC_OVERRIDE]) {
    applyStateSlow(nextValue, childTarget, keyFn);
  } else {
    applyStateFast(nextValue, childTarget, keyFn);
  }
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
  if (target[STORE_SHALLOW]) {
    applyStateShallow(next, target, keyFn);
  } else if (target[STORE_OVERRIDE] || target[STORE_OPTIMISTIC_OVERRIDE]) {
    applyStateSlow(next, target, keyFn);
  } else {
    applyStateFast(next, target, keyFn);
  }
}

// Shallow boundary diff: the target's own keys are reactive, its values are
// raw records replaced by reference — no recursion, no wrapping. Arrays merge
// positionally (below a shallow boundary the VALUE is the identity; keyed
// row identity belongs to the consumer, e.g. <For keyed>). Incoming
// wrappables are sticky-marked raw so they present raw through every store.
// One pass over a shallow target's node record: replace changed slots with
// raw next values, null out slots absent from next. Returns whether anything
// differed.
function shallowDiffNodes(
  nodes: any,
  next: any,
  prevAt: (key: PropertyKey) => any,
  skipLength: boolean
): boolean {
  let changed = false;
  for (const key in nodes) {
    if (skipLength && key === "length") continue;
    if (key in next) {
      const v = next[key];
      if (v !== prevAt(key)) {
        changed = true;
        setSignal(nodes[key], v);
      }
    } else {
      changed = true;
      setSignal(nodes[key], undefined);
    }
  }
  return changed;
}

function applyStateShallow(next: any, target: any, keyFn: (item: NonNullable<any>) => any) {
  const previous = target[STORE_VALUE];
  const override = target[STORE_OVERRIDE];
  const optOverride = target[STORE_OPTIMISTIC_OVERRIDE];
  if (next === previous && !override && !optOverride) return;
  // Setter-staged writes fold into the diff: previous values resolve through
  // the override layers (so a replaced slot compares against what readers
  // saw), and the regular override clears with the swap — reconcile makes
  // `next` the authoritative base, same as the deep slow path.
  const prevAt = (key: PropertyKey) => {
    const v = getOverrideValue(previous, override, key, optOverride);
    return v === $DELETED ? undefined : v;
  };
  target[STORE_OVERRIDE] = undefined;
  const fam = target[STORE_LOOKUP];
  fam !== undefined ? fam.set(next, target[$PROXY]) : storeLookup.set(next, target);
  target[STORE_VALUE] = next;
  markRawIngest(next);

  const nodes = target[STORE_NODE];
  const tracked = nodes && nodes[$TRACK];
  let changed = false;
  if (Array.isArray(previous)) {
    const prevLength = override?.length ?? optOverride?.length ?? previous.length;
    if (nodes) {
      changed = shallowDiffNodes(nodes, next, prevAt, true);
      if (nodes.length && prevLength !== next.length) setSignal(nodes.length, next.length);
    }
    if (!changed && (tracked || target[STORE_HAS])) {
      // Slots without nodes still feed $TRACK enumerators / `in` probes.
      if (prevLength !== next.length) changed = true;
      else {
        for (let i = 0, len = next.length; i < len; i++) {
          if (prevAt(i) !== next[i]) {
            changed = true;
            break;
          }
        }
      }
    }
  } else {
    if (nodes) {
      changed = shallowDiffNodes(nodes, next, prevAt, false);
    }
    if (!changed && (tracked || target[STORE_HAS])) changed = true;
  }
  let has = target[STORE_HAS];
  if (has) {
    for (const key in has) {
      setSignal(has[key], key in next);
    }
  }
  changed && notifySelf(target);
}

function applyStateFast(next: any, target: any, keyFn: (item: NonNullable<any>) => any) {
  const previous = target[STORE_VALUE];
  if (next === previous) return;
  const arrayNodes = target[STORE_NODE];

  // swap
  {
    const fam = target[STORE_LOOKUP];
    fam !== undefined ? fam.set(next, target[$PROXY]) : storeLookup.set(next, target);
  }
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
        // keyedMatch established both sides wrappable unless they're the
        // SAME reference — and an identical slot is a guaranteed no-op
        // (the child's STORE_VALUE tracks the previous graph), so skip
        // the recursion dispatch entirely. Raw-marked values are leaves:
        // replace the slot node instead of recursing.
        if (item !== next[start]) {
          if (rawValuesUsed && (isRawValue(item) || isRawValue(next[start]))) {
            arrayNodes?.[start] && setSignal(arrayNodes[start], wrapValue(next[start], target));
          } else applyStateChild(next[start], item, target, keyFn);
        }
      }

      // Every position key-matched at equal length (the steady-state shape
      // of a polling tick): membership, length, and order are unchanged —
      // nothing below could do observable work, so skip the staging
      // allocations and membership sync outright.
      if (start === next.length && start === prevLength) return;

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
        if (
          isWrappable(item) &&
          isWrappable(next[i]) &&
          !(rawValuesUsed && (isRawValue(item) || isRawValue(next[i])))
        ) {
          if (item !== next[i]) applyStateChild(next[i], item, target, keyFn);
        } else {
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
  let tracked;
  if (nodes) {
    tracked = nodes[$TRACK];
    // The per-key body is duplicated across both loops on purpose: this is
    // the hottest object-diff site and a shared helper costs a per-key call
    // in instruction counts (CodSpeed regressed ~7% on deep-tree reconciles
    // with the extracted form).
    if (tracked || symbolKeyedRecords.has(nodes)) {
      const keys = tracked ? getAllKeys(previous, undefined, next) : nodeKeys(nodes);
      for (let i = 0, len = keys.length; i < len; i++) {
        const key = keys[i];
        const node = nodes[key];
        const previousValue = unwrap(previous[key]);
        const nextValue = unwrap(next[key]);
        if (previousValue === nextValue) continue;
        if (
          !previousValue ||
          !isWrappable(previousValue) ||
          !isWrappable(nextValue) ||
          // Raw-marked values are leaves replaced by reference — a "wrappable
          // pair" is only recursable when both sides are actual store children.
          (rawValuesUsed && (isRawValue(previousValue) || isRawValue(nextValue))) ||
          Array.isArray(previousValue) !== Array.isArray(nextValue) ||
          (keyFn(previousValue) != null && keyFn(previousValue) !== keyFn(nextValue))
        ) {
          tracked && setSignal(tracked, void 0);
          node && setSignal(node, isWrappable(nextValue) ? wrap(nextValue, target) : nextValue);
        } else applyStateChild(nextValue, previousValue, target, keyFn);
      }
    } else {
      // Untracked, string-only node records (the overwhelmingly common case)
      // iterate in place — nodeKeys() allocated a fresh key array per object
      // per pass, which dominates allocation on large-graph reconciles.
      for (const key in nodes) {
        const node = nodes[key];
        const previousValue = unwrap(previous[key]);
        const nextValue = unwrap(next[key]);
        if (previousValue === nextValue) continue;
        if (
          !previousValue ||
          !isWrappable(previousValue) ||
          !isWrappable(nextValue) ||
          // Raw-marked values are leaves replaced by reference — a "wrappable
          // pair" is only recursable when both sides are actual store children.
          (rawValuesUsed && (isRawValue(previousValue) || isRawValue(nextValue))) ||
          Array.isArray(previousValue) !== Array.isArray(nextValue) ||
          (keyFn(previousValue) != null && keyFn(previousValue) !== keyFn(nextValue))
        ) {
          tracked && setSignal(tracked, void 0);
          node && setSignal(node, isWrappable(nextValue) ? wrap(nextValue, target) : nextValue);
        } else applyStateChild(nextValue, previousValue, target, keyFn);
      }
    }
  }
  if (!tracked && target[STORE_DESC]) applyDescendants(previous, next, target, nodes, keyFn);

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
  {
    const fam = target[STORE_LOOKUP];
    fam !== undefined ? fam.set(next, target[$PROXY]) : storeLookup.set(next, target);
  }
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
        if (isWrappable(item) && isWrappable(next[start]) && item !== next[start]) {
          if (rawValuesUsed && (isRawValue(item) || isRawValue(next[start]))) {
            nodes?.[start] && setSignal(nodes[start], wrapValue(next[start], target));
          } else applyState(next[start], wrap(item, target), keyFn);
        }
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
        if (
          isWrappable(item) &&
          isWrappable(next[i]) &&
          !(rawValuesUsed && (isRawValue(item) || isRawValue(next[i])))
        ) {
          if (item !== next[i]) applyState(next[i], wrap(item, target), keyFn);
        } else {
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
  let tracked;
  if (nodes) {
    tracked = nodes[$TRACK];
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
        (rawValuesUsed && (isRawValue(previousValue) || isRawValue(nextValue))) ||
        Array.isArray(previousValue) !== Array.isArray(nextValue) ||
        (keyFn(previousValue) != null && keyFn(previousValue) !== keyFn(nextValue))
      ) {
        tracked && setSignal(tracked, void 0);
        node && setSignal(node, isWrappable(nextValue) ? wrap(nextValue, target) : nextValue);
      } else applyState(nextValue, wrap(previousValue, target), keyFn);
    }
  }
  if (!tracked && target[STORE_DESC])
    applyDescendants(previous, next, target, nodes, keyFn, override, optOverride);

  // has
  if ((nodes = target[STORE_HAS])) {
    const keys = nodeKeys(nodes);
    for (let i = 0, len = keys.length; i < len; i++) {
      const key = keys[i];
      setSignal(nodes[key], key in next);
    }
  }
}

// No-key reconcile: every item reports "no key", which routes array diffs to
// the positional branch and object descent to plain per-property merging.
const NOKEY = () => null;

/**
 * Returns a draft-mutating function that smart-merges `value` into a store,
 * preserving fine-grained reactivity: only changed leaves trigger updates.
 *
 * With a `key` (default `"id"`), array items whose key matches between old
 * and new states keep their identity (updated in place, moves and removals
 * update the corresponding signals) — the shape for keyed server payloads.
 * Items without the key field fall back to positional matching.
 *
 * With `key: null`, matching is purely positional: index N of the new array
 * merges into index N of the old, and object properties merge recursively —
 * the classic pattern for fixed-shape data that churns in place (dashboards,
 * monitors), where no keyed diff pass is needed or wanted.
 *
 * @param value the next state to merge in
 * @param key property name (string) or extractor function for stable
 * identity (default `"id"`); pass `null` for positional merging
 *
 * @example
 * ```ts
 * const [todos, setTodos] = createStore<Todo[]>([]);
 *
 * async function refresh() {
 *   const fresh = await api.getTodos();
 *   setTodos(reconcile(fresh)); // diff-merge by `id`
 * }
 *
 * // fixed-shape polling data — positional merge
 * setStats(reconcile(nextStats, null));
 * ```
 */
export function reconcile<T extends U, U>(
  value: T,
  key: string | ((item: NonNullable<any>) => any) | null = "id"
) {
  return (state: U) => {
    if (state == null) throw new Error(__DEV__ ? "Cannot reconcile null or undefined state" : "");
    if (key === null) {
      applyState(value, state, NOKEY);
      return;
    }
    const keyFn = typeof key === "string" ? item => item[key] : key;
    const eq = keyFn(state);
    if (eq !== undefined && keyFn(value) !== eq)
      throw new Error(__DEV__ ? "Cannot reconcile states with different identity" : "");
    applyState(value, state, keyFn);
  };
}
