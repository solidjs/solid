import { DEV as _DEV, OBSERVE as _OBSERVE, type Dev, type Observe } from "@solidjs/signals";
import { serverSlots } from "./observe.js";
import { installConsoleFooter } from "../console-footer.js";

// From mock signals (same exports that index.ts pulls from @solidjs/signals)
export {
  $PROXY,
  $TRACK,
  action,
  affects,
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
  snapshot,
  createDeepProxy,
  enableExternalSource,
  enforceLoadingBoundary,
  untrack,
  configureClientErrors,
  ROOT_ERROR_HOOK
} from "./signals.js";
export type { ClientErrorContext, ClientErrorHook, ClientErrorsConfig } from "./signals.js";

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
// The observe/dev surface's types, as the client entry exports them — the
// same names resolve whichever entry a server-side consumer's types come from.
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
  Diagnostics,
  DiagnosticCapture,
  DiagnosticCode,
  DiagnosticEvent,
  DiagnosticKind,
  DiagnosticListener,
  DiagnosticSeverity,
  DiagnosticSubject
} from "@solidjs/signals";
// The record this entry emits — `OBSERVE.records.subscribe("boundary", …)`
// — and the surface it declares onto `OBSERVE.server`.
export type { BoundaryEvent, BoundaryLive, BoundaryListener, ServerTrace } from "./observe.js";

// Wrappers — context, children
export { children, createContext, useContext } from "./core.js";
export type {
  ChildrenReturn,
  Context,
  ContextProviderComponent,
  ResolvedChildren,
  ResolvedElement
} from "./core.js";

// Component helpers and types
export * from "./component.js";
export { dynamicComponent, type DynamicOptions } from "./dynamic.js";
/** @internal — tag-arm core behind `dynamicComponent` and `@solidjs/web`'s `dynamic`. */
export { dynamicCore } from "./dynamic.js";

// Flow controls
export * from "./flow.js";
export type { ArrayElement, Element } from "../types.js";

// SSR coordination
export { NoHydration, Hydration, isHydrating, isHydratable } from "./hydration.js";
export type { HydrationContext } from "./hydration.js";

// Seams for the runtimes in this repo, reached through `solid-js/internal`
// (src/internal.ts): exported here at runtime so that entry shares this
// module's state, `@internal` so they are stripped from the declarations.
/** @internal */
export { sharedConfig, createLoadingBoundary } from "./hydration.js";
/** @internal */
export { $DEVCOMP } from "./core.js";
// The boundary primitives behind `Errored` and `Reveal` (`Loading`'s is the
// SSR-aware one above), `@internal` as on the client entry.
/** @internal */
export { createErrorBoundary, createRevealOrder } from "./signals.js";
/** @internal */
export {
  creationStamp,
  runInServerComponentScope,
  inServerComponentScope,
  inLiveServerComponentScope,
  getProjectionTrace,
  shareAsyncIterable,
  ssrSanitizeError,
  reportServerError
} from "./signals.js";
export type { ServerErrorSite, ServerErrorHook } from "./signals.js";
/** @internal */
export { ssrHandleError, ssrScope } from "./hydration.js";
// After the runtime modules above, so this import adds no edge to the module
// graph's evaluation order (shared.js is long loaded) and the prod artifact
// is unchanged.
import { installServerWithOrigin } from "./shared.js";

// The container-trace materializer's seams (client/hydration.ts; consumed by
// `solid-js/internal/container-trace`, a client-only entry): the patch
// protocol, and the hydration helpers the store adapter copy that entry
// bundles (client/store-hydration.ts) reads off the `solid-js` namespace.
// Mirrored here for export parity (test/server/export-parity.spec), inert:
// nothing delivers a trace TO a server, so nothing applies a patch batch,
// and the adapter is never called on this entry (`sharedConfig.hydrating` is
// not a member of the server's sharedConfig) — the helpers below are the
// shapes they have with no hydration in progress.
/** @internal */
export function applyPatches(_target: any, _patches: any[]): void {}
/** @internal */
export function readSerializedOrCompute(compute: (prev: any) => any, prev: any): any {
  return compute(prev);
}
/** @internal */
export function subFetch<T>(fn: (prev?: T) => any, prev?: T): any {
  return fn(prev);
}
/** @internal */
export function readHydratedValue(initP: any): any {
  return initP;
}
/** @internal */
export function wrapFirstYield(iterable: any): any {
  return iterable;
}
/** @internal */
export function adoptedAnswerStream(thenable: any): any {
  return thenable;
}
/** @internal */
export function withHydrationGate(create: (hydrated: () => boolean) => any): any {
  return create(() => true);
}
/** @internal */
export function onHydrationEnd(callback: () => void): void {
  queueMicrotask(callback);
}
/** @internal */
export function noHydrationId(): boolean {
  return true;
}
/** @internal */
export function markTopLevelSnapshotScope(): void {}
/** @internal */
export function hasLoadingWindow(options: any): boolean {
  return (
    options != null &&
    typeof options === "object" &&
    ("loadingValue" in options || options.seedLoadingValue === true)
  );
}
/** @internal */
export function isAsyncIterable(v: any): boolean {
  return v != null && typeof v[Symbol.asyncIterator] === "function";
}
/** @internal */
export function syncThenable(value: any): { then(fn: (value: any) => void): void } {
  return {
    then(fn) {
      fn(value);
    }
  };
}
/** @internal */
export const UNASKED: PromiseLike<never> = { then() {} } as any;
/** @internal */
export function forwardIteratorReturn(it: any, value?: any): any {
  return Promise.resolve(it.return ? it.return(value) : { done: true, value });
}

// Observe / dev — same shape as the client entry. Both literals are replaced
// per build (dist/server.dev.* → both true, dist/server.* → both false; a
// server.observe.* arrives with the first server wiring site), so the dev
// artifact exposes @solidjs/signals' OBSERVE object — its `diagnostics`
// channel is the bus server-side findings report through — and prod exports
// `undefined`. The server reimplements reactivity, so attribution and the
// graph helpers have nothing to introspect here; the channel is what's shared.
//
// `OBSERVE.server` is the one member this entry fills in: the core ships it
// empty and the process-wide slots (see observe.ts) replace it here, so they
// exist for anything that imports `solid-js` on the server — before, and
// regardless of, the web runtime that emits into them.
const IS_DEV = "_SOLID_DEV_" as string | boolean;
const IS_OBSERVE = "_SOLID_OBSERVE_" as string | boolean;
if (IS_OBSERVE) {
  _OBSERVE!.server = serverSlots();
  installServerWithOrigin(_OBSERVE!);
}
export const OBSERVE: Observe | undefined = IS_OBSERVE ? _OBSERVE : undefined;
export const DEV: Dev | undefined = IS_DEV ? _DEV : undefined;
// The console face is the core's; the repair-guide footer under each first
// report is this package's (console-footer.ts), installed here as on the client
// so a server render's `[SERVER_WRITE]` points at the same skill section.
if (IS_DEV) installConsoleFooter();
