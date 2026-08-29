export {
  $PROXY,
  $REFRESH,
  $TRACK,
  action,
  affects,
  createOwner,
  createReaction,
  createRoot,
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
  // Patch-channel compiler contract (undocumented as application API)
  patchableRaw,
  patchProxyFor,
  registerPatch,
  registerRowOps,
  registerSlotPatch,
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
  runWithOwner,
  enableExternalSource,
  enforceLoadingBoundary,
  snapshot,
  storePath,
  untrack
} from "@solidjs/signals";

export type {
  Accessor,
  ComputeFunction,
  EffectBundle,
  EffectFunction,
  EffectOptions,
  ExternalSource,
  ExternalSourceConfig,
  ExternalSourceFactory,
  Merge,
  MemoOptions,
  NoInfer,
  NotWrappable,
  Omit,
  Owner,
  ProjectionOptions,
  Refreshable,
  Signal,
  SignalOptions,
  SourceAccessor,
  Setter,
  Store,
  Truthy,
  UntilOptions,
  StoreReturn,
  ProjectionStoreReturn,
  StoreOptions,
  SolidStore,
  StoreNode,
  StoreSetter,
  StorePathRange,
  ArrayFilterFn,
  CustomPartial,
  Part,
  PathSetter
} from "@solidjs/signals";

// needs wrappers
export { $DEVCOMP, children, createContext, useContext } from "./client/core.js";

export type {
  ChildrenReturn,
  Context,
  ContextProviderComponent,
  ResolvedChildren,
  ResolvedElement
} from "./client/core.js";

export * from "./client/component.js";
export * from "./client/flow.js";
export type { ArrayElement, Element } from "./types.js";
export {
  sharedConfig,
  enableHydration,
  createErrorBoundary,
  createLoadingBoundary,
  createRevealOrder,
  createMemo,
  createSignal,
  createStore,
  createProjection,
  createOptimistic,
  createOptimisticStore,
  createRenderEffect,
  createEffect,
  NoHydration,
  Hydration,
  NoHydrateContext,
  materializeContainerTrace
} from "./client/hydration.js";
// Stub exports — only meaningful on the server entry; the client entry
// satisfies the export surface so isomorphic builds don't break.
/** @internal */
export function ssrHandleError() {}
/** @internal */
export function ssrScope<T>(fn: () => T): () => T {
  return fn;
}
/** @internal */
export function runInServerComponentScope<T>(fn: () => T): T {
  return fn();
}
/** @internal */
export function creationStamp(): number {
  return 0;
}
/** @internal */
export function inServerComponentScope(): boolean {
  return false;
}
/** @internal — server-only: on the client no value carries a trace. */
export function getProjectionTrace(
  value: unknown
): { subscribe(): AsyncIterable<any>; array: boolean } | undefined {
  return undefined;
}

// dev
import { IS_DEV } from "./client/core.js";
import { DEV as _DEV, type Dev } from "@solidjs/signals";
export const DEV: Dev | undefined = IS_DEV ? _DEV : undefined;

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

// Point-of-pain discovery: the first console report of each diagnostic code
// gains a footer naming the repair skill shipped with this package, so a
// reader (human or agent) hitting the warning learns where the prescribed
// fix lives without any prior knowledge of the skill system.
if (IS_DEV && _DEV) {
  _DEV.diagnostics.setConsoleFooter(
    event =>
      `[${event.code}] repair guide: node_modules/solid-js/skills/reactivity-diagnostics/SKILL.md`
  );
}

/* Not Implemented
export {
  batch, // flush
  catchError, // old version handled by createErrorBoundary. new version is different helper.
  createComputed, // nope
  createDeferred, // take it outside
  createResource, // all computations
  createSelector, // createProjection
  DevHooks,
  enableScheduling,
  equalFn, // renamed `isEqual`
  from, // handled by async iterators
  getListener, // renamed `getObserver`
  indexArray, // handled in `mapArray`
  Index, // handled by For
  observable, // handled by async iterators
  on, // with split effects this doesn't need to be core
  onError, // handled by ErrorBoundary
  onMount, // onSettled
  resetErrorBoundaries, // no longer needed with healing
  startTransition,
  Suspense, // Loading
  SuspenseList, // replaced by Reveal + createRevealOrder
  useTransition,
  writeSignal, // handled by underlying Node class, should have never been external

  // Store related to legacy syntax
  createMutable,
  modifyMutable,
  produce, // now default
  unwrap, // snapshot
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
