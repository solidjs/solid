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
  onMount,
  onCleanup,
  onError,
  untrack,
  batch,
  on,
  useTransition,
  createContext,
  useContext,
  children,
  getListener,
  getOwner,
  runWithOwner,
  equalFn
} from "./reactive/signal";
export type { Resource } from "./reactive/signal";

export { createState, unwrap, $RAW } from "./reactive/state";
export type { State, SetStateFunction } from "./reactive/state";
export * from "./reactive/mutable";
export * from "./reactive/observable";

export { reconcile, produce } from "./reactive/stateModifiers";

export * from "./reactive/scheduler";
export * from "./reactive/array";
export * from "./render";

import type { JSX } from "./jsx";
type JSXElement = JSX.Element;
export type { JSXElement, JSX };

// mock server endpoint for dom-expressions
export function awaitSuspense() {}

// dev
import { writeSignal, serializeGraph } from "./reactive/signal";
let DEV: { writeSignal: typeof writeSignal, serializeGraph: typeof serializeGraph };
if ("_SOLID_DEV_") {
  DEV = { writeSignal, serializeGraph }
}
export { DEV };

// handle multiple instance check
declare global {
  var Solid$$: boolean;
}

if ("_SOLID_DEV_" && globalThis) {
  if (!globalThis.Solid$$) globalThis.Solid$$ = true;
  else
    console.warn(
      "You appear to have multiple instances of Solid. This can lead to unexpected behavior."
    );
}
