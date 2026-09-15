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
  createErrorBoundary,
  createOwner,
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
// The observe/dev surface's types, as the client entry exports them — the
// same names resolve whichever entry a server-side consumer's types come from.
export type {
  Dev,
  Observe,
  ServerObserve,
  Diagnostics,
  DiagnosticCapture,
  DiagnosticCode,
  DiagnosticEvent,
  DiagnosticKind,
  DiagnosticListener,
  DiagnosticSeverity,
  DiagnosticSubject
} from "@solidjs/signals";
// The server surface this entry declares onto `OBSERVE.server`, and the
// record it emits — `OBSERVE.server.records.subscribe("boundary", …)`.
export type {
  BoundaryEvent,
  BoundaryLive,
  BoundaryListener,
  ServerRecords,
  ServerTrace
} from "./observe.js";

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
export { sharedConfig, createLoadingBoundary, NoHydration, Hydration } from "./hydration.js";
export type { HydrationContext } from "./hydration.js";

// Seams for the runtimes in this repo, reached through `solid-js/internal`
// (src/internal.ts): exported here at runtime so that entry shares this
// module's state, `@internal` so they are stripped from the declarations.
/** @internal */
export {
  creationStamp,
  runInServerComponentScope,
  inServerComponentScope,
  getProjectionTrace
} from "./signals.js";
/** @internal */
export { ssrHandleError, ssrScope } from "./hydration.js";

/**
 * @internal — client-only (see client/hydration.ts). The server stub is
 * inert: nothing delivers a trace TO a server, so a marker passes through.
 */
export function materializeContainerTrace(marker: unknown): unknown {
  return marker;
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
if (IS_OBSERVE) _OBSERVE!.server = serverSlots();
export const OBSERVE: Observe | undefined = IS_OBSERVE ? _OBSERVE : undefined;
export const DEV: Dev | undefined = IS_DEV ? _DEV : undefined;
// The console face is the core's; the repair-guide footer under each first
// report is this package's (console-footer.ts), installed here as on the client
// so a server render's `[SERVER_WRITE]` points at the same skill section.
if (IS_DEV) installConsoleFooter(_DEV!);
