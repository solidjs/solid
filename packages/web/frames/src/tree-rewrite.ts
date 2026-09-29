/**
 * Copy-on-write rewrite of a value tree, for the serialization-border walks
 * (`toBorderForm`, the slot-arg stand-in scrub). `visit(value, path)` is
 * asked at every node first and answers with the node's replacement, or
 * `DESCEND` to walk the node's leaves — which happens for a plain array or
 * plain object only; anything else (a class instance, a `Map`, a proxy) is
 * the app's and passes through untouched.
 *
 * Author values are never mutated. Acyclic trees — the case — are walked
 * copy-on-write: an untouched subtree passes by reference, a changed one
 * is copied along the path to the root. A back-reference to an ancestor
 * has no copy-on-write answer (the copy's back-reference would point at
 * the original, unrewritten), so the first one seen aborts that pass and
 * the tree is rewritten again as a memoized clone: one copy per container,
 * a back-reference resolving to the ancestor's copy. Only cyclic values
 * pay. A shared subtree is visited at each of its occurrences on the
 * copy-on-write pass and once on the clone pass (its copy is shared the
 * same way). `path` is built (`.key`, `[i]`) only when `withPath`.
 */
export const DESCEND: unique symbol = Symbol("descend");

const CYCLE = {};

type Visit = (value: any, path: string | undefined) => any;

export function rewriteTree(value: any, visit: Visit, withPath: boolean): any {
  const path = withPath ? "" : undefined;
  try {
    return cow(value, visit, path, undefined);
  } catch (err) {
    if (err !== CYCLE) throw err;
  }
  return clone(value, visit, path, new Map());
}

function shape(value: any): 1 | 2 | 0 {
  return Array.isArray(value) ? 1 : Object.getPrototypeOf(value) === Object.prototype ? 2 : 0;
}

function childPath(path: string | undefined, key: string | number, index: boolean) {
  return path === undefined ? undefined : index ? `${path}[${key}]` : `${path}.${key}`;
}

function cow(value: any, visit: Visit, path: string | undefined, ancestors: Set<any> | undefined) {
  const r = visit(value, path);
  if (r !== DESCEND) return r;
  const s = shape(value);
  if (s === 0) return value;
  if (ancestors === undefined) ancestors = new Set();
  else if (ancestors.has(value)) throw CYCLE;
  ancestors.add(value);
  let out = value;
  try {
    if (s === 1) {
      for (let i = 0; i < value.length; i++) {
        const next = cow(value[i], visit, childPath(path, i, true), ancestors);
        if (next !== value[i]) {
          if (out === value) out = value.slice();
          out[i] = next;
        }
      }
    } else {
      for (const k of Object.keys(value)) {
        const next = cow(value[k], visit, childPath(path, k, false), ancestors);
        if (next !== value[k]) {
          if (out === value) out = { ...value };
          out[k] = next;
        }
      }
    }
  } finally {
    ancestors.delete(value);
  }
  return out;
}

function clone(value: any, visit: Visit, path: string | undefined, memo: Map<any, any>) {
  const seen = memo.get(value);
  if (seen !== undefined) return seen;
  const r = visit(value, path);
  if (r !== DESCEND) return r;
  const s = shape(value);
  if (s === 0) return value;
  const out = s === 1 ? value.slice() : { ...value };
  memo.set(value, out);
  if (s === 1) {
    for (let i = 0; i < value.length; i++)
      out[i] = clone(value[i], visit, childPath(path, i, true), memo);
  } else {
    for (const k of Object.keys(value))
      out[k] = clone(value[k], visit, childPath(path, k, false), memo);
  }
  return out;
}
