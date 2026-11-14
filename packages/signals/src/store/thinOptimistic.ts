import { guessedValueOf, optimisticWrite, pendingGuessOf, take } from "../core/guesses.js";
import { underOf } from "../core/truth.js";
import { CONFIG_GUESS, CONFIG_OVERRIDE, NOT_PENDING, REACTIVE_REASK } from "../core/constants.js";
import { context } from "../core/core.js";
import {
  clock,
  GlobalQueue,
  installStoreHooks,
  joinFuture,
  merge,
  passLane,
  resolveTx,
  storeCommitHook,
  storeParkHook,
  txOf,
  type Transaction
} from "../core/scheduler.js";
import type { Computed, Signal } from "../core/types.js";
import {
  $THIN,
  installThinGuesses,
  installThinStands,
  isThin,
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
installThinStands(t => {
  const f: any = t._fam;
  if (live(f).length === 0) return false;
  const a = f._asked;
  const own = (n: any) => n !== null && n !== undefined && n._config & CONFIG_OVERRIDE;
  const has = () =>
    own(t.k) || (t.n !== null && Reflect.ownKeys(t.n).some(k => own(t.n![k as any])));
  if ((a === clock + 1 && passLane === null && !has()) || a === ~clock) return false;
  const c: any = context;
  return !(c?._deps !== undefined && linkedTo(c, f.node));
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
  return [store, (fn: (draft: T) => T | void) => storeSetter(store, fn)];
}
