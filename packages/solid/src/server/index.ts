// From mock signals (same exports that index.ts pulls from @solidjs/signals)
export {
  $PROXY,
  $REFRESH,
  $TRACK,
  action,
  createEffect,
  createMemo,
  createOptimistic,
  createOptimisticStore,
  createOwner,
  createProjection,
  createReaction,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  createTrackedEffect,
  deep,
  flatten,
  flush,
  getNextChildId,
  getObserver,
  getOwner,
  isEqual,
  isRefreshing,
  isPending,
  isWrappable,
  mapArray,
  merge,
  omit,
  onCleanup,
  onSettled,
  latest,
  reconcile,
  refresh,
  repeat,
  resolve,
  NotReadyError,
  runWithOwner,
  snapshot,
  storePath,
  createDeepProxy,
  enableExternalSource,
  enforceLoadingBoundary,
  untrack
} from "./signals.js";

// All type re-exports from signals
export type {
  Accessor,
  ComputeFunction,
  EffectFunction,
  EffectOptions,
  ExternalSource,
  ExternalSourceConfig,
  ExternalSourceFactory,
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
  StoreSetter,
  StorePathRange,
  ArrayFilterFn,
  CustomPartial,
  Part,
  PathSetter,
  PatchOp
} from "./signals.js";

// Wrappers — context, children, dev symbols
export { $DEVCOMP, children, createContext, useContext, ssrRunInScope } from "./core.js";
export type {
  ChildrenReturn,
  Context,
  ContextProviderComponent,
  ResolvedChildren,
  ResolvedJSXElement
} from "./core.js";

// Component helpers and types
export * from "./component.js";

// Flow controls
export * from "./flow.js";

// SSR coordination
export {
  sharedConfig,
  Loading,
  ssrHandleError,
  NoHydration,
  Hydration,
  NoHydrateContext
} from "./hydration.js";
export type { HydrationContext } from "./hydration.js";

// Types
import type { JSX } from "../jsx.js";
type JSXElement = JSX.Element;
export type { JSXElement, JSX };

// Dev — no dev mode on server
export const DEV = undefined;
