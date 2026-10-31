export {
  $REFRESH,
  action,
  ContextNotFoundError,
  NoOwnerError,
  NotReadyError,
  TimeoutError,
  createContext,
  createOwner,
  createRoot,
  runWithOwner,
  flush,
  getNextChildId,
  peekNextChildId,
  getContext,
  setContext,
  getOwner,
  isDisposed,
  getObserver,
  isEqual,
  untrack,
  isPending,
  latest,
  SUPPORTS_PROXY,
  setSnapshotCapture,
  markSnapshotScope,
  releaseSnapshotScope,
  clearSnapshots,
  enforceLoadingBoundary,
  enableExternalSource,
  resetErrorHalt,
  configureClientErrors,
  ROOT_ERROR_HOOK
} from "./core/index.js";
/**
 * @internal The dev console footer seam — registered by `solid-js`, which
 * owns the repair skill the footer points at. Not part of `DEV`; a no-op
 * outside dev builds.
 */
export { setConsoleFooter } from "./core/index.js";
/** @internal The flush round counter (scheduler.ts): hydration's served pass tells its own round from a later one. */
export { clock } from "./core/index.js";
/** @internal Dev duplicate-copy check: solid-js marks components and context reads. */
export { runAsSolidCopy, checkForeignOwnerless } from "./core/copies.js";
/** @internal Dev CAUGHT_REACTIVE_READ (D-42): a runtime catch of a reactive read's throw — solid-js's hydration trace and warm-up — is not a user catch. A no-op outside dev builds. */
export { forgetThrownRead } from "./core/dev.js";
/** @internal The pre-write hook (`setWriteHook` in core/core.ts); the server-components client's deferred hydration. */
/** @internal Plain-signal identities and the dev read watch (dependency edges; the server-components client). */
export { setWriteHook, setSignalIdentities, setReadWatch, signalName } from "./core/index.js";
/** @internal Store dependency edges: the name a store proxy's writes go by (the server-components client). */
export { storeName } from "./store/edges.js";
import { DEV as _DEV, OBSERVE as _OBSERVE, type Dev, type Observe } from "./core/index.js";
/**
 * Observe tier (diagnostics channel, attribution hook slot + interaction
 * frame): dev and observe builds. The attribution engine itself is the
 * `@solidjs/signals/attribution` entry.
 */
export const OBSERVE: Observe | undefined = __OBSERVE__ ? _OBSERVE : undefined;
/** Dev tier (devtools hooks, graph traversal, console reporting): dev builds only. */
export const DEV: Dev | undefined = __DEV__ ? _DEV : undefined;
export type {
  Owner,
  Context,
  ContextRecord,
  IQueue,
  ExternalSourceFactory,
  ExternalSource,
  ExternalSourceConfig,
  Refreshable,
  AttributionSlot,
  ClientErrorContext,
  ClientErrorHook,
  ClientErrorsConfig,
  InteractionRef,
  NavigationRef,
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
  RecordSubscribeOptions,
  DevHooks,
  DiagnosticCapture,
  DiagnosticCode,
  DiagnosticEvent,
  DiagnosticKind,
  DiagnosticListener,
  Diagnostics,
  DiagnosticSeverity,
  DiagnosticSubject
} from "./core/index.js";
export {
  createSignal,
  createOptimistic,
  createMemo,
  createEffect,
  createRenderEffect,
  createTrackedEffect,
  createReaction,
  refresh,
  resolve,
  until,
  onSettled,
  onFlush,
  onCleanup
} from "./signals.js";
export type {
  Truthy,
  UntilOptions,
  Accessor,
  SourceAccessor,
  Setter,
  Signal,
  ComputeFunction,
  EffectFunction,
  EffectBundle,
  EffectOptions,
  SignalOptions,
  MemoOptions,
  NoInfer
} from "./signals.js";
export { mapArray, repeat, type Maybe } from "./map.js";
export * from "./store/index.js";
export { affects } from "./affects.js";
export { createDeferred } from "./deferred.js";
export { from, type FromSource } from "./from.js";
export { flatten } from "./flatten.js";
export { createLoadingBoundary, createErrorBoundary } from "./boundaries.js";
export { createRevealOrder, type RevealOrder } from "./reveal.js";
