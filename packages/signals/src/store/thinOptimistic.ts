import { guessedValueOf, optimisticWrite } from "../core/guesses.js";
import { underOf } from "../core/truth.js";
import { $THIN, installThinGuesses, thinSetter as storeSetter } from "./thin.js";
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
import { createProjectionInternal } from "./thinProjection.js";
import type { ProjectionOptions, Store } from "./types.js";

installThinGuesses(optimisticWrite as any, guessedValueOf, underOf);

export function createThinOptimisticStore<T extends object = {}>(
  first: any,
  second?: any,
  third?: any
): [Store<T>, (fn: (draft: T) => T | void) => void] {
  // Chained over another store (#3672's shape): the view derives a tracked
  // copy of the base, so base commits are the truth beneath the guesses.
  if (typeof first !== "function" && (first as any)?.[$THIN]) {
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
