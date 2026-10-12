/**
 * `solid-js/internal` — the seams `@solidjs/web`, `@solidjs/universal`, and
 * the other runtimes in this repo consume from the core. NOT public API: no
 * semver guarantee, no docs, may change or vanish in any release.
 *
 * Two kinds of export live here, resolved two different ways so an app never
 * holds a second copy of any module state:
 *
 * 1. The merge()/omit() VIEW PROTOCOL — pure `@solidjs/signals`, re-exported
 *    as-is. `merge()`/`omit()` return lazy proxy views; `viewOf` gives the
 *    view record, whose `sources`/`kinds` (`SOURCE_*`) a consumer walks leaf
 *    by leaf with `sourceKeys`/`sourceHas`/`sourceGet` instead of trapping
 *    through the proxy key by key; `resolvedTable`/`hasStaticKeys` shortcut
 *    the walk when every leaf is a plain object. The runtimes depend on
 *    `solid-js` alone (never on `@solidjs/signals` directly), so this is how
 *    they reach the protocol while `solid-js`'s own surface stays `merge`,
 *    `omit`, and friends.
 *
 * 2. SERVER-SCOPE SEAMS — functions of the `solid-js` runtime itself (owner
 *    stacks, request scope, projection traces), real on the server entry and
 *    stubs on the client. They are read back from `"solid-js"` (external, so
 *    the platform/tier conditions pick the same build the app runs) and
 *    declared here with their signatures spelled out, because the main
 *    entries mark them `@internal` and strip them from their declarations.
 *    The boundary primitives behind `Errored`, `Loading`, and `Reveal` are
 *    read back the same way (real on both entries), for renderers that
 *    build boundaries without the components, and so are `sharedConfig`
 *    (the hydration/SSR coordination object) and the `$DEVCOMP` brand.
 *
 * Not here: the container-trace materializer. It lives in its own entry,
 * `solid-js/internal/container-trace`, so the store engine it builds on can
 * be a lazy chunk — a re-export from this (eagerly imported) module would
 * weld the engine back into the main chunk.
 */
import * as core from "solid-js";
import type {
  Accessor,
  Component,
  DynamicOptions,
  RevealOrder,
  ServerErrorHook,
  ServerErrorSite
} from "solid-js";
import type { HydrationContext } from "./server/shared.js";

export {
  mergeSources,
  mergeView,
  omitView,
  viewOf,
  OmitView,
  MergeView,
  sourceKeys,
  sourceHas,
  sourceGet,
  sourceOwners,
  hasStaticKeys,
  resolvedTable,
  SOURCE_PLAIN,
  SOURCE_OMIT,
  SOURCE_PROXY,
  SOURCE_MEMO,
  SOURCE_MERGE,
  type SourceKind
} from "@solidjs/signals";

/**
 * Server: a thrown `NotReadyError` becomes the promise to wait on (or, with
 * `probe`, is reported without rethrowing); anything else is rethrown or
 * routed to the owner's error handling. Client: no-op.
 */
export const ssrHandleError: (err: any, probe?: boolean) => Promise<any> | undefined =
  core.ssrHandleError as any;

/** Server: wrap `fn` to run under the current request's owner/scope. Client: identity. */
export const ssrScope: <T>(fn: () => T) => () => unknown = core.ssrScope;

/** Server: run `fn` inside the current server-component scope (`live` marks a live component's document render). Client: calls `fn`. */
export const runInServerComponentScope: <T>(fn: () => T, options?: { live?: boolean }) => T =
  core.runInServerComponentScope;

/** Server: whether a server-component scope is active. Client: `false`. */
export const inServerComponentScope: () => boolean = core.inServerComponentScope;

/** Server: whether a LIVE server component's document render scope is active. Client: `false`. */
export const inLiveServerComponentScope: () => boolean = core.inLiveServerComponentScope;

/**
 * Server: the value the client may see in place of a render failure about to
 * be serialized or rendered for it — the value itself in the dev build or
 * when branded with `markSafeError`, else one generic `Error` per original
 * (recorded once as `SERVER_ERROR_SANITIZED`, `data.source: "ssr"`). `subject` locates the finding;
 * `null` from a serialization funnel. With a `site`, the hook hears of it
 * first (`hook` as `reportServerError` takes it). Client: identity.
 */
export const ssrSanitizeError: (
  value: unknown,
  subject?: object | null,
  site?: ServerErrorSite,
  hook?: ServerErrorHook
) => unknown = core.ssrSanitizeError;

/**
 * Server: tells the server error hook about a failure — once per error
 * object, at first sight — with where it was met; `{ mapped: true, value }`
 * when the hook gave a wire value (now or earlier), `{ mapped: false }`
 * otherwise. `hook` is the hook of the render or request the failure
 * belongs to (a render's `onError`, the server-function handler's) — the
 * caller's to name, never read off the global SSR context — ahead of the
 * ambient registration; `undefined` leaves the ambient one alone.
 * Client: `{ mapped: false }`.
 */
export const reportServerError: (
  value: unknown,
  site: ServerErrorSite,
  subject?: object | null,
  hook?: ServerErrorHook
) => { mapped: boolean; value?: unknown } = core.reportServerError as any;
export type { ServerErrorSite, ServerErrorHook } from "solid-js";

/** Server: a monotonic stamp for owner creation order. Client: `0`. */
export const creationStamp: () => number = core.creationStamp;

/** Server: the live projection trace behind a value, if any. Client: `undefined`. */
export const getProjectionTrace: (
  value: unknown
) => { subscribe(): AsyncIterable<any>; array: boolean } | undefined = core.getProjectionTrace;

/**
 * Server: a seat on the shared multicast of an async iterable — every reader
 * under a render (the serializer, memos) sees the whole sequence. Client:
 * the source itself.
 */
export const shareAsyncIterable: <T>(source: AsyncIterable<T>) => AsyncIterable<T> =
  core.shareAsyncIterable;

/** The primitive behind `<Errored>`: `fn()`, or `fallback(error, reset)` once something under it throws. */
export const createErrorBoundary: <T, U>(
  fn: () => T,
  fallback: (error: Accessor<unknown>, reset: () => void) => U
) => Accessor<T | U> = core.createErrorBoundary;

/** The primitive behind `<Loading>`: `fallback()` while async reads under `fn` are pending, else `fn()`. */
export const createLoadingBoundary: <T, U>(
  fn: () => T,
  fallback: () => U,
  options?: { on?: () => any }
) => Accessor<T | U> = core.createLoadingBoundary;

/** The primitive behind `<Reveal>`: coordinates when the loading boundaries under `fn` reveal. */
export const createRevealOrder: <T>(
  fn: () => T,
  options?: { order?: () => RevealOrder; collapsed?: () => boolean }
) => T = core.createRevealOrder;

/**
 * The core behind `dynamicComponent` and `@solidjs/web`'s `dynamic`. `tagArm`
 * is the renderer's string-tag path (`staticElement` on the client,
 * `ssrElement` on the server); omit it and a string resolution renders
 * nothing. Not application API.
 */
export const dynamicCore: (
  source: () => any,
  options?: DynamicOptions,
  tagArm?: (tag: string, props: any) => any
) => Component<any> = core.dynamicCore;

/**
 * The shape `sharedConfig` has on either entry. The two objects share the
 * name, not the members: the client's carries hydration state, populated by
 * `enableHydration()` and the DOM runtime's `hydrate()`; the server's carries
 * the render's `context` and the id allocator. Every member is therefore
 * optional — a member is present only on the tier (and, for some, only in
 * the phase) that sets it.
 */
interface SharedConfig {
  /**
   * Both: the next hydration key under the current owner, `undefined` under
   * `NoHydration`. Server: always present. Client: assigned by
   * `enableHydration()`, read only behind a `hydrating` check.
   */
  getNextContextId?: () => string | undefined;
  /**
   * Both, dev builds only: the id `getNextContextId()` would hand out next,
   * read without consuming it (`undefined` outside an id-carrying tree).
   * Callers gate on `_SOLID_DEV_`.
   */
  devPeekNextContextId?: () => string | undefined;
  /** Server: the hydration context of the render in progress, absent outside one. */
  context?: HydrationContext;
  /** Client: whether a hydration pass is claiming server-rendered DOM right now. */
  hydrating?: boolean;
  /** Client: whether hydration has completed. */
  done?: boolean;
  resources?: { [key: string]: any };
  /** Client: reads a serialized value by id from the hydration payload. */
  load?: (id: string) => Promise<any> | any;
  /** Client: whether the hydration payload carries `id`. */
  has?: (id: string) => boolean;
  /** Client: collects the server-rendered nodes under the hydration root `key` into `registry`. */
  gather?: (key: string) => void;
  /** Client: the server-rendered nodes of the active root, by hydration key. */
  registry?: Map<string, object>;
  /**
   * Client: the registry/gather pair each streamed boundary registered
   * under, keyed by boundary id, so a late resume claims against its own root.
   */
  boundaryScopes?: Map<string, { registry?: Map<string, object>; gather?: (key: string) => void }>;
  captureBoundaryScope?: (id: string) => void;
  cleanupFragment?: (id: string) => void;
  loadModuleAssets?: (mapping: Record<string, string>) => Promise<void> | undefined;
  completed?: WeakSet<object> | null;
  events?: any[] | null;
  verifyHydration?: () => void;
  /** Client: whether a hydration pass is still claiming — absent means "not hydrating". */
  isHydrationInProgress?: () => boolean;
  /** Client: runs `callback` once all hydration completes — absent means it already has. */
  onHydrationEnd?: (callback: () => void) => void;
  /** Client: whether a render under the current owner is part of the claim in progress — absent means "claiming". */
  isClaiming?: () => boolean;
}

/**
 * The hydration/SSR coordination object the core shares with its renderers
 * — the client entry's or the server entry's, whichever the app runs.
 */
export const sharedConfig: SharedConfig = core.sharedConfig;

/**
 * Client: installs the server-component half of hydration on `sharedConfig`
 * and the page's `_$HY` — `holdBoundary` (a client hold on adopted markup
 * counted as a pending boundary, frames-rulings 3.1), `hydrateWindow` (the
 * claim window an adopted occurrence re-enters hydration through), fragment
 * ownership by rendering (the `_$HY.fa` term of the reveal policy) and the
 * ledger's published answer `_$HY.fr` ({ pending, subscribe }). For the
 * integration that owns server-rendered markup wholesale (`@solidjs/web/frames`'
 * `installServerComponents`), which calls it where it installs its reveal
 * hook; idempotent, before or after `hydrate()`. A page without server
 * components never calls it and carries none of it. Server: no-op.
 */
export const enableServerComponentHydration: () => void = core.enableServerComponentHydration;

/**
 * Dev builds: the brand the component wrapper sets on every component it
 * runs (`Comp[$DEVCOMP] === true`), read by the refresh runtime and
 * devtools. Other builds: a symbol nothing sets.
 */
export const $DEVCOMP: symbol = core.$DEVCOMP;
