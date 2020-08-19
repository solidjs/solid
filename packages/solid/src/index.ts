export {
  createRoot,
  createSignal,
  createEffect,
  createDeferred,
  createDependentEffect,
  createMemo,
  isListening,
  onCleanup,
  onError,
  untrack,
  batch,
  createContext,
  useContext,
  getContextOwner,
  equalFn,
  afterEffects,
  // deprecations
  untrack as sample,
  batch as freeze
} from "./reactive/signal";

export { createState, unwrap, $RAW } from "./reactive/state";
export type { State, SetStateFunction } from "./reactive/state";

export { reconcile, produce } from "./reactive/stateModifiers";

export * from "./reactive/scheduler";
export * from "./reactive/array";
export * from "./rendering";

// handle multiple instance check
declare global {
  var Solid$$: boolean;
}

if (!globalThis.Solid$$) globalThis.Solid$$ = true;
else
  console.warn(
    "You appear to have multiple instances of Solid. This can lead to unexpected behavior."
  );