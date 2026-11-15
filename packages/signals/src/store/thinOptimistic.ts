import { guessedValueOf, optimisticWrite, pendingGuessOf, take } from "../core/guesses.js";
import { covered, underOf } from "../core/truth.js";
import { lanes, setLaneValue } from "../core/lanes.js";
import {
  CONFIG_CHILDREN_FORBIDDEN,
  CONFIG_GUESS,
  CONFIG_OVERRIDE,
  EFFECT_RENDER,
  NOT_PENDING,
  REACTIVE_REASK,
  STATUS_PENDING
} from "../core/constants.js";
import { link } from "../core/graph.js";
import { devGuardOptimisticBeforeLoad, devWarnOptimisticWhileLoading } from "../core/dev.js";
import { context, joinPassAt, read } from "../core/core.js";
import {
  clock,
  GlobalQueue,
  insertSubs,
  installStoreHooks,
  joinFuture,
  laneDirty,
  list,
  merge,
  passLane,
  resolveTx,
  question,
  staleReader,
  storeCommitHook,
  storeParkHook,
  transactions,
  txOf,
  type Transaction
} from "../core/scheduler.js";
import type { Computed, Signal } from "../core/types.js";
import {
  $THIN,
  installThinGuesses,
  installThinListGuess,
  installThinLanded,
  installThinStands,
  isThin,
  nodeOfThin,
  ABSENT_THIN,
  chainedRaw,
  linkedTo,
  releaseSettled,
  thinSetter as storeSetter,
  unwrapThin
} from "./thin.js";
import { isWrappable } from "./types.js";

import { createProjectionInternal, installThinAsk } from "./thinProjection.js";
import type { ProjectionOptions, Store } from "./types.js";

/** store/optimistic.ts `echoes`: reconcile would write nothing into `a`
 * from `b` (the server's echo of a guessed row, #3898). */
function echoes(a: any, b: any): boolean {
  if (a === b) return true;
  if (!isWrappable(a) || !isWrappable(b)) return false;
  a = unwrapThin(a);
  b = unwrapThin(b);
  if (a === b) return true;
  if (chainedRaw(a) || chainedRaw(b)) return false;
  const ak = Object.keys(a);
  if (Array.isArray(a) !== Array.isArray(b) || ak.length !== Object.keys(b).length) return false;
  for (const k of ak)
    if (!Object.prototype.hasOwnProperty.call(b, k) || !echoes(a[k], b[k])) return false;
  return true;
}
const echo = (a: unknown, b: unknown): boolean => {
  try {
    return echoes(a, b);
  } catch {
    return false; // a cycle is not plain data
  }
};
GlobalQueue._echoes ??= echo;
installThinGuesses(optimisticWrite as any, guessedValueOf, underOf, echo);

/** The family's guesses still in a lane. */
function live(fam: any): Signal<any>[] {
  const out: Signal<any>[] = [];
  if (fam.g)
    for (const n of fam.g)
      n._config & CONFIG_OVERRIDE || pendingGuessOf(n) !== NOT_PENDING
        ? out.push(n)
        : fam.g.delete(n);
  return out;
}
/** store/optimistic.ts `reasked`: the open question re-asks the same one (D-34 ¶3). */
function reasked(d: Computed<any>): boolean {
  if (d._flags & REACTIVE_REASK || d._x?._reask) return true;
  const ps = d._x?._pendingSources;
  if (!ps?.size) return false;
  for (const s of ps)
    if (s === d || !((s as any)._flags & REACTIVE_REASK || (s as any)._x?._reask)) return false;
  return true;
}
const sameAction = (a: Transaction, b: Transaction): boolean =>
  resolveTx(a._parent!) === resolveTx(b._parent!);
// store/optimistic.ts `ask`: a new question over guesses that answer the
// old one (D-34, #4336) — stamped with this flush's clock.
installThinAsk(fam => {
  const g = live(fam);
  if (g.length === 0) return;
  if (reasked(fam.node!)) return (n: any) => n._subs._sub._x?._transaction?._lane;
  let a = ~clock;
  for (const n of g) {
    if (passLane === null) a = clock + 1;
    else if (sameAction(txOf(n), passLane)) return;
  }
  if ((fam._asked = a) > 0) (asked.add(fam), joinFuture(null));
});
// store/optimistic.ts `_slotTake`: the derive re-asking in another
// action's lane takes the target's guesses of the action that guessed this
// node — that lane's new question, which they do not answer (F-6, #4336).
const prevTake = GlobalQueue._slotTake;
GlobalQueue._slotTake = (n: any, back?: boolean) => {
  const t = n._host;
  if (t === undefined || "px" in t) return prevTake ? prevTake(n, back) : false;
  if (back) return n;
  const d = t._fam?.node?._x?._transaction;
  const g = txOf(n);
  if (!d?._lane || sameAction(d, g)) return false;
  const all: Signal<any>[] = [];
  if (t.n !== null) for (const k of Reflect.ownKeys(t.n)) all.push(t.n[k]);
  if (t.h !== null) for (const k of Reflect.ownKeys(t.h)) all.push(t.h[k]);
  if (t.k !== null) all.push(t.k);
  for (const m of all) if (m._config & CONFIG_GUESS && txOf(m) === g) take(m, d, m !== n);
  return true;
};
// store/optimistic.ts `_laneRebase`, the #4525 re-base: a truth landing on
// a list guess written over a new question's flight. The new answer decides
// the rows the guess only carried over from the old one; rows the guess
// added stay, rows it removed stay removed. The truth stages beneath (true)
// and the guess's lane takes the composition, key by key.
const prevRebase = GlobalQueue._laneRebase;
GlobalQueue._laneRebase = (el: any, truth: unknown, older: boolean) => {
  const t = el._host;
  if (t === undefined || "px" in t) return prevRebase?.(el, truth, older);
  // The truth of an action whose own guess is on this list, entangled with
  // a later one's (D-33): the hold's own staging, beneath the guesses until
  // the hold commits (store/optimistic.ts, #4874).
  if (older && !t.over && ownQuestion(t)) return true;
  // Over a new question's flight (#4525), or an older question's truth
  // (D-35, #4482): the guess's edit re-bases over it.
  if (!t.r || !(t.over || (older && t.lg)))
    return !older && Array.isArray(t.v) && t._fam?.key ? fold(el, truth) : older;
  const keyFn = t._fam?.key;
  const d = t._fam?.node;
  if (!keyFn || !d) return older;
  const lane = txOf(el);
  if (t.over && d._x?._transaction) lane.over = d._x._transaction;
  // Again once the landing is whole: the derive writes key by key, and a
  // row it has not written yet is still the old answer's (#4482, #4441).
  rebase(t, el, truth, lane, keyFn);
  rebases.set(t, [lane, keyFn]);
  return true;
};
/** A list target's rows: each index's node through `of`, else the raw's. */
function rowsOf(t: any, of: (node: any) => unknown): any[] {
  const n = t.n ?? {};
  const at = (k: PropertyKey) => (n[k] ? of(n[k]) : undefined) ?? t.v[k];
  const out: any[] = [];
  for (let i = 0, len = at("length") as number; i < len; i++) out.push(at(i));
  return out;
}
function ownQuestion(t: any): boolean {
  const all = [t.k, ...(t.n ? Object.values(t.n) : [])] as any[];
  return all.some(n => n && n._config & CONFIG_GUESS && n._x?._q === question);
}
const rebases = new Map<any, [Transaction, (r: any) => any]>();
installThinLanded(() => flushRebases());
function flushRebases(): void {
  if (rebases.size === 0) return;
  const all = [...rebases];
  rebases.clear();
  for (const [t, [lane, keyFn]] of all) rebase(t, null, undefined, lane, keyFn);
}
/** store/optimistic.ts `fold` (D-34), key by key: a current truth landing
 * on a shown keyed list's guess folds beneath it instead of voiding the
 * lane. The guess stays the screen's until the hold commits, where rows
 * pair by key (`reconcile`'s guessed rows); the graph outside the lane
 * re-derives from the truth now (`foldedRead`). */
function fold(el: any, truth: unknown): boolean {
  const l = txOf(el);
  if (!l._shown) return false;
  const guess = guessedValueOf(el);
  if (!Object.is(guess, truth) && !echo(guess, truth)) l.folded = foldedRead;
  else GlobalQueue._confirmed?.(l);
  if (l.folded) insertSubs(el);
  joinFuture(resolveTx(l._parent ?? l));
  return true;
}
function foldedRead(c: Computed<any> | null, el: any): unknown {
  if (c !== null) {
    if (
      !(el._config & CONFIG_GUESS) ||
      passLane !== null ||
      (c as any)._type === EFFECT_RENDER ||
      c._config & CONFIG_CHILDREN_FORBIDDEN ||
      el._host?._fam?.node === c
    )
      return NOT_PENDING;
    const l = txOf(el);
    joinPassAt(c, resolveTx(l._parent ?? l));
  }
  if (el._pendingValue !== NOT_PENDING) return el._pendingValue;
  return covered(el);
}
function rebase(t: any, el: any, v: unknown, lane: Transaction, keyFn: (r: any) => any): void {
  const n = t.n as Record<PropertyKey, any>;
  const val = (node: any, f: (x: any) => unknown) =>
    node === undefined ? undefined : node === el ? v : f(node);
  const truthOf = (node: any) =>
    val(node, x =>
      x._config & CONFIG_GUESS
        ? underOf(x)
        : x._pendingValue !== NOT_PENDING
          ? x._pendingValue
          : x._value
    );
  const kOf = (r: any) => (isWrappable(r) ? keyFn(r) : undefined);
  // A truth row's key as the truth has it: a landing reconciles a new row
  // into the slot's row, staged on its leaves (the raw keeps the old key).
  const tkOf = (r: any) => {
    const rt = isWrappable(r) ? t._fam.map.get(r) : undefined;
    if (!rt?.n) return kOf(r);
    const o = { ...r };
    for (const k of Reflect.ownKeys(rt.n)) {
      const tv = truthOf(rt.n[k]);
      tv === ABSENT_THIN ? delete o[k] : (o[k] = tv);
    }
    return kOf(o);
  };
  const truthRows = rowsOf(t, truthOf);
  // The guess as written and the answer it was written over (recorded at
  // the write): a later landing composes from them, not from a re-base.
  if (!t.lg) return;
  const guessRows: any[] = t.lg.guess;
  const removed: Set<unknown> = t.lg.removed;
  const byKey = new Map(truthRows.map(r => [tkOf(r), r]));
  const used = new Set();
  const next: any[] = [];
  for (const g of guessRows) {
    if (g === ABSENT_THIN || g === undefined) continue;
    const k = kOf(g);
    // A truth row under a guessed row's key: the guessed row keeps its
    // target (its proxy, readers and leaf guesses); its leaves take the
    // truth beneath (store/optimistic.ts adopts the truth into it).
    if (k !== undefined && byKey.has(k))
      (next.push(isWrappable(g) && t._fam.map.has(g) ? g : byKey.get(k)), used.add(k));
    else if (k === undefined || !removed.has(k)) next.push(g);
  }
  for (const r of truthRows) {
    if (r === ABSENT_THIN || r === undefined) continue;
    const k = tkOf(r);
    if (!used.has(k) && !removed.has(k)) next.push(r);
  }
  let moved = false;
  const at = (key: PropertyKey, value: unknown) =>
    atNode(n[key as any] ?? nodeOfThin(t, key), value);
  const atNode = (node: any, value: unknown) => {
    // Unchanged on screen: an older truth beneath it publishes nothing (Q-D).
    if (
      Object.is(guessedValueOf(node), value) &&
      (node._config & CONFIG_OVERRIDE ||
        node._pendingValue === NOT_PENDING ||
        Object.is(node._pendingValue, value))
    )
      return;
    moved = true;
    if (!(node._config & CONFIG_OVERRIDE)) {
      node._config |= CONFIG_OVERRIDE | CONFIG_GUESS;
      list(node, lane);
    }
    setLaneValue(node, lane, value);
    laneDirty(node, lane);
  };
  // A truth row reconciled into a slot's row under a new key: its staged
  // leaves are the lane's too, or the lane shows the old row's content.
  for (const r of next) {
    // Only a row the truth re-keyed (a new row reconciled into the slot's).
    const rt =
      isWrappable(r) && truthRows.includes(r) && tkOf(r) !== kOf(r) ? t._fam.map.get(r) : undefined;
    if (rt?.n)
      for (const k of Reflect.ownKeys(rt.n)) {
        const leaf = rt.n[k];
        if (!(leaf._config & CONFIG_OVERRIDE) && leaf._pendingValue !== NOT_PENDING)
          atNode(leaf, leaf._pendingValue);
      }
  }
  const len = Math.max(truthRows.length, guessRows.length, next.length);
  for (let i = 0; i < len; i++) at(i, i < next.length ? next[i] : ABSENT_THIN);
  at("length", next.length);
  if (t.k !== null && moved) at2(t.k, lane);
}
function at2(k: any, lane: Transaction): void {
  if (!(k._config & CONFIG_OVERRIDE)) {
    k._config |= CONFIG_OVERRIDE | CONFIG_GUESS;
    list(k, lane);
  }
  setLaneValue(k, lane, (guessedValueOf(k) as number) + 1);
  laneDirty(k, lane);
}
// store/optimistic.ts `park`: a new question from mainline over a guess a
// frame still reads holds the flush with the guess's action (D-34, #4336).
const asked = new Set<any>();
const prevPark = storeParkHook;
const prevCommit = storeCommitHook;
installStoreHooks(
  t => {
    prevPark?.(t);
    for (const fam of asked) {
      if (fam._asked !== clock + 1) {
        asked.delete(fam);
        continue;
      }
      for (const n of live(fam))
        for (let s = n._subs; s !== null; s = s._nextSub)
          if (s._gen === (s._sub as any)._depGen) {
            merge(txOf(n)._parent!, t);
            break;
          }
    }
  },
  () => {
    prevCommit?.();
    flushRebases();
    releaseSettled(
      n =>
        pendingGuessOf(n) !== NOT_PENDING ||
        transactions.some(u => u._nodes.includes(n)) ||
        lanes.some(l => l._nodes.includes(n))
    );
  }
);
// store/optimistic.ts `stands` (A17; over a new question only a target
// carrying a guess stands in, F-2/F-6; a linked reader keeps observing, #4536).
// A list guess written while the derive asks a new question (an input
// changed, not a `refresh()`): it does not answer that question (D-34 ¶3,
// the #4525 mark).
installThinListGuess(
  (t: any) => {
    const d = t._fam!.node!;
    if (!d) return;
    // Over a new question's flight: the #4525 mark.
    if (d._statusFlags & STATUS_PENDING && !reasked(d)) t.over = true;
    const kf = t._fam.key;
    if (!kf || !t.lo) return;
    // The guess as written (the draft's view, last write wins), and the
    // keys it removes (store/optimistic.ts): a row of the view before the
    // setter it dropped, or one it only carried over from the committed
    // answer — a re-base keeps only the rows it added (D-35, #4482, #4656).
    const kOf = (r: any) => (isWrappable(r) ? kf(r) : undefined);
    const guess = rowsOf(t, guessedValueOf);
    const kept = new Set(guess.map(kOf));
    const committed = rowsOf(t, x => (x._config & CONFIG_GUESS ? underOf(x) : x._value));
    const base = new Set(committed);
    const removed = new Set();
    // The view's rows, then the committed answer's: a committed row the
    // view lacked was removed by another action's guess (F-11, #4656).
    const lo = t.lo as any[];
    [...lo, ...committed].forEach((r, i) => {
      const k = kOf(r);
      if (k !== undefined && (!kept.has(k) || (i < lo.length && base.has(r)))) removed.add(k);
    });
    t.lg = { guess, removed };
  },
  (t: any, seq: number) => {
    if (t.ls === seq || !t._fam.key) return;
    t.ls = seq;
    t.lo = rowsOf(t, guessedValueOf);
  }
);

/** store/optimistic.ts `held`: a derivation a pending render effect reads,
 * through any chain of pending derivations (#4561). */
function held(c: any, seen = new Set()): true | undefined {
  for (let s = c._subs; s; s = s._nextSub) {
    const r: any = s._sub;
    if (
      r._statusFlags & STATUS_PENDING &&
      (r._type === EFFECT_RENDER || (!r._type && !seen.has(r) && (seen.add(r), held(r, seen))))
    )
      return true;
  }
}
let heldC: unknown, heldAt: number;
installThinStands(t => {
  const f: any = t._fam;
  if (live(f).length === 0) return ((t as any).over = false);
  const a = f._asked;
  const own = (n: any) => n !== null && n !== undefined && n._config & CONFIG_OVERRIDE;
  const has = () =>
    own(t.k) || (t.n !== null && Reflect.ownKeys(t.n).some(k => own(t.n![k as any])));
  if ((a === clock + 1 && passLane === null && !has()) || a === ~clock) return false;
  const c: any = context;
  const d = f.node;
  // Linked by this pass's hold (below): its other reads keep the guess.
  if (c?._deps !== undefined && linkedTo(c, d)) return heldC === c && heldAt === clock ? 2 : false;
  // A guess over a question in flight it does not answer (#4525): a reader
  // in the frame's hold keeps observing the flight (F-1, #4561) — linked as
  // a stale reader of its hold, and served the guess like lane work.
  if ((t as any).over && c?._statusFlags & STATUS_PENDING) {
    if (c._type === EFFECT_RENDER) read(d);
    else if (held(c)) {
      if (!d._x?._transaction) read(d);
      else return (link(d, c), staleReader(c, txOf(d)), (heldC = c), (heldAt = clock), 2);
    }
  }
  // #4786 (store/optimistic.ts): guesses standing in (A17) for a
  // `refresh()` another action holds (D-34 ¶3) leave a derivation reading
  // them a stale reader of that refetch (A15): linked, re-derived at the
  // landing (F-11). A render effect reads its memo's frame.
  else if (
    c?._depsTail !== undefined &&
    c._type !== EFFECT_RENDER &&
    d._x?._reask &&
    d._x._transaction &&
    !live(f).some(n => {
      const l = txOf(n);
      return resolveTx(l._parent ?? l) === txOf(d);
    })
  )
    (link(d, c), staleReader(c, txOf(d)));
  return reasked(d) ? 3 : true;
});

export function createThinOptimisticStore<T extends object = {}>(
  first: any,
  second?: any,
  third?: any
): [Store<T>, (fn: (draft: T) => T | void) => void] {
  // Over another store (#3672's shape) the view chains to it (a store seed,
  // createProjectionInternal): base commits are the truth beneath the guesses.
  const derived = typeof first === "function";
  const store = createProjectionInternal(
    (derived ? first : null) as any,
    (derived ? second : first) as T,
    (derived ? third : second) as ProjectionOptions,
    true
  );
  return [
    store,
    (fn: (draft: T) => T | void) => (
      __DEV__ &&
        derived &&
        (devGuardOptimisticBeforeLoad((store as any)[$THIN]._fam.node),
        devWarnOptimisticWhileLoading((store as any)[$THIN]._fam.node)),
      storeSetter(store, fn)
    )
  ];
}
