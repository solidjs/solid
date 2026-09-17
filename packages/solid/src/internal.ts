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
 */
import * as core from "solid-js";
import type { ServerErrorHook, ServerErrorSite } from "solid-js";

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

/** Server: run `fn` inside the current server-component scope. Client: calls `fn`. */
export const runInServerComponentScope: <T>(fn: () => T) => T = core.runInServerComponentScope;

/** Server: whether a server-component scope is active. Client: `false`. */
export const inServerComponentScope: () => boolean = core.inServerComponentScope;

/**
 * Server: the value the client may see in place of a render failure about to
 * be serialized or rendered for it — the value itself in the dev build or
 * when branded with `markSafeError`, else one generic `Error` per original
 * (recorded once as `SSR_ERROR_SANITIZED`). `subject` locates the finding;
 * `null` from a serialization funnel. Client: identity.
 */
export const ssrSanitizeError: (
  value: unknown,
  subject?: object | null,
  site?: ServerErrorSite
) => unknown = core.ssrSanitizeError;

/**
 * Server: tells the server error hook about a failure — once per error
 * object, at first sight — with where it was met; `{ mapped: true, value }`
 * when the hook gave a wire value (now or earlier), `{ mapped: false }`
 * otherwise. `hook` is a per-request override ahead of the SSR context's
 * `errorPolicy` and the ambient registration. Client: `{ mapped: false }`.
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

/** Client: rebuild a store from a serialized container-trace marker. Server: stub. */
export const materializeContainerTrace: (marker: {
  $tr: AsyncIterable<any> | { __SEROVAL_STREAM__: true };
  $ta?: number;
}) => unknown = core.materializeContainerTrace as any;
