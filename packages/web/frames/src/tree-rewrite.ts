/**
 * Copy-on-write rewrite of a value tree, for the serialization-border walks
 * (`toBorderForm` — every document-face serialization and every slot-arg
 * record — and the slot-arg stand-in scrub). `visit(value, path)` is asked
 * at every OBJECT node first (primitives pass through unasked: no visitor
 * replaces one, and leaves are most of a payload) and answers with the
 * node's replacement, or `DESCEND` to walk the node's leaves — which
 * happens for a plain array or plain object only; anything else (a class
 * instance, a `Map`, a proxy) is the app's and passes through untouched.
 *
 * Author values are never mutated. The walk is plain recursion, copy-on-
 * write: an untouched subtree passes by reference, a changed one is copied
 * along the path to the root. That is the whole cost for acyclic data of
 * ordinary depth (measured below what `next`'s direct recursion paid, the
 * primitive short-circuit buying more than the visitor call costs).
 *
 * A back-reference to an ancestor has no copy-on-write answer (the copy's
 * back-reference would point at the original, unrewritten), and tracking
 * ancestors at every node would tax every walk. So ancestors are tracked
 * only from a depth ordinary payloads never reach (`TRACK`): a cycle is
 * caught within one cycle-length past it, the pass aborts and the tree is
 * rewritten again as a memoized clone — one copy per container, a back-
 * reference resolving to the ancestor's copy. Only cyclic (or unusually
 * deep) values pay. Replacements are recorded as they are produced (a trace
 * envelope, a multicast seat, a scrubbed stand-in): a node seen again on
 * the first pass — a cycle revisits its nodes on every level down to the
 * catch — and every node of the clone pass answer from the record, so a
 * visitor's side effects run once per node whichever way the walk went.
 * Walks that replace nothing never pay the lookup. A shared subtree is
 * visited at each of its occurrences on the first pass and once on the
 * clone pass (its copy is shared the same way). `path` is built (`.key`,
 * `[i]`) only when `withPath`.
 */
export const DESCEND: unique symbol = Symbol("descend");

const CYCLE = {};

/** The depth from which the first pass tracks its ancestors. */
const TRACK = 16;

type Visit = (value: object, path: string | undefined) => any;

type State = { memo: Map<any, any> | undefined; ancestors: Set<any> | undefined };

export function rewriteTree(value: any, visit: Visit, withPath: boolean): any {
  if (value === null || typeof value !== "object") return value;
  const path = withPath ? "" : undefined;
  const state: State = { memo: undefined, ancestors: undefined };
  try {
    return cow(value, visit, path, 0, state);
  } catch (err) {
    if (err !== CYCLE) throw err;
  }
  return clone(value, visit, path, state.memo || (state.memo = new Map()));
}

function shape(value: any): 1 | 2 | 0 {
  return Array.isArray(value) ? 1 : Object.getPrototypeOf(value) === Object.prototype ? 2 : 0;
}

// `value` is an object (the callers test).
function cow(value: any, visit: Visit, path: string | undefined, depth: number, state: State) {
  const memo = state.memo;
  if (memo !== undefined && memo.has(value)) return memo.get(value);
  const r = visit(value, path);
  if (r !== DESCEND) {
    if (r !== value) (memo || (state.memo = new Map())).set(value, r);
    return r;
  }
  const s = shape(value);
  if (s === 0) return value;
  // Deep enough to suspect a cycle: this container joins the ancestors for
  // the walk of its leaves. No try/finally — an abort discards the set, a
  // visitor's error propagates past it.
  let ancestors;
  if (depth >= TRACK) {
    ancestors = state.ancestors || (state.ancestors = new Set());
    if (ancestors.has(value)) throw CYCLE;
    ancestors.add(value);
  }
  let out = value;
  if (s === 1) {
    for (let i = 0; i < value.length; i++) {
      const c = value[i];
      if (c === null || typeof c !== "object") continue;
      const next = cow(
        c,
        visit,
        path === undefined ? undefined : `${path}[${i}]`,
        depth + 1,
        state
      );
      if (next !== c) {
        if (out === value) out = value.slice();
        out[i] = next;
      }
    }
  } else {
    for (const k of Object.keys(value)) {
      const c = value[k];
      if (c === null || typeof c !== "object") continue;
      const next = cow(c, visit, path === undefined ? undefined : `${path}.${k}`, depth + 1, state);
      if (next !== c) {
        if (out === value) out = { ...value };
        out[k] = next;
      }
    }
  }
  if (ancestors !== undefined) ancestors.delete(value);
  return out;
}

// `value` is an object (the callers test).
function clone(value: any, visit: Visit, path: string | undefined, memo: Map<any, any>) {
  if (memo.has(value)) return memo.get(value);
  const r = visit(value, path);
  if (r !== DESCEND) {
    memo.set(value, r);
    return r;
  }
  const s = shape(value);
  if (s === 0) return value;
  const out = s === 1 ? value.slice() : { ...value };
  memo.set(value, out);
  if (s === 1) {
    for (let i = 0; i < value.length; i++) {
      const c = value[i];
      if (c !== null && typeof c === "object")
        out[i] = clone(c, visit, path === undefined ? undefined : `${path}[${i}]`, memo);
    }
  } else {
    for (const k of Object.keys(value)) {
      const c = value[k];
      if (c !== null && typeof c === "object")
        out[k] = clone(c, visit, path === undefined ? undefined : `${path}.${k}`, memo);
    }
  }
  return out;
}
