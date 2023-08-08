export {
  $DEVCOMP,
  $PROXY,
  $TRACK,
  batch,
  catchError,
  children,
  createComputed,
  createContext,
  createDeferred,
  createEffect,
  createMemo,
  createReaction,
  createRenderEffect,
  createResource,
  createRoot,
  createSelector,
  createSignal,
  enableExternalSource,
  enableScheduling,
  equalFn,
  getListener,
  getOwner,
  on,
  onCleanup,
  onError,
  onMount,
  runWithOwner,
  startTransition,
  untrack,
  useContext,
  useTransition
} from "./reactive/signal.js";
export type {
  Accessor,
  AccessorArray,
  ChildrenReturn,
  Context,
  ContextProviderComponent,
  EffectFunction,
  EffectOptions,
  InitializedResource,
  InitializedResourceOptions,
  InitializedResourceReturn,
  MemoOptions,
  NoInfer,
  OnEffectFunction,
  OnOptions,
  Owner,
  ResolvedChildren,
  ResolvedJSXElement,
  Resource,
  ResourceActions,
  ResourceFetcher,
  ResourceFetcherInfo,
  ResourceOptions,
  ResourceReturn,
  ResourceSource,
  ReturnTypes,
  Setter,
  Signal,
  SignalOptions
} from "./reactive/signal.js";

export * from "./reactive/observable.js";
export * from "./reactive/scheduler.js";
export * from "./reactive/array.js";
export * from "./render/index.js";

import type { JSX } from "./jsx.js";
type JSXElement = JSX.Element;
export type { JSXElement, JSX };

// dev
import { registerGraph, writeSignal, DevHooks } from "./reactive/signal.js";
export const DEV = "_SOLID_DEV_"
  ? ({ hooks: DevHooks, writeSignal, registerGraph } as const)
  : undefined;

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
