export {
  $PROXY,
  $TRACK,
  $RAW,
  flushSync,
  createAsync,
  createEffect,
  createMemo,
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  isEqual,
  isWrappable,
  flatten,
  getObserver,
  getOwner,
  mapArray,
  merge,
  omit,
  onCleanup,
  reconcile,
  runWithOwner,
  untrack,
  unwrap
} from "@solidjs/signals";

export type {
  Accessor,
  ComputeFunction,
  EffectFunction,
  EffectOptions,
  Merge,
  NoInfer,
  NotWrappable,
  Omit,
  Owner,
  Signal,
  SignalOptions,
  Setter,
  Store,
  SolidStore,
  StoreNode,
  StoreSetter
} from "@solidjs/signals";

// needs wrappers
export { $DEVCOMP, children, createContext, onMount, useContext } from "./client/core.js";

export type {
  ChildrenReturn,
  Context,
  ContextProviderComponent,
  ResolvedChildren,
  ResolvedJSXElement
} from "./client/core.js";

// under review.. might be unnecessary core with `createAsync`
export * from "./client/observable.js";

export * from "./client/component.js";
export * from "./client/flow.js";
export { sharedConfig } from "./client/hydration.js";

import type { JSX } from "./jsx.js";
type JSXElement = JSX.Element;
export type { JSXElement, JSX };

// dev
import { registerGraph, IS_DEV } from "./client/core.js";
const DevHooks = {}; // until implemented
export const DEV = IS_DEV ? ({ hooks: DevHooks, registerGraph } as const) : undefined;

// handle multiple instance check
declare global {
  var Solid$$: boolean;
}

if (IS_DEV && globalThis) {
  if (!globalThis.Solid$$) globalThis.Solid$$ = true;
  else
    console.warn(
      "You appear to have multiple instances of Solid. This can lead to unexpected behavior."
    );
}

/* Not Implemented
export {
  batch,
  catchError, // handled by ErrorBoundary
  createComputed,
  createDeferred,
  createResource, // createAsync
  createReaction,
  createSelector, // createProjection
  DevHooks,
  enableExternalSource,
  enableScheduling,
  equalFn, // renamed `isEqual`
  getListener, // renamed `getObserver`
  indexArray, // handled in `mapArray`
  Index, // handled by For
  on, // with split effects this doesn't need to be core
  onError, // handled by ErrorBoundary
  startTransition,
  SuspenseList
  useTransition,
  writeSignal, // handled by underlying Node class

  // Store related to legacy syntax
  createMutable,
  modifyMutable,
  produce, // now default
}

type {
  AccessorArray, //use by On only
  EffectFunction,
  InitializedResource,
  InitializedResourceOptions,
  InitializedResourceReturn,
  MemoOptions, //SignalOptions
  OnEffectFunction,
  OnOptions,
  Resource,
  ResourceActions,
  ResourceFetcher,
  ResourceFetcherInfo,
  ResourceOptions,
  ResourceReturn,
  ResourceSource,
  // Store related to legacy syntax
  ArrayFilterFn,
  DeepMutable,
  DeepReadonly,
  Part,
  ReconcileOptions,
  SetStoreFunction,
  StorePathRange,
}
*/
