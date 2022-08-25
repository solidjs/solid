export {
  createRoot,
  createSignal,
  createEffect,
  createRenderEffect,
  createComputed,
  createReaction,
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
  enableScheduling,
  enableExternalSource,
  startTransition,
  useTransition,
  createContext,
  useContext,
  children,
  getListener,
  getOwner,
  runWithOwner,
  equalFn,
  $DEVCOMP,
  $PROXY,
  $TRACK
} from "./reactive/signal.js";
export type {
  Accessor,
  Setter,
  Signal,
  Resource,
  ResourceActions,
  ResourceSource,
  ResourceOptions,
  ResourceReturn,
  ResourceFetcher,
  ResourceFetcherInfo,
  ChildrenReturn,
  Context,
  ReturnTypes,
  Owner,
  InitializedResource,
  InitializedResourceOptions,
  InitializedResourceReturn
} from "./reactive/signal.js";


export * from "./reactive/observable.js";
export * from "./reactive/scheduler.js";
export * from "./reactive/array.js";
export * from "./render/index.js";

import type { JSX } from "./jsx.js";
type JSXElement = JSX.Element;
export type { JSXElement, JSX };

// dev
import { writeSignal, serializeGraph, registerGraph, hashValue } from "./reactive/signal.js";
let DEV: {
  writeSignal: typeof writeSignal;
  serializeGraph: typeof serializeGraph;
  registerGraph: typeof registerGraph;
  hashValue: typeof hashValue;
};
if ("_SOLID_DEV_") {
  DEV = { writeSignal, serializeGraph, registerGraph, hashValue };
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
