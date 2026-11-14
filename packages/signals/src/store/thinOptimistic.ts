import { guessedValueOf, optimisticWrite, pendingGuessOf } from "../core/guesses.js";
import { underOf } from "../core/truth.js";
import { CONFIG_OVERRIDE, NOT_PENDING, REACTIVE_REASK } from "../core/constants.js";
import { context } from "../core/core.js";
import {
  clock,
  joinFuture,
  passLane,
  resolveTx,
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
  if ((fam._asked = a) > 0) joinFuture(null);
});
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
