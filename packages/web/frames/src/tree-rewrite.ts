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
 * The clone pass is copy-on-write too (#4846): it first marks, a strongly
 * connected component at a time, the containers a replacement is reachable
 * from, and copies only those. A subtree with nothing to replace keeps its
 * identity on the cyclic path as on the acyclic one, so a value the
 * serializer also writes in another record (an async memo's answer a store
 * holds) stays one reference, and a cycle with nothing to replace comes
 * back as itself.
 * Walks that replace nothing never pay the lookup. A value reachable at two
 * paths is one node: its replacement is shared (one seat for one iterable —
 * the identity the input had, which the serializer writes once and the
 * client materializes once), and a shared subtree with nothing to replace
 * is visited at each occurrence on the first pass and once on the clone
 * pass. `path` is built (`.key`, `[i]`) only when `withPath`.
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
  const memo = state.memo || (state.memo = new Map());
  const marks: Marks = { at: new Map(), stack: [], changed: new Set(), next: 0 };
  mark(value, visit, path, memo, marks);
  return clone(value, memo, marks.changed);
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

type Marks = {
  /** A container's DFS index, then `Infinity` once its component is closed. */
  at: Map<any, number>;
  stack: any[];
  /** The containers a replacement is reachable from: the ones copied. */
  changed: Set<any>;
  next: number;
};

/**
 * The visit pass of the clone (Tarjan's components): each node is visited
 * once (the first pass's replacements answer from `memo`), a replacement is
 * recorded in `memo`, and a component is marked changed when one of its
 * containers holds a replacement or a changed child outside it. Returns the
 * lowest index reachable, or -1 for a node that is not a container walked.
 */
function mark(
  value: any,
  visit: Visit,
  path: string | undefined,
  memo: Map<any, any>,
  m: Marks
): number {
  const seen = m.at.get(value);
  if (seen !== undefined) return seen;
  if (memo.has(value)) return -1;
  const r = visit(value, path);
  if (r !== DESCEND) {
    memo.set(value, r);
    return -1;
  }
  const s = shape(value);
  if (s === 0) return -1;
  const index = m.next++;
  let low = index;
  let changed = false;
  // Registered on the first container child: a container whose children are
  // all leaves closes alone and unchanged, so it costs no bookkeeping.
  let open = false;
  const keys: any[] = s === 1 ? value : Object.keys(value);
  for (let i = 0; i < keys.length; i++) {
    const k = s === 1 ? i : keys[i];
    const c = value[k];
    if (c === null || typeof c !== "object") continue;
    if (!open) {
      open = true;
      m.at.set(value, index);
      m.stack.push(value);
    }
    const l = mark(
      c,
      visit,
      path === undefined ? undefined : s === 1 ? `${path}[${k}]` : `${path}.${k}`,
      memo,
      m
    );
    if (l >= 0 && l < low) low = l;
    if ((memo.has(c) && memo.get(c) !== c) || (l === Infinity && m.changed.has(c))) changed = true;
  }
  if (!open) return -1;
  if (low === index) {
    m.at.set(value, Infinity);
    if (m.stack[m.stack.length - 1] === value) {
      // A component of one: no member but itself.
      m.stack.pop();
      if (changed) m.changed.add(value);
      return Infinity;
    }
    // The component's root: its members are the stack above it.
    const members = m.stack.splice(m.stack.lastIndexOf(value));
    // A member's edge inside the component reads `low`, not a changed mark;
    // an edge out of it (closed, `Infinity`) was judged above.
    if (!changed)
      for (const n of members)
        if (m.changed.has(n)) {
          changed = true;
          break;
        }
    for (const n of members) {
      m.at.set(n, Infinity);
      if (changed) m.changed.add(n);
    }
    return Infinity;
  }
  if (changed) m.changed.add(value);
  return low;
}

// `value` is an object (the callers test). Copies only what `mark` marked.
function clone(value: any, memo: Map<any, any>, changed: Set<any>): any {
  if (memo.has(value)) return memo.get(value);
  if (!changed.has(value)) return value;
  const out = Array.isArray(value) ? value.slice() : { ...value };
  memo.set(value, out);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const c = value[i];
      if (c !== null && typeof c === "object") out[i] = clone(c, memo, changed);
    }
  } else {
    for (const k of Object.keys(value)) {
      const c = value[k];
      if (c !== null && typeof c === "object") out[k] = clone(c, memo, changed);
    }
  }
  return out;
}
