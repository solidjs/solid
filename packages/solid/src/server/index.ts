import { DEV as _DEV, type Dev } from "@solidjs/signals";

// From mock signals (same exports that index.ts pulls from @solidjs/signals)
export {
  $PROXY,
  $REFRESH,
  $TRACK,
  action,
  affects,
  createEffect,
  createMemo,
  createOptimistic,
  createOptimisticStore,
  createErrorBoundary,
  createOwner,
  creationStamp,
  createProjection,
  createReaction,
  createRenderEffect,
  createRevealOrder,
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
  isDisposed,
  isEqual,
  isPending,
  isWrappable,
  mapArray,
  merge,
  omit,
  onCleanup,
  onSettled,
  latest,
  storeIsShallow,
  storeHasFamily,
  storeHasOptimisticFamily,
  reconcile,
  refresh,
  repeat,
  resetErrorHalt,
  resolve,
  until,
  NotReadyError,
  TimeoutError,
  runInServerComponentScope,
  inServerComponentScope,
  getProjectionTrace,
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
  Refreshable,
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
export { $DEVCOMP, children, createContext, useContext } from "./core.js";
export type {
  ChildrenReturn,
  Context,
  ContextProviderComponent,
  ResolvedChildren,
  ResolvedElement
} from "./core.js";

// Component helpers and types
export * from "./component.js";

// Flow controls
export * from "./flow.js";
export type { ArrayElement, Element } from "../types.js";

// SSR coordination
export {
  sharedConfig,
  createLoadingBoundary,
  ssrHandleError,
  ssrScope,
  NoHydration,
  Hydration,
  NoHydrateContext
} from "./hydration.js";
export type { HydrationContext } from "./hydration.js";

/**
 * @internal — client-only (see client/hydration.ts). The server stub is
 * inert: nothing delivers a trace TO a server, so a marker passes through.
 */
export function materializeContainerTrace(marker: unknown): unknown {
  return marker;
}

// Dev — same shape as the client entry. `"_SOLID_DEV_"` is replaced per build
// (dist/server.dev.* → true, dist/server.* → false), so the dev artifact
// exposes @solidjs/signals' DEV object — its `diagnostics` channel is the bus
// server-side dev findings report through — and prod exports `undefined`.
// The server reimplements reactivity, so `DEV.attribution`/graph helpers
// have nothing to introspect here; the channel is what's shared.
const IS_DEV = "_SOLID_DEV_" as string | boolean;
export const DEV: Dev | undefined = IS_DEV ? _DEV : undefined;
