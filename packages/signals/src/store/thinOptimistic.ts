import { guessedValueOf, optimisticWrite, pendingGuessOf, take } from "../core/guesses.js";
import { covered, underOf } from "../core/truth.js";
import { setLaneValue } from "../core/lanes.js";
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
  staleReader,
  storeCommitHook,
  storeParkHook,
  txOf,
  type Transaction
} from "../core/scheduler.js";
import type { Computed, Signal } from "../core/types.js";
import {
  $THIN,
  installThinGuesses,
  installThinListGuess,
  installThinStands,
  isThin,
  nodeOfThin,
  ABSENT_THIN,
  linkedTo,
  thinSetter as storeSetter
} from "./thin.js";
import { isWrappable } from "./types.js";

/** A deep plain copy read through the proxy, so every key it holds is tracked. */
function trackedCopy(v: any): any {
  if (!isWrappable(v)) return v;
  if (Array.isArray(v)) {
    const out = new Array(v.length);
    for (let i = 0; i < v.length; i++) out[i] = trackedCopy(v[i]);
    return out;
  }
  const out: any = Object.create(Object.getPrototypeOf(v));
  for (const k of Reflect.ownKeys(v)) out[k] = trackedCopy(v[k]);
  return out;
}
import { createProjectionInternal, installThinAsk } from "./thinProjection.js";
import type { ProjectionOptions, Store } from "./types.js";

installThinGuesses(optimisticWrite as any, guessedValueOf, underOf);

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
  if (!t.over || !t.r) return !older && Array.isArray(t.v) && t._fam?.key ? fold(el, truth) : older;
  const keyFn = t._fam?.key;
  const d = t._fam?.node;
  if (!keyFn || !d) return older;
  const lane = txOf(el);
  if (d._x?._transaction) lane.over = d._x._transaction;
  rebase(t, el, truth, lane, keyFn);
  return true;
};
/** store/optimistic.ts `fold` (D-34), key by key: a current truth landing
 * on a shown keyed list's guess folds beneath it instead of voiding the
 * lane. The guess stays the screen's until the hold commits, where rows
 * pair by key (`reconcile`'s guessed rows); the graph outside the lane
 * re-derives from the truth now (`foldedRead`). */
function fold(el: any, truth: unknown): boolean {
  const l = txOf(el);
  if (!l._shown) return false;
  const guess = guessedValueOf(el);
  if (!Object.is(guess, truth) && !GlobalQueue._echoes!(guess, truth)) l.folded = foldedRead;
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
  const rows = (of: (node: any) => unknown): any[] => {
    const len = of(n.length) as number;
    const out: any[] = [];
    for (let i = 0; i < len; i++) out.push(of(n[i]) ?? t.v[i]);
    return out;
  };
  const kOf = (r: any) => (isWrappable(r) ? keyFn(r) : undefined);
  const truthRows = rows(truthOf);
  // The guess as written and the answer it was written over (recorded at
  // the write): a later landing composes from them, not from a re-base.
  if (!t.lg) return;
  const guessRows: any[] = t.lg.guess;
  const old: Set<unknown> = t.lg.old;
  const removed = new Set([...old].filter(k => !guessRows.some(g => kOf(g) === k)));
  const byKey = new Map(truthRows.map(r => [kOf(r), r]));
  const used = new Set();
  const next: any[] = [];
  for (const g of guessRows) {
    const k = kOf(g);
    if (k !== undefined && byKey.has(k)) (next.push(byKey.get(k)), used.add(k));
    else if (k === undefined || !old.has(k)) next.push(g);
  }
  for (const r of truthRows) {
    const k = kOf(r);
    if (!used.has(k) && !removed.has(k)) next.push(r);
  }
  const at = (key: PropertyKey, value: unknown) => {
    const node = n[key as any] ?? nodeOfThin(t, key);
    if (!(node._config & CONFIG_OVERRIDE)) {
      node._config |= CONFIG_OVERRIDE | CONFIG_GUESS;
      list(node, lane);
    }
    setLaneValue(node, lane, value);
    laneDirty(node, lane);
  };
  const len = Math.max(truthRows.length, guessRows.length);
  for (let i = 0; i < len; i++) at(i, i < next.length ? next[i] : ABSENT_THIN);
  at("length", next.length);
  if (t.k !== null) at2(t.k, lane);
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
  () => prevCommit?.()
);
// store/optimistic.ts `stands` (A17; over a new question only a target
// carrying a guess stands in, F-2/F-6; a linked reader keeps observing, #4536).
// A list guess written while the derive asks a new question (an input
// changed, not a `refresh()`): it does not answer that question (D-34 ¶3,
// the #4525 mark).
installThinListGuess((t: any) => {
  const d = t._fam!.node!;
  if (!d || !(d._statusFlags & STATUS_PENDING) || reasked(d)) return;
  t.over = true;
  // The guess as written (the draft's view, last write wins) and the answer
  // it was written over (committed: guesses apply at the seam).
  const n = t.n as Record<PropertyKey, any>;
  const rows = (of: (node: any, i: PropertyKey) => unknown): any[] => {
    const len = of(n.length, "length") as number;
    const out: any[] = [];
    for (let i = 0; i < len; i++) out.push(of(n[i], i));
    return out;
  };
  const kf = t._fam.key;
  t.lg = {
    guess: rows((x, i) => (x === undefined ? t.v[i] : guessedValueOf(x))),
    old:
      t.lg?.old ??
      new Set(
        rows((x, i) => (x === undefined ? t.v[i] : x._value)).map((r: any) =>
          isWrappable(r) ? kf(r) : undefined
        )
      )
  };
});
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
  return true;
});

export function createThinOptimisticStore<T extends object = {}>(
  first: any,
  second?: any,
  third?: any
): [Store<T>, (fn: (draft: T) => T | void) => void] {
  // Chained over another store (#3672's shape): the view derives a tracked
  // copy of the base, so base commits are the truth beneath the guesses.
  if (typeof first !== "function" && isThin(first)) {
    const base = first;
    first = () => trackedCopy(base);
    third = second;
    second = Array.isArray(base) ? [] : {};
  }
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
