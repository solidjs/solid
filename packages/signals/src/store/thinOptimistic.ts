import { guessedValueOf, optimisticWrite } from "../core/guesses.js";
import { installThinGuesses, thinSetter as storeSetter } from "./thin.js";
import { createProjectionInternal } from "./thinProjection.js";
import type { ProjectionOptions, Store } from "./types.js";

installThinGuesses(optimisticWrite as any, guessedValueOf);

export function createThinOptimisticStore<T extends object = {}>(
  first: any,
  second?: any,
  third?: any
): [Store<T>, (fn: (draft: T) => T | void) => void] {
  const derived = typeof first === "function";
  const store = createProjectionInternal(
    (derived ? first : null) as any,
    (derived ? second : first) as T,
    (derived ? third : second) as ProjectionOptions,
    true
  );
  return [store, (fn: (draft: T) => T | void) => storeSetter(store, fn)];
}
