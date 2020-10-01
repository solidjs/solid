export {
  createRoot,
  createSignal,
  createEffect,
  createRenderEffect,
  createComputed,
  createDeferred,
  createSelector,
  createMemo,
  createResource,
  getListener,
  onCleanup,
  onError,
  untrack,
  batch,
  on,
  useTransition,
  createContext,
  useContext,
  getContextOwner,
  equalFn
} from "./reactive/signal";
export type { Resource } from "./reactive/signal";

export { createState, unwrap, $RAW } from "./reactive/state";
export type { State, SetStateFunction } from "./reactive/state";
export * from "./reactive/resourceState";

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