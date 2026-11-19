/**
 * An optimistic family's lists. A list's rows in order (its arrangement)
 * are one core node, `k`: a setter's structural writes are one guess on it,
 * and the derive's landing is one truth beneath (D-33, D-34). A row keeps
 * its own field nodes. Installed by thinOptimistic.ts, so a bundle without
 * optimistic stores carries none of this.
 */
import { CONFIG_GUESS, CONFIG_HELD, NOT_PENDING } from "../core/constants.js";
import { forEachDependent } from "../core/async.js";
import { context, read, untrack } from "../core/core.js";
import { attrHooks } from "../core/attribution-hooks.js";
import { link } from "../core/graph.js";
import { signalHook } from "../core/identities.js";
import { resolveTx, txOf } from "../core/scheduler.js";
import type { Signal } from "../core/types.js";
import {
  $THIN,
  ABSENT_THIN as ABSENT,
  CHAINED,
  DELEGATE,
  carries,
  frameRead,
  inDraft,
  isThin,
  keyNode,
  noteParent,
  placed,
  stageRow,
  subChain,
  thinChild as child,
  thinEcho as echo,
  thinGuess as guess,
  thinGuessed as guessed,
  thinInner as inner,
  thinKeyOf as keyOf,
  thinNodeOf as nodeOf,
  thinPeek as peek,
  thinPut as put,
  thinReplace as replace,
  thinUnder as under,
  thinUserWrite as userWrite,
  thinWrap as wrap,
  thinWriting as writing,
  unwrapThin,
  type ThinList,
  type ThinTarget as Target
} from "./thin.js";
import { isWrappable } from "./types.js";

const isObj = (v: any): boolean => v !== null && typeof v === "object";
/** A list key's index: -1 for `length`, -2 for any other key. */
const ix = (key: PropertyKey): number =>
  typeof key === "number"
    ? key
    : key === "length"
      ? -1
      : typeof key === "string" && "" + (+key >>> 0) === key
        ? +key
        : -2;
const protoOf = Object.getPrototypeOf;

function same(t: Target, a: any[], b: any[]): boolean {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a === CHAINED) a = untrack(() => allRows(t, a));
  if (b === CHAINED) b = untrack(() => allRows(t, b));
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}
/** Row `i` of `r` (its length for -1), read through the chain for CHAINED. */
function rowAt(t: Target, r: any[], i: number): any {
  if (r === CHAINED && t.c !== null) {
    if (i < 0) return inner(t, () => t.c.length);
    const iv = inner(t, () => (i in t.c ? t.c[i] : ABSENT));
    return isThin(iv) && iv[$THIN]._fam !== t._fam ? unwrapThin(subChain(t, i, iv)) : iv;
  }
  if (i < 0) return r.length;
  const v = r[i];
  return v === undefined && !(i in r) ? ABSENT : v;
}
function allRows(t: Target, r: any[]): any[] {
  if (r !== CHAINED) return r;
  const out: any[] = [];
  for (let i = 0, n = rowAt(t, r, -1); i < n; i++) out[i] = rowAt(t, r, i);
  return out;
}
/** The rows in the reader's frame: the open setter's copy, else the node's
 * (the raw's while nothing wrote it). */
function rowsOf(t: Target): any[] {
  if (t.da !== null && inDraft(t)) return t.da;
  if (t.k === null) return t.c !== null ? CHAINED : t.v;
  const r = peek(t.k, t);
  return Array.isArray(r) ? r : [];
}
/** A user setter's read of a guessed list. A row the guess moved or made is
 * navigation (`placed`: what the setter reads of the row decides); a length
 * or a plain value the guess changed is a read of the guess (D-33). */
function navigated(t: Target, i: number, v: any): void {
  const k = t.k;
  if (!userWrite || context !== null || k === null || !(k._config & CONFIG_GUESS)) return;
  const u = rowAt(t, under!(k), i);
  if (Object.is(v, u)) return;
  if (i >= 0 && isWrappable(v)) placed.set(v, [k, u]);
  else read(k);
}
/** An index a plain value was guessed at, over the row beneath. */
function cellOf(t: Target, r: any[], i: number): Signal<any> | undefined {
  return i >= 0 && t.n !== null && i < rowAt(t, r, -1) ? t.n[i] : undefined;
}
function value(t: Target, i: number, mode: number): any {
  const r = rowsOf(t);
  if (r !== t.da) {
    const c = cellOf(t, r, i);
    if (c !== undefined) {
      const v = peek(c, t, mode || 1);
      if (v !== DELEGATE) return v;
    }
  }
  const v = rowAt(t, r, i);
  if (r !== t.da && inDraft(t)) navigated(t, i, v);
  return v;
}
function get(t: Target, i: number, tracked: boolean): any {
  const k = t.k;
  if (k !== null && (k._config & (CONFIG_HELD | CONFIG_GUESS)) === CONFIG_HELD) pairLate(t, k);
  if (!tracked) {
    const v = value(t, i, 1);
    return v === ABSENT ? undefined : shown(t, i, v);
  }
  const r = frameRead(t, keyNode(t), true);
  const c = cellOf(t, r, i);
  if (c !== undefined) {
    const g = frameRead(t, c, true);
    if (g !== DELEGATE) return g;
  }
  const v = rowAt(t, r, i);
  return v === ABSENT ? undefined : shown(t, i, v);
}
function shown(t: Target, i: number, v: any): any {
  if (!isObj(v)) return v;
  const p = child(t, v);
  if ((__OBSERVE__ && attrHooks !== null) || signalHook !== null) noteParent(p, t, i);
  return p;
}
function has(t: Target, i: number, tracked: boolean): boolean {
  return i < 0 || rowAt(t, tracked ? read(keyNode(t)) : rowsOf(t), i) !== ABSENT;
}

/** A user's guess on a list (thinOptimistic.ts keeps its edit, D-34). */
let listGuess:
  | ((t: Target, view: any[], rows: any[], committed: any[], carried: boolean) => void)
  | null = null;
export const onListGuess = (fn: typeof listGuess): void => void (listGuess = fn);

/** The open setters' list copies, written when each closes. */
const drafts: Target[] = [];
function write(t: Target, i: number, v: any): void {
  const cur = rowsOf(t);
  const k = t.k;
  // The truth lands beneath a guess even when it says the same (D-34).
  const lands = !userWrite && cur !== t.da && carries(k);
  if (i < 0) {
    if (rowAt(t, cur, -1) === v && !lands) return;
  } else {
    if (echo !== null && userWrite && isWrappable(v)) {
      const u = rowAt(t, k === null ? cur : k._config & CONFIG_GUESS ? under!(k) : k._value, i);
      if (u !== v && isWrappable(u) && echo(u, v)) v = u;
    }
    const p = rowAt(t, cur, i);
    if (userWrite && guess !== null && i < rowAt(t, cur, -1)) {
      // A row rewritten under its own key is its fields' guesses, and a
      // value that is no row is its index's: neither moves the list (D-33).
      const kf = t._fam!.key;
      const pk = kf && isWrappable(p) ? keyOf(t._fam!.map as any, kf, p) : undefined;
      if (pk !== undefined && p !== v && isWrappable(v) && !isThin(v) && kf!(v) === pk)
        return replace(wrap(p, t._fam, t)[$THIN], v);
      if (t.da === null && !isObj(p) && !isObj(v) && p !== ABSENT && v !== ABSENT) {
        let c = t.n?.[i];
        if (Object.is(c !== undefined ? peek(c, t, 1) : p, v)) return;
        if (c === undefined) {
          c = nodeOf(t, i, DELEGATE);
          if (k !== null) forEachDependent(k as any, sub => link(c!, sub));
        }
        return put(t, c, () => (Object.is(v, p) ? DELEGATE : v));
      }
    }
    if (Object.is(p, v) && !lands) {
      // A write another action's guess already made is a read of it (D-33).
      if (userWrite && context === null && cur !== t.da && carries(k)) read(k!);
      return;
    }
  }
  let d = t.da;
  if (d === null) {
    d = t.da = allRows(t, cur).slice();
    for (let j = 0; j < d.length; j++) if (!(j in d)) d[j] = ABSENT;
    drafts.push(t);
  }
  if (v === ABSENT) t.gone = true;
  if (i < 0) {
    const n = d.length;
    d.length = v;
    for (let j = n; j < v; j++) d[j] = ABSENT;
  } else {
    for (let j = d.length; j < i; j++) d[j] = ABSENT;
    d[i] = v;
  }
  t.w = true;
  if (writing === 0) close(0);
}
function close(from: number): void {
  while (drafts.length > from) {
    const t = drafts.pop()!;
    const d = t.da!;
    const a = keyNode(t);
    const prev = peek(a, t, 1);
    t.da = null;
    const carried = (a._config & CONFIG_GUESS) !== 0;
    // The truth lands beneath a guess even when it says the same (D-34).
    if (same(t, prev, d) && (userWrite || !carried)) continue;
    const committed =
      userWrite && listGuess !== null ? allRows(t, carried ? under!(a) : a._value) : null;
    put(t, a, () => d);
    if (committed !== null) listGuess!(t, allRows(t, prev), d, committed, carried);
  }
}

/** The held rows that are the committed rows' keys, slot by slot, paired at
 * the list's first read under the hold as the adoption would have (#3712). */
function pairLate(t: Target, node: Signal<any>): void {
  const ov = node._value;
  const nv = node._pendingValue;
  const fam = t._fam!;
  const keyFn = fam.key;
  if (t.s || !keyFn || !Array.isArray(nv) || ov === CHAINED || nv === CHAINED) return;
  let out: any[] | null = null;
  for (let i = 0, n = Math.min(ov.length, nv.length); i < n; i++) {
    const o = ov[i];
    const v = nv[i];
    if (
      o === v ||
      !isWrappable(o) ||
      !isWrappable(v) ||
      Array.isArray(o) !== Array.isArray(v) ||
      protoOf(o) !== protoOf(v) ||
      keyFn(o) !== keyFn(v) ||
      fam.map.has(o) ||
      fam.map.has(v) ||
      nv.includes(o) ||
      ov.includes(v)
    )
      continue;
    stageRow(fam, o, v, node);
    (out ??= nv.slice())[i] = o;
  }
  if (out === null) return;
  if (same(t, ov, out)) {
    node._pendingValue = NOT_PENDING;
    node._config &= ~CONFIG_HELD;
  } else node._pendingValue = out;
}
/** The rows the screen shows while they are not the truth: a live guess, or
 * a corrected one until its hold commits (D-34). */
function screen(t: Target): any[] | null {
  const k = t.k;
  if (guessed === null || k === null) return null;
  const r = carries(k)
    ? guessed(k)
    : k._config & CONFIG_HELD && k._pendingValue !== NOT_PENDING
      ? k._value
      : null;
  return r === null ? null : allRows(t, r);
}

/** Leaving a chain: the rows it showed are the list's own. */
function unchain(t: Target, keys: PropertyKey[], own: (key: PropertyKey) => any): void {
  const rows: any[] = [];
  for (const key of keys) {
    const i = ix(key);
    if (i >= 0) rows[i] = own(key);
  }
  const k = keyNode(t);
  if (k._value === CHAINED) k._value = rows;
  if (k._pendingValue === CHAINED) k._pendingValue = rows;
}
const eq =
  (t: Target) =>
  (a: any[], b: any[]): boolean =>
    same(t, a, b);
/** A record that became a list: its key node is its arrangement. */
function root(t: Target): void {
  if (t.k !== null) ((t.k._equals = eq(t)), put(t, t.k, () => t.v));
}
/** The rows a guess made answer the truth's rows of their keys: a row
 * keeps its proxy and readers (D-34). */
function made(t: Target, byKey: Map<any, any>, keyOf: (row: any) => any): Set<any> | null {
  const shown = screen(t);
  let out: Set<any> | null = null;
  if (shown !== null)
    for (const g of shown) {
      const k = keyOf(g);
      if (k !== undefined && !byKey.has(k)) (byKey.set(k, g), (out ??= new Set()).add(g));
    }
  return out;
}
const hold = (t: Target): any => resolveTx(txOf(t.k!)._parent ?? txOf(t.k!));

export const thinList: ThinList = {
  ix,
  eq,
  unchain,
  root,
  made,
  hold,
  value,
  get,
  has,
  write,
  mark: () => drafts.length,
  close,
  screen
};
