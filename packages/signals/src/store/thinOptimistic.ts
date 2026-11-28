import {
  guessedValueOf,
  guessesWaiting,
  optimisticWrite,
  pendingGuessOf
} from "../core/guesses.js";
import { covered, underOf } from "../core/truth.js";
import { lanes, readGuesses, setLaneValue } from "../core/lanes.js";
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
import { context, joinPassAt, read, signal } from "../core/core.js";
import {
  actionDepth,
  clock,
  GlobalQueue,
  insertSubs,
  installStoreHooks,
  joinFuture,
  question,
  laneDirty,
  merge,
  passLane,
  resolveTx,
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
  installThinList,
  installThinStands,
  chainedRaw,
  linkedTo,
  releaseSettled,
  thinSetter as storeSetter,
  unwrapThin
} from "./thin.js";
import { onListGuess, thinList } from "./thinList.js";
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
GlobalQueue._echoes = echo;
installThinGuesses(optimisticWrite as any, guessedValueOf, underOf, echo);

/** A setter that read another action's live guess and wrote nothing (the
 * row it would remove is already gone) still depends on that guess landing:
 * its action guesses the family's touch node, so the two entangle as a
 * write beside the read does (D-33, ruled 2026-11-18). */
function settle(store: any, fn: (draft: any) => any): void {
  const r = readGuesses.length;
  const w = guessesWaiting();
  storeSetter(store, fn);
  if (actionDepth && readGuesses.length > r && guessesWaiting() === w) {
    const fam = store[$THIN]._fam;
    optimisticWrite((fam.tn ??= signal(0)), (x: number) => x + 1);
  }
}
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
// The derive re-asking in a lane of another hold than the one that guessed
// this target writes it: the two holds merge, and the lane reveals with
// them (D-33, D-34).
GlobalQueue._slotMerge = (n: any) => {
  const d = n._host?._fam?.node?._x?._transaction;
  const g = txOf(n);
  if (!d?._lane || sameAction(d, g)) return;
  const h = resolveTx(g._parent!);
  merge(resolveTx(d._parent!), h);
  d.over = resolveTx(h);
  d._held = true;
};
// A truth landing on a keyed list's shown guess folds beneath it (D-34): the
// guess stays the screen's until its hold commits, where rows pair by key;
// the graph outside the lane re-derives from the truth now (`foldedRead`).
// An older question's answer waits beneath (D-34 provenance).
installThinList(thinList);
// A keyed list guess is kept as its edit: the rows it added and the keys it
// removed. The answer to a question it was not written over is not its
// truth (D-34): the edit is made again over that answer when it lands.
onListGuess((t: any, view: any[], rows: any[], committed: any[], carried: boolean) => {
  const d = t._fam!.node;
  const kf = t._fam.key;
  if (!kf) return;
  // Written while the derive asks a new question (an input changed, not a
  // `refresh()`): it does not answer that question.
  if (d && d._statusFlags & STATUS_PENDING && !reasked(d)) t.over = true;
  const kOf = (r: any) => (isWrappable(r) ? kf(r) : undefined);
  const kept = new Set(rows.map(kOf));
  const base = new Set(committed);
  const removed = new Set();
  [...view, ...committed].forEach((r, i) => {
    const k = kOf(r);
    if (k !== undefined && (!kept.has(k) || (i < view.length && base.has(r)))) removed.add(k);
  });
  const qs: Set<number> = carried && t.lg ? t.lg.qs : new Set();
  t.lg = { rows, removed, qs: qs.add(question) };
});
function edited(t: any, truth: any[]): any[] {
  const kf = t._fam.key;
  const kOf = (r: any) => (isWrappable(r) ? kf(r) : undefined);
  const { rows, removed } = t.lg;
  const byKey = new Map(truth.map(r => [kOf(r), r]));
  const used = new Set();
  const next: any[] = [];
  for (const g of rows) {
    const k = kOf(g);
    if (k !== undefined && byKey.has(k))
      (next.push(t._fam.map.has(g) ? g : byKey.get(k)), used.add(k));
    else if (k === undefined || !removed.has(k)) next.push(g);
  }
  for (const r of truth) {
    const k = kOf(r);
    if (!used.has(k) && !removed.has(k)) next.push(r);
  }
  return next;
}
GlobalQueue._laneRebase = (el: any, truth: unknown, older: boolean) => {
  const t = el._host;
  if (t === undefined || !t.l || el !== t.k || !t._fam.key) return undefined;
  // The answer to a question the guess was not written over is not its
  // truth: it waits beneath, and its frame is held with the guess's hold.
  // The truth of an action whose own guess is on this list, entangled with
  // a later one's: the hold's own staging, beneath the guesses until the
  // hold commits (D-33).
  if (older && !t.over && t.lg?.qs.has(question)) return true;
  if (t.lg && (t.over || older)) {
    const l = txOf(el);
    const d = t._fam.node?._x?._transaction;
    if (t.over && d) l.over = d;
    const e = edited(t, truth as any[]);
    if (!el._equals(guessedValueOf(el), e)) (setLaneValue(el, l, e), laneDirty(el, l));
    return true;
  }
  return older || fold(el, truth);
};
function fold(el: any, truth: unknown): boolean {
  const l = txOf(el);
  if (!l._shown) return false;
  const guess = guessedValueOf(el);
  if (!el._equals(guess, truth) && !echo(guess, truth)) l.folded = foldedRead;
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
    releaseSettled(
      n =>
        pendingGuessOf(n) !== NOT_PENDING ||
        transactions.some(u => u._nodes.includes(n)) ||
        lanes.some(l => l._nodes.includes(n))
    );
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
let heldC: unknown,
  heldAt = 0;
installThinStands(t => {
  const f: any = t._fam;
  if (live(f).length === 0) return ((t as any).over = false);
  const a = f._asked;
  const own = (n: any) => n !== null && n !== undefined && n._config & CONFIG_OVERRIDE;
  const has = () =>
    own(t.k) || (t.n !== null && Reflect.ownKeys(t.n).some(k => own(t.n![k as any])));
  // Over a new question: only a target carrying a guess stands in — whoever
  // asked. A reader that joined another action's lane (it reads that
  // action's guess elsewhere) waits for the answer too, so a `Loading on`
  // region remounted under it shows its fallback (F-2, F-6, #4929).
  if (
    (a === clock + 1 &&
      (passLane === null
        ? !has()
        : !live(f).some(n => n._config & CONFIG_OVERRIDE && sameAction(txOf(n), passLane!)))) ||
    a === ~clock
  )
    return false;
  const c: any = context;
  const d = f.node;
  // Linked by this pass's hold (below): its other reads keep the guess.
  if (c?._deps !== undefined && linkedTo(c, d)) return heldC === c && heldAt === clock ? 2 : false;
  // A guess over a question in flight it does not answer (D-34): a reader
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
      settle(store, fn)
    )
  ];
}
