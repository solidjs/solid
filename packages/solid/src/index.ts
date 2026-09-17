export {
  $PROXY,
  $TRACK,
  action,
  affects,
  createOwner,
  createReaction,
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
  isStatic,
  omit,
  onCleanup,
  onSettled,
  latest,
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
  untrack,
  configureClientErrors
} from "@solidjs/signals";
/** @internal — the key a root owner carries `render`'s `onError` under, for the web runtime. */
export { ROOT_ERROR_HOOK } from "@solidjs/signals";

export type {
  ClientErrorContext,
  ClientErrorHook,
  ClientErrorsConfig,
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
  createRoot,
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
  Hydration
} from "./client/hydration.js";
// Seams for the runtimes in this repo, reached through `solid-js/internal`
// (src/internal.ts): exported here at runtime so that entry shares this
// module's state, `@internal` so they are stripped from the declarations.
/** @internal */
export { materializeContainerTrace } from "./client/hydration.js";
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
/** @internal — server-only: the client has no wire to sanitize for. */
export function ssrSanitizeError(value: unknown): unknown {
  return value;
}
/** @internal — server-only: the server error hook has no client half here. */
export function reportServerError(): { mapped: boolean; value?: unknown } {
  return { mapped: false };
}
/** Where a server failure was met, as the server error hook hears it (see `@solidjs/web`'s `ServerErrorContext`). */
export interface ServerErrorSite {
  kind: "render" | "server-function";
  handling: "fallback" | "client" | "failed" | "serialize" | "thrown" | "channel";
  boundary?: string;
  /** Where the error was thrown — labels root-first up the owner chain it escaped. */
  ownerPath?: string[];
  /** Where it was met — the labels up the chain of the boundary named by `boundary`. */
  boundaryPath?: string[];
  functionId?: string;
  direct?: boolean;
  /** The request event, when the caller has it in hand; else read from the request scope. */
  event?: unknown;
}
export type ServerErrorHook = (error: unknown, context: ServerErrorSite) => unknown | void;
/** @internal — server-only: on the client no value carries a trace. */
export function getProjectionTrace(
  value: unknown
): { subscribe(): AsyncIterable<any>; array: boolean } | undefined {
  return undefined;
}

// Observe / dev tiers — re-exported from @solidjs/signals so an app imports
// one thing. `IS_OBSERVE`/`IS_DEV` are replaced per build; the observe
// build resolves signals through the `observe` condition so the two agree.
import { IS_DEV, IS_OBSERVE } from "./client/core.js";
import { DEV as _DEV, OBSERVE as _OBSERVE, type Dev, type Observe } from "@solidjs/signals";
import { installConsoleFooter } from "./console-footer.js";
export const OBSERVE: Observe | undefined = IS_OBSERVE ? _OBSERVE : undefined;
export const DEV: Dev | undefined = IS_DEV ? _DEV : undefined;
// The types a runtime, router or observability adapter names when it talks to
// the tiers: the refs it hands `withInteraction`/`withOrigin`, the channel's
// event, and the records the attribution engine delivers. Here so the code
// that reaches for `OBSERVE.attribution.withOrigin` finds `NavigationRef`
// beside it; the engine's full surface stays on `solid-js/attribution`.
export type {
  Dev,
  Observe,
  ServerObserve,
  Records,
  RecordTypes,
  HostRecordTypes,
  RecordType,
  RecordEvent,
  RecordLive,
  RecordListener,
  AttributionHooks,
  AttributionSlot,
  InteractionRef,
  NavigationRef,
  OriginRef,
  Diagnostics,
  DiagnosticCapture,
  DiagnosticCode,
  DiagnosticEvent,
  DiagnosticKind,
  DiagnosticListener,
  DiagnosticSeverity,
  DiagnosticSubject
} from "@solidjs/signals";
// The server runtime's observe types — the `"boundary"` record it emits on
// `OBSERVE.records` and the member it declares onto `OBSERVE.server`
// (`trace`) — and with them the `RecordTypes`/`ServerObserve` augmentations
// that module declares: the published types resolve to THIS entry under
// every condition, so this re-export is what puts them in an observer's
// program (and what `@solidjs/web` builds on, augmenting `HostRecordTypes`
// and `ServerTrace` through `"solid-js"`). Type-only — the module's runtime
// never enters the client build.
export type {
  BoundaryEvent,
  BoundaryLive,
  BoundaryListener,
  ServerTrace
} from "./server/observe.js";
export type {
  Acknowledgement,
  AttributionRecords,
  AttributionRecordType,
  ChangeOrigin,
  ChangeRecord,
  HeldWrite,
  HoldEvent,
  InteractionEvent,
  NavigationEvent,
  NavigationHop,
  RerunEvent
} from "@solidjs/signals/attribution";

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
// gains a footer naming the repair skill shipped with this package — see
// console-footer.ts (shared with the server entry).
if (IS_DEV && _DEV) installConsoleFooter(_DEV);

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
