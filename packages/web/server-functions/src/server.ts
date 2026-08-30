// @ts-nocheck
// Server half of the server function runtime ABI. Compiled server output
// calls `registerServerReference(id, fn)` for every server function
// (registering it for HTTP dispatch) and `createServerReference(ref)` where
// the function was referenced — during SSR the original function runs
// in-process under a per-call request event.
//
// The HTTP handler is web-standard (Request -> Response); platform adapters
// (h3, express, ...) and framework policies layer on through the exposed
// hooks. The line between them is the one the single-flight header already
// draws: core owns the wire shapes both peers must agree on — the flight
// envelope, the flash cookie, folding cookies for work re-run after a
// mutation — and never what they carry. Which data a mutation invalidates,
// and how an outcome reaches the UI, stay with the integration.
import {
  NULL_BODY_STATUSES,
  REVALIDATE_HEADER,
  isResponseEnvelope,
  isSafeError
} from "../../src/response.js";
import { RequestContext, commitEventResponse, getRequestEvent } from "../../src/server.js";
import { encodeFlashCookie } from "./flash.js";
import {
  BODY_FORMAT_HEADER,
  BodyFormat,
  ERROR_HEADER,
  INSTANCE_HEADER,
  LIVE_SOURCE,
  SERVER_FUNCTION_INVOKE,
  SERVER_FUNCTION_METADATA,
  SINGLE_FLIGHT_HEADER,
  UNKNOWN_HEADER,
  assertFlightSource,
  configureServerFunctionsCodec,
  decodeResponse,
  deserializeString,
  encodeErrorHeaderValue,
  extractBody,
  getHeadersAndBody,
  getServerFunctionMetadata,
  getServerFunctionsCodec,
  isJSONSafe,
  isServerFunction,
  parseServerFunctionAddress,
  provideServerFunctionRPC,
  serverFunctionAddress,
  createChunk,
  withMeta
} from "./shared.js";

export {
  ERROR_HEADER,
  FLASH_COOKIE,
  INSTANCE_HEADER,
  SERVER_FUNCTION_INVOKE,
  SINGLE_FLIGHT_HEADER,
  UNKNOWN_HEADER,
  clearFlashCookie,
  decodeErrorHeaderValue,
  decodeResponse,
  decodeResponsePayload,
  encodeErrorHeaderValue,
  getServerFunctionMetadata,
  hasFlashCookie,
  invoke,
  isServerFunction,
  subscribeFlightData,
  withMeta
} from "./shared.js";
export { decodeFlashCookie, encodeFlashCookie } from "./flash.js";

import { ResponseEnvelope } from "../../src/response.js";

import { JSONCodecOptions } from "../../serialization/src/serializer-decode.js";

import { RequestEvent } from "../../src/server.js";

export type {
  FlightDataConsumer,
  FlightDataContext,
  InvokeOptions,
  ServerFunction,
  ServerFunctionInvoker,
  ServerFunctionMetadata,
  SingleFlightPayload
} from "./shared.js";

export type { FlashSubmission } from "./flash.js";

/**
 * The request event a server function call runs under: the base
 * `RequestEvent` (request + locals) with `serverOnly` added, set when the
 * call is an in-process SSR invocation whose result never serializes to a
 * client.
 */
export interface ServerFunctionEvent extends RequestEvent {
  serverOnly?: boolean;
}

/**
 * What a server function call resolved to, as seen by the single-flight
 * hook — enough context for any data-production strategy without core
 * assuming one.
 */
export interface ServerFunctionOutcome {
  /** The build-stable id of the function that ran. */
  id: string;
  /**
   * The value the caller will receive: the raw return for plain results,
   * the unwrapped `value` for `ResponseEnvelope`s, `null` for body-less
   * control-flow `Response`s (redirect/reload).
   */
  value: unknown;
  /**
   * The `Response` carrying the result's HTTP metadata, when there is one
   * (from a returned/thrown `Response` or a `ResponseEnvelope`). Read
   * `Location` here for redirect-with-data — the data should describe the
   * destination route — and `X-Revalidate` for the invalidated keys.
   * Undefined for plain values.
   */
  response: Response | undefined;
  /**
   * The original HTTP request, untouched: headers the client integration
   * sent (referrer, custom route context) ride here for the hook to read —
   * core assigns them no meaning.
   */
  request: Request;
  /** Whether the result was thrown rather than returned. */
  thrown: boolean;
  /**
   * The URL the client will show after the mutation — the redirect
   * `Location` when the outcome carries one (resolved against the request
   * URL, as a browser would), the referring page otherwise. Undefined
   * without a usable referer (a non-browser caller has no page to produce
   * data for) and for redirects leaving the app's origin: produce no data
   * when this is undefined.
   */
  targetUrl: string | undefined;
  /**
   * The outcome's `X-Revalidate` keys, split — the invalidation scope the
   * mutation declared. Undefined when the outcome carries none (integrations
   * typically collect everything for the target in that case).
   */
  revalidateKeys: string[] | undefined;
  /**
   * The request headers with the mutation's cookie effects applied: the
   * event response's `Set-Cookie`s (set during the call), then the
   * outcome's own (e.g. `redirect(to, { headers })`), later winning on
   * conflict, deletions honored. Build the data-collection request from
   * these so re-run reads observe post-mutation cookie state.
   */
  foldedHeaders: Headers;
}

/**
 * The single-flight server hook: given the request event and the function's
 * outcome, optionally produce a data payload (possibly async) to fold into
 * the response alongside the return value. Data production is a black box
 * to the protocol — render data-only, run route preloads, query a cache,
 * whatever the integration chooses; the payload just has to be
 * codec-serializable. Return undefined to send the response unchanged
 * (byte-identical to a call without the hook).
 *
 * Runs after `transformResult`, only for scripted calls that sent
 * `SINGLE_FLIGHT_HEADER` on the request, on returned results and thrown
 * `Response`/`ResponseEnvelope` control-flow signals alike (plain thrown
 * errors never collect, and neither do raw body-carrying `Response` values
 * — those are the caller's verbatim payload). The handler owns the
 * enveloping: contributed data ships as `{ value, data }` under the
 * single-flight response header. The generic halves of collection arrive
 * pre-digested on the outcome (`targetUrl`, `revalidateKeys`,
 * `foldedHeaders`); the hook supplies only the data strategy.
 */
export type CollectFlightDataHook = (
  event: ServerFunctionEvent,
  outcome: ServerFunctionOutcome
) => unknown | Promise<unknown>;

/**
 * Wraps a server function execution — the per-invocation seam for
 * framework policies (per-function middleware, auth, logging, error
 * mapping). Called inside the call's event scope with the invocation
 * identity already established: `getServerFunctionInvocation()` answers
 * before, during and after `run()`. Must return (or resolve to) `run()`'s
 * result — replacing it replaces the function's result; throwing routes
 * through the handler's normal error encoding.
 *
 * The context carries the call's identity (`id`, parsed `args`), its
 * `event`, and how it arrived: `direct` is `true` for in-process SSR calls
 * (where `request` is absent) and `false` for HTTP dispatch. On the direct
 * path the wrapper must stay transparent for synchronous functions —
 * return `run()`'s value, not an unconditional promise, unless it needs to
 * be async.
 */
export type WrapInvocationHook = (
  run: () => unknown,
  context: {
    id: string;
    args: unknown[];
    event: ServerFunctionEvent;
    request?: Request;
    direct: boolean;
  }
) => unknown;

/** Options for `createNoJSHandler`. */
export interface NoJSHandlerOptions {
  /** The app's mount path, for resolving a relative redirect `Location`. */
  base?: string;
}

export type ServerFunctionOriginMatcher =
  | string
  | readonly string[]
  | ((origin: string, request: Request) => boolean | Promise<boolean>);

/** Same-origin validation options for server function requests. */
export interface ServerFunctionCSRFOptions {
  /**
   * Expected public origin. Defaults to the incoming request URL's origin.
   * A function can validate origins dynamically for multi-tenant hosts.
   */
  origin?: ServerFunctionOriginMatcher;
  /**
   * Allows requests without `Sec-Fetch-Site`, `Origin`, or `Referer`.
   * Cross-origin metadata is still rejected.
   * @default false
   */
  allowRequestsWithoutOriginCheck?: boolean;
}

/** Options for `configureServerFunctionsServer`. */
export interface ServerFunctionsServerConfig {
  /**
   * Establishes the request-event scope for a call — the function passed
   * runs with `event` visible to `getRequestEvent()`. Wire it to
   * `provideRequestEvent` from `@solidjs/web/storage` (or the framework's
   * equivalent). When omitted, falls back to the AsyncLocalStorage instance
   * an established request scope parks on the global.
   */
  provideEvent?: <T>(event: ServerFunctionEvent, fn: () => T) => T;
  /**
   * Wraps every server function execution — HTTP dispatch and direct SSR
   * calls alike — with the invocation identity already established (see
   * `WrapInvocationHook`). The per-invocation seam for framework policies:
   * per-function middleware, auth, logging, error mapping. A per-request
   * option overrides it for HTTP dispatch.
   */
  wrapInvocation?: WrapInvocationHook;
  /**
   * The unnamed single-flight hook: produces the data payload folded into
   * responses of calls that opted in (see `CollectFlightDataHook`).
   * Registered once by the integration that owns data production (a
   * router); per-handler `collectFlightData` options override it. Other
   * integrations contribute additively through
   * `registerFlightDataSource(id, hook)` instead of competing for this
   * slot.
   */
  collectFlightData?: CollectFlightDataHook;
  /**
   * Server-wide default for the handler's `transformResult` (same contract
   * — see `HandleServerFunctionRequestOptions`); a per-request option
   * overrides it. Registering it here makes result policies (e.g. frames'
   * `frameTransformResult`) work through generic dispatchers that call
   * `handleServerFunctionRequest(request)` with no options.
   */
  transformResult?(
    event: ServerFunctionEvent,
    result: unknown,
    context: {
      id: string;
      args: unknown[];
      instance: string | null;
      request: Request;
      thrown?: boolean;
    }
  ): unknown | ResponseEnvelope | Promise<unknown | ResponseEnvelope>;
  /**
   * `transformResult`'s counterpart for the single-flight fold: when a
   * call's flight payload needs a body only a policy knows how to build
   * (frames' `frameTransformFlightResult` — an invalidated entry is
   * markup), this gets first refusal on the `{ value, data }` outcome.
   * Return a `Response` to carry the outcome (call headers and cookies are
   * copied onto it), or `undefined` to decline and keep the plain
   * serialized envelope. A per-request option overrides it.
   */
  transformFlightResult?(
    event: ServerFunctionEvent,
    outcome: { value: unknown; data: unknown },
    context: { id: string; args: unknown[]; instance: string | null; request: Request }
  ): Response | undefined | Promise<Response | undefined>;
  /**
   * The in-process mirror of `transformResult` for direct (same-server)
   * calls during document SSR — e.g. frames' `frameTransformDirectResult`.
   */
  transformDirectResult?(
    value: unknown,
    options: { id: string; args: unknown[]; event: ServerFunctionEvent }
  ): unknown;
  /**
   * Server-wide response builder for calls made without the client runtime
   * (see `handleNoJS` in `HandleServerFunctionRequestOptions`); a
   * per-request option overrides it. Set it to `createNoJSHandler({ base })`
   * to apply the convention to every non-scripted call rather than only to
   * browser form posts, to a handler of your own to replace it, or to
   * `null` to disable the built-in convention and answer form posts with
   * the plain serialized response.
   */
  handleNoJS?:
    | ((
        result: unknown,
        request: Request,
        args: unknown[],
        thrown?: boolean
      ) => Response | Promise<Response>)
    | null;
  /**
   * Mount path the HTTP handler answers on. Must match the client
   * configuration — the id travels as the segment after it, a request whose
   * path does not start with it is not a call, and SSR'd reference `url`s
   * (e.g. form actions) derive from it. Prefix it when the app serves from
   * a base path (e.g. `` `${BASE_URL}_server` ``).
   * @default "/_server"
   */
  endpoint?: string;
  /**
   * Same-origin protection for HTTP server function calls. Enabled by
   * default. Set to `false` only when another trusted layer protects the
   * endpoint.
   */
  csrf?: boolean | ServerFunctionCSRFOptions;
  /**
   * Codec options (extra plugins etc.) for decoding arguments and encoding
   * results — must match the client's. Stored in the shared layer, so
   * `decodeResponse` sees them too.
   */
  codec?: JSONCodecOptions;
}

/**
 * A registered server function: its build-stable id paired with the
 * original implementation. Returned by `registerServerReference` and
 * consumed by the server-side `createServerReference`.
 *
 * Compiler ABI shape; hand-written code rarely constructs these.
 * @internal
 */
export interface ServerFunctionReference<T extends any[] = any[], R = any> {
  id: string;
  fn: (...args: T) => R;
  /**
   * The function's source name, emitted by development builds only —
   * `createServerReference` seeds the metadata channel with it.
   * @internal
   */
  name?: string;
}

/** Wire-state transitions a live call's iterable can report (client side).
 * `"closed"` carries the error when a definite rejection (4xx) ended the
 * call instead of the retry loop. */
export type LiveSourceStatus = "connected" | "reconnecting" | "closed";

/**
 * Type-level mirror of the client's live answer shape so isomorphic code
 * assigning `onstatus` typechecks against either build's declarations. On
 * the server the hook is inert: in-process calls hand back the source's
 * own iterable — there is no connection to report on.
 */
export type LiveSource<R> = R & {
  onstatus?: (state: LiveSourceStatus, error?: unknown) => void;
};

/** Identity of the currently executing server function call. */
export interface ServerFunctionInvocation {
  id: string;
}

/**
 * Hooks layering framework policy onto `handleServerFunctionRequest`.
 * All are optional — the bare handler dispatches, scopes events, and
 * encodes results on its own.
 */
export interface HandleServerFunctionOptions {
  /**
   * Builds the request event a call runs under (default: bare
   * `{ request, locals: {} }`). Integrations supply their richer event
   * (cookies, response helpers, platform handles).
   */
  createEvent?(request: Request): ServerFunctionEvent;
  /**
   * Overrides the configured event provider for this handler — same
   * contract as the `provideEvent` config option.
   */
  provideEvent?<T>(event: ServerFunctionEvent, fn: () => T): T;
  /**
   * Overrides the configured per-invocation wrap for this handler — same
   * contract as the `wrapInvocation` config option (see
   * `WrapInvocationHook`), except it only applies to HTTP dispatch (a
   * per-request option can't see direct SSR calls).
   */
  wrapInvocation?: WrapInvocationHook;
  /**
   * Observes or replaces the function's result before encoding — the
   * extension point for response metadata policies (headers, statuses,
   * substituted results). Runs for returned and thrown results alike
   * (`context.thrown` distinguishes); `context.instance` is null for no-JS
   * calls. The context carries the call's identity — the function `id` and
   * the parsed `args` the implementation was invoked with — matching the
   * direct-call mirror (`transformDirectResult`), so a policy keying state
   * by the call works over either dispatch path. Return the result
   * unchanged to pass through, or a `ResponseEnvelope` (exposed through
   * the core entry) to send HTTP metadata plus a structured payload. Runs
   * before `collectFlightData`, so the flight hook sees the transformed
   * outcome — use `collectFlightData`, not this, to fold data into the
   * response.
   */
  transformResult?(
    event: ServerFunctionEvent,
    result: unknown,
    context: {
      id: string;
      args: unknown[];
      instance: string | null;
      request: Request;
      thrown?: boolean;
    }
  ): unknown | ResponseEnvelope | Promise<unknown | ResponseEnvelope>;
  /**
   * Overrides the configured single-flight hook for this handler — same
   * contract as the `collectFlightData` config option (see
   * `CollectFlightDataHook`).
   */
  collectFlightData?: CollectFlightDataHook;
  /**
   * Overrides the configured single-flight fold policy for this handler —
   * same contract as the `transformFlightResult` config option.
   */
  transformFlightResult?(
    event: ServerFunctionEvent,
    outcome: { value: unknown; data: unknown },
    context: { id: string; args: unknown[]; instance: string | null; request: Request }
  ): Response | undefined | Promise<Response | undefined>;
  /**
   * Builds the response for calls made without the client runtime (no
   * instance header — no-JS form posts, direct HTTP). Receives the
   * (transformed) result, the request, and the decoded arguments; `thrown`
   * is set when the result was thrown rather than returned.
   *
   * Overrides the configured hook, which in turn overrides the built-in
   * `createNoJSHandler()` applied to browser form posts. Other
   * no-instance callers get the normal serialized response.
   */
  handleNoJS?(
    result: unknown,
    request: Request,
    args: unknown[],
    thrown?: boolean
  ): Response | Promise<Response>;
  /**
   * Overrides same-origin protection for this handler. Set to `false` only
   * when another trusted layer protects the endpoint.
   */
  csrf?: boolean | ServerFunctionCSRFOptions;
  /** Overrides the configured codec options for this handler. */
  codec?: JSONCodecOptions;
}

export interface ServerFunctionRequestCall {
  type: "request";
  id: string;
  instance: string;
  request: Request;
  meta: ServerFunctionMetadata | undefined;
  time: number;
}

export interface ServerFunctionResponseCall {
  type: "response";
  id: string;
  instance: string;
  response: Response;
  meta: ServerFunctionMetadata | undefined;
  time: number;
}

export type ServerFunctionCall = ServerFunctionRequestCall | ServerFunctionResponseCall;

const config = {
  provideEvent: undefined,
  wrapInvocation: undefined,
  collectFlightData: undefined,
  transformResult: undefined,
  transformFlightResult: undefined,
  transformDirectResult: undefined,
  handleNoJS: undefined,
  endpoint: "/_server",
  csrf: true
}; /**
 * Configures the server runtime. Call once at server startup, before
 * handling requests. Only needed when deviating from the defaults (custom
 * endpoint, codec plugins, an explicit event provider, or a single-flight
 * hook).
 */
export function configureServerFunctionsServer(config?: ServerFunctionsServerConfig): void;

/**
 * Configures the server runtime: `provideEvent(event, fn)` establishes the
 * request-event scope for a call (e.g. @solidjs/web/storage's
 * provideRequestEvent), `wrapInvocation(run, context)` wraps every server
 * function execution — HTTP dispatch and direct SSR calls alike — with the
 * invocation identity established (see `handleServerFunctionRequest`),
 * `collectFlightData` is the single-flight hook (see
 * `handleServerFunctionRequest`), `transformResult` is the server-wide
 * default for the handler's result transform (per-request options override;
 * this is how frames installs `frameTransformResult` once for generic
 * dispatchers), `transformFlightResult` is the same seam for the single-flight
 * payload (frames installs `frameTransformFlightResult` to carry invalidated
 * markup), `transformDirectResult` is `transformResult`'s in-process mirror
 * for direct SSR calls, `endpoint` is where the handler is mounted (used for
 * the `url` of SSR'd references, e.g. form actions — must match the
 * client's), and `codec` must match the client's (stored in the shared
 * layer).
 */
export function configureServerFunctionsServer({
  provideEvent,
  wrapInvocation,
  collectFlightData,
  transformResult,
  transformFlightResult,
  transformDirectResult,
  handleNoJS,
  endpoint,
  csrf,
  codec
} = {}) {
  if (provideEvent !== undefined) config.provideEvent = provideEvent;
  if (wrapInvocation !== undefined) config.wrapInvocation = wrapInvocation;
  if (collectFlightData !== undefined) config.collectFlightData = collectFlightData;
  if (transformResult !== undefined) config.transformResult = transformResult;
  if (transformFlightResult !== undefined) config.transformFlightResult = transformFlightResult;
  if (transformDirectResult !== undefined) config.transformDirectResult = transformDirectResult;
  if (handleNoJS !== undefined) config.handleNoJS = handleNoJS;
  if (endpoint !== undefined) config.endpoint = endpoint;
  if (csrf !== undefined) config.csrf = csrf;
  if (codec !== undefined) configureServerFunctionsCodec(codec);
}

// Named flight-data collectors, keyed by source id. The unnamed
// `collectFlightData` hook (config or per-handler option) stays the
// integration that owns data production — a router; named sources are the
// additive seam for everyone else (a query cache refreshing its own
// entries), each folding a slice under its id without displacing the
// owner. Which collectors run for a call is the client's request-leg
// header: the ids its registered consumers can actually use.
const flightSources = new Map(); /**
 * Registers a named single-flight data source: `hook` runs for mutation
 * calls whose client advertised `source` in the request-leg
 * `SINGLE_FLIGHT_HEADER` (the client half is
 * `subscribeFlightData(source, consumer)`), alongside the unnamed
 * `collectFlightData` hook and any other named sources. Each defined
 * result is folded into the response under its id — with named sources in
 * play the payload's `data` is the keyed envelope
 * `{ [source]: slice, ... }` and the response header names the folded
 * sources — so independent caches share one round trip without competing
 * for the single unnamed slot. Returning undefined omits the source from
 * the response; when nothing folds, the response is byte-identical to a
 * plain call.
 *
 * Hooks receive the same digested outcome as `collectFlightData` (target
 * URL, folded cookie headers, revalidation keys) and run sequentially in
 * registration order after the unnamed hook. One hook per source — a
 * later registration replaces the current one; returns an unregister
 * function. Call at server startup, next to
 * `configureServerFunctionsServer`.
 */
export function registerFlightDataSource(source: string, hook: CollectFlightDataHook): () => void;

/**
 * Registers a named single-flight data source (the server half of
 * `subscribeFlightData(source, consumer)`); returns an unregister
 * function.
 */
export function registerFlightDataSource(source, hook) {
  assertFlightSource(source);
  flightSources.set(source, hook);
  return () => {
    if (flightSources.get(source) === hook) flightSources.delete(source);
  };
}

function provideEvent(event, fn) {
  if (config.provideEvent) return config.provideEvent(event, fn);
  // Fall back to the AsyncLocalStorage instance provideRequestEvent parks on
  // the global — present whenever a request scope has been established.
  const ctx = globalThis[RequestContext];
  if (ctx) return ctx.run(event, fn);
  throw new Error(
    "No request event provider. Configure one with configureServerFunctionsServer({ provideEvent })."
  );
}

const REGISTRATIONS = new Map();
// Declared-method bookkeeping keyed by function id (internal, not public
// API): the server half of `GET` records entries here so the HTTP handler
// can gate GET dispatch — a GET request to a function that never declared
// it answers 405. Declaring GET grants GET without revoking POST.
const METHODS = new Map();
// In-flight invocation state, keyed by the request event the call runs
// under — the derived event a direct SSR call creates, or the handler's own
// event for HTTP dispatch. Deliberately NOT `event.locals`: locals is
// user/integration space, and derived events shallow-copy the event while
// SHARING locals, so a locals write from a nested or concurrent call would
// leak into (and overwrite) the outer scope's state.
const INVOCATIONS = new WeakMap();

// Server mirror of the client transport's late-bound RPC registration (see
// client.js provideRPC and registry.js): the server half's `GET` records the
// declared method for HTTP dispatch, so a router's query() wrapping a
// reference during SSR must reach the SAME declaration bookkeeping — read
// through the seam, filled the moment compiled server output registers or
// references a function.
let rpcProvided = false;
function provideRPC() {
  if (rpcProvided) return;
  rpcProvided = true;
  provideServerFunctionRPC({ GET, decodeResponse });
} /**
 * Adds a function to the dispatch registry under an id and returns it
 * unchanged. The low-level registry write for integrations registering
 * functions outside the compiler (e.g. a router registering its own
 * endpoints); compiled output goes through `registerServerReference`
 * instead. Ids must be stable across the client and server builds.
 */
export function registerServerFunction<T extends any[], R>(
  id: string,
  callback: (...args: T) => R
): (...args: T) => R;

export function registerServerFunction(id, callback) {
  provideRPC();
  REGISTRATIONS.set(id, callback);
  return callback;
} /**
 * Looks up a registered server function by id; throws for unknown ids.
 * The HTTP handler uses this for dispatch — integrations building custom
 * dispatch (or introspection) can too.
 */
export function getServerFunction<T extends any[], R>(id: string): (...args: T) => R;

export function getServerFunction(id) {
  const fn = REGISTRATIONS.get(id);
  if (fn) {
    return fn;
  }
  throw new Error("invalid server function: " + id);
} /**
 * Compiler ABI — emitted by compiled `"use server"` server output for
 * every server function: registers `fn` for HTTP dispatch under its
 * build-stable id and returns the reference the server-side
 * `createServerReference` consumes. Development builds pass the function's
 * source name as the trailing argument (dev-only metadata; never emitted in
 * production). Not meant for hand-written code.
 * @internal
 */
export function registerServerReference<T extends any[], R>(
  id: string,
  fn: (...args: T) => R,
  name?: string
): ServerFunctionReference<T, R>;

/**
 * Registers a compiled server function under its id. Development output
 * passes the function's source name as the trailing argument; it rides the
 * reference into `createServerReference`, which seeds the metadata channel
 * with it.
 */
export function registerServerReference(id, fn, name) {
  // Module-level "use server" registers each export's *evaluated value* —
  // `export const x = withValidation(schema, fn)` registers the wrapper's
  // return, composing it onto every call path. The compiler never inspects
  // initializer shapes, so "is this actually a function" is owned here, at
  // module eval: a non-function export fails the server boot loudly instead
  // of shipping a dead reference the client discovers per-call.
  if (typeof fn !== "function") {
    throw new Error(
      `Server function${name ? ` \`${name}\`` : ""} (${id}) is not a function: a module-level ` +
        `"use server" export must evaluate to a server function (got ${
          fn === null ? "null" : typeof fn
        }). Move non-function exports out of the directive module.`
    );
  }
  registerServerFunction(id, fn);
  return { id, fn, name };
} /**
 * Compiler ABI — emitted by compiled `"use server"` server output where
 * the function was referenced; produces the server-side callable. Calling
 * it during SSR runs the original function in-process (no HTTP), under a
 * request event derived from the current one — marked `serverOnly` and
 * carrying the function's meta. Not meant for hand-written code.
 * @internal
 */
export function createServerReference<T extends any[], R>(
  reference: ServerFunctionReference<T, R>
): (...args: T) => R;

/**
 * Produces the server-side callable for a reference: calling it during SSR
 * runs the original function in-process, under a request event derived from
 * the current one (marked server-only, carrying the function's meta).
 */
// The in-process invocation channel: `invoke`'s server-build mirror. The
// call runs in-process, so of the invocation options only `signal` has
// meaning — aborting rejects the CALLER with the signal's reason, while the
// work itself, exactly like a server behind HTTP, runs to completion unless
// the function observes a signal of its own. The transport hints
// (keepalive, priority) describe a wire that does not exist and are no-ops.
function inProcessInvoker(call) {
  return (args, options) => {
    const signal = options && options.signal;
    if (!signal) return call(...args);
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      let result;
      try {
        // synchronous entry preserved: the event scope derives from the
        // ambient request event exactly as a plain call's would
        result = call(...args);
      } catch (error) {
        signal.removeEventListener("abort", onAbort);
        return reject(error);
      }
      Promise.resolve(result).then(
        value => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        error => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        }
      );
    });
  };
}

export function createServerReference({ id, fn, name }) {
  if (typeof fn !== "function")
    throw new Error("Export from a 'use server' module must be a function");
  provideRPC();

  // the metadata lives in a closure (not on the user's function) so
  // registering the raw implementation never mutates it. The compiler's
  // dev-only source name seeds it as a default — explicit `withMeta`/`GET`
  // writes shallow-merge over it like any other write.
  const metadata = name === undefined ? {} : { name };
  const invokeChannel = inProcessInvoker((...args) => proxy(...args));
  const proxy = new Proxy(fn, {
    get(target, prop) {
      if (prop === "id") return id;
      if (prop === "url") {
        return serverFunctionAddress(config.endpoint, id);
      }
      if (prop === SERVER_FUNCTION_METADATA) return metadata;
      if (prop === SERVER_FUNCTION_INVOKE) return invokeChannel;
      return target[prop];
    },
    apply(target, thisArg, args) {
      const ogEvt = getRequestEvent();
      if (!ogEvt) throw new Error("Cannot call server function outside of a request");
      const evt = { ...ogEvt };
      // Keyed on the derived event (locals is shared with the outer event —
      // see INVOCATIONS): the invocation is visible exactly within this
      // call's provideEvent scope and evaporates with the derived event.
      INVOCATIONS.set(evt, { id });
      evt.serverOnly = true;
      const result = provideEvent(evt, () => {
        const run = () => fn.apply(thisArg, args);
        // Per-invocation wrap (see configureServerFunctionsServer): direct
        // SSR calls run through the same policy as HTTP dispatch, so
        // per-function middleware built on it can't be bypassed by calling
        // the function during a render. The wrapper must return run()'s
        // value (this path stays synchronous for synchronous functions).
        return config.wrapInvocation
          ? config.wrapInvocation(run, { id, args, event: evt, direct: true })
          : run();
      });
      // In-process mirror of the handler's transformResult: direct SSR calls
      // pass their settled value through the configured policy (e.g. frames
      // wrapping a function result as an inline-renderable server component).
      // `args` rides along so a policy can derive the call's wire address
      // (`frameAddress`) — the same one the client derives for the same call.
      const transform = config.transformDirectResult;
      if (transform && result && typeof result.then === "function") {
        return result.then(value => transform(value, { id, args, event: evt }));
      }
      return transform ? transform(result, { id, args, event: evt }) : result;
    }
  });
  return proxy;
} /**
 * Declares a server function callable over HTTP GET. The server half is
 * identity-flavored — SSR calls stay in-process — but it brands the
 * declaration on the reference's metadata channel
 * (`getServerFunctionMetadata(fn)?.method === "GET"`) and records the
 * declared method for the function's id so `handleServerFunctionRequest`
 * honors it: GET-declared functions accept GET requests in addition to the
 * default POST transport (declaring GET grants, it does not revoke);
 * functions that never declared GET answer GET requests with 405.
 *
 * Wrap the reference at its declaration; the compiler round-trips the call
 * in both builds:
 *
 * ```ts
 * export const getUser = GET(async (id: string) => {
 *   "use server";
 *   return db.users.find(id);
 * });
 * ```
 */
export function GET<A extends readonly any[], R>(
  fn: (...args: A) => R
): ServerFunction<A, Awaited<R>>;

/**
 * Declares a server function callable over HTTP GET. The server half is
 * identity-flavored — SSR calls stay in-process — but it brands the
 * declaration on the reference's metadata channel
 * (`getServerFunctionMetadata(fn).method === "GET"`) and records the
 * declared method for the function's id so `handleServerFunctionRequest`
 * honors it: GET-declared functions accept GET requests in addition to the
 * default POST transport (declaring GET grants, it does not revoke);
 * functions that never declared GET answer GET requests with 405.
 *
 * Wrap the reference at its declaration; the compiler round-trips the call
 * in both builds:
 *
 * ```ts
 * export const getUser = GET(async (id: string) => {
 *   "use server";
 *   return db.users.find(id);
 * });
 * ```
 */
export function GET(fn) {
  if (!isServerFunction(fn) || typeof fn.id !== "string") {
    throw new Error("GET expects a server function reference");
  }
  METHODS.set(fn.id, "GET");
  // the declaration itself is a metadata write like any other
  return withMeta(fn, { method: "GET" });
} /**
 * Declares a value-shaped live source: a server function returning an async
 * iterable whose yields are successive VALUES of one logical query, with
 * the contract that the source re-yields current state on every invocation.
 * Writes `live: true` on the metadata channel and brands the resolved
 * iterable (registered symbol `solid.LiveSource`) so SSR faces meeting the
 * value in-process can apply live policy (document face: first value, then
 * client takeover). Dispatch is untouched — over-the-wire calls stream the
 * raw registered function's result. Declare live outermost:
 * `live(GET(fn))`.
 */
export function live<A extends readonly any[], R>(
  fn: (...args: A) => R
): ServerFunction<A, LiveSource<Awaited<R>>>;

/**
 * Declares a value-shaped live source: a server function returning an async
 * iterable whose yields are successive VALUES of one logical query (latest
 * wins), not events to be accumulated. The declaration is what buys the
 * managed lifecycle — on the client the reference gains reconnect-with-
 * backoff and connection sharing (see the client half); faces detect the
 * declaration on the VALUE via the `LIVE_SOURCE` brand (e.g. SSR taking
 * the first value and handing the stream to the client rather than
 * draining it).
 *
 * Unlike `GET` (a pure metadata write), `live` carries behavior — so the
 * behavior lives INSIDE the declaration and treeshakes with it: nothing in
 * the dispatch path or the shared layer knows live exists; a build that
 * never imports `live` carries none of this. The server half's whole
 * behavior is the value brand: in-process calls (SSR) meet the result
 * after it has left the reference's hands, so the brand must travel on the
 * value. Dispatch is untouched — over-the-wire calls stream the raw
 * registered function's result exactly as before. Composes with `GET` but
 * does not imply it; declare live outermost (`live(GET(fn))`), matching
 * the client half where live's behavior wraps the call.
 *
 * ```ts
 * export const stockPrice = live(async function* (symbol: string) {
 *   "use server";
 *   for await (const tick of subscribe(symbol)) yield tick.price;
 * });
 * ```
 */
export function live(fn) {
  if (!isServerFunction(fn) || typeof fn.id !== "string") {
    throw new Error("live expects a server function reference");
  }
  const metadata = { ...getServerFunctionMetadata(fn), live: true };
  const wrapped = async (...args) => {
    const result = await fn(...args);
    if (result !== null && typeof result === "object" && result[Symbol.asyncIterator]) {
      result[LIVE_SOURCE] = true;
    }
    return result;
  };
  wrapped[SERVER_FUNCTION_METADATA] = metadata;
  wrapped[SERVER_FUNCTION_INVOKE] = inProcessInvoker(wrapped);
  wrapped.id = fn.id;
  Object.defineProperty(wrapped, "url", {
    get: () => fn.url,
    configurable: true
  });
  return wrapped;
} /**
 * Reads the in-flight server function invocation (its id) for the current
 * request event — usable inside a server function body, e.g. to key caches
 * or logs by function. Returns undefined outside a server function call.
 * The state lives in a module-private WeakMap keyed by the per-call request
 * event (never in `event.locals`, which derived events share with their
 * outer event). Distinct from `getServerFunctionMetadata(fn)`, which reads
 * a reference's static declaration metadata; this describes the call
 * currently executing.
 */
export function getServerFunctionInvocation(): ServerFunctionInvocation | undefined;

/**
 * Reads the in-flight server function invocation off the current request
 * event. Distinct from `getServerFunctionMetadata(fn)`, which reads a
 * reference's static declaration metadata — this describes the call
 * currently executing.
 */
export function getServerFunctionInvocation() {
  return getEventServerFunctionInvocation(getRequestEvent());
} /**
 * The event-keyed half of `getServerFunctionInvocation`, for callers handed
 * an event outside its provideEvent scope (the handler's result transforms
 * run after the scope has exited). Integration plumbing — application code
 * reads the ambient accessor instead.
 * @internal
 */
export function getEventServerFunctionInvocation(
  event: RequestEvent | undefined
): ServerFunctionInvocation | undefined;

/**
 * The event-keyed half of `getServerFunctionInvocation`, for callers handed
 * an event outside its provideEvent scope (the handler's result transforms
 * run after the scope has exited). Integration plumbing — application code
 * reads the ambient accessor instead.
 * @internal
 */
export function getEventServerFunctionInvocation(event) {
  return event && INVOCATIONS.get(event);
}

function resolveAddress(url) {
  return parseServerFunctionAddress(url.pathname, config.endpoint);
}

async function parseArguments(request, url, scripted, codec) {
  const parsed = [];
  // Bound arguments arrive on the url for GET calls, no-JS form posts, and
  // scripted POSTs whose body is a natural HTTP encoding (FormData,
  // urlencoded) — e.g. a router intercepting a form whose action url was
  // rendered by the server. Codec-serialized bodies are the exception:
  // client stubs with bound arguments serialize the full argument array in
  // the body and never put arguments in the url.
  const bodyFormat = request.method === "POST" ? request.headers.get(BODY_FORMAT_HEADER) : null;
  const args = url.searchParams.get("args");
  if (args && (!scripted || request.method === "GET" || bodyFormat !== BodyFormat.Serialized)) {
    // framed codec output (from the client runtime) or plain JSON (from
    // integrations building urls by hand). Anything that is not an argument
    // array is a malformed request, which dispatch answers as one: the query
    // reserves `args`, so a caller that sends it sent an encoding.
    const result = args.startsWith(";0x") ? await deserializeString(args, codec) : JSON.parse(args);
    if (!Array.isArray(result)) {
      throw new TypeError("Server function arguments must encode an array");
    }
    for (const arg of result) {
      parsed.push(arg);
    }
  } else if (!args && url.search && (request.method === "GET" || request.method === "HEAD")) {
    // A read whose query is not an argument encoding carries a form's own
    // parameters: a `method="get"` submit replaces the action url's query
    // with its fields (which is why only an address in the path survives
    // one). They reach the function as a lone `URLSearchParams`, the
    // read-side mirror of a no-JS form post decoding to a lone `FormData`.
    // Which reading applies is decided by the url alone, never by a header:
    // a cache keys on the url, so the same url must mean the same call.
    parsed.push(url.searchParams);
  }
  if (request.method === "POST" && request.body !== null) {
    const decoded = await extractBody(request.clone(), codec);
    // Both argument-array encodings: codec-framed and plain JSON.
    if (bodyFormat === BodyFormat.Serialized || bodyFormat === BodyFormat.Json) {
      return decoded;
    }
    parsed.push(decoded);
  }
  return parsed;
}

/**
 * Runs the single-flight hooks and standardizes their contribution: each
 * `[source, hook]` pair that returns data is folded into the body's
 * `{ value, data }` payload, and the response's single-flight header names
 * the folded sources — the client routes slices to consumers by it. A lone
 * unnamed fold ("true") keeps the legacy raw payload shape and header
 * value, byte-identical to the single-hook protocol, so peers that predate
 * named sources interoperate unchanged; named sources produce the keyed
 * envelope `{ [source]: slice, ... }`. When every hook declines the
 * response is byte-identical to a call without hooks. Data production is
 * each hook's black box — core never sees how the integration computed it,
 * but the generic halves of the protocol are pre-digested onto the outcome
 * (see `digestOutcome`, run once for all hooks) so integrations only
 * supply the data strategy. Hooks run sequentially: collectors re-run
 * reads inside request-event scopes, and interleaving those is asking for
 * cross-talk. A raw body-carrying `Response` value is the caller's
 * verbatim payload — there is no envelope to fold data into, so no hook
 * runs for one.
 */
async function foldFlightData(hooks, event, headers, outcome, context = {}) {
  if (outcome.value instanceof Response && outcome.value.body) return outcome.value;
  digestOutcome(event, outcome);
  const folded = [];
  for (const [source, hook] of hooks) {
    // Contained per source: one cache's collector failing must not cost the
    // mutation's outcome or the other caches' slices — without this, a
    // thrown hook falls into the handler's outer catch and the client
    // receives an ERROR for a mutation that succeeded. A missing slice just
    // means that cache revalidates the normal way.
    try {
      const slice = await hook(event, outcome);
      if (slice !== undefined) folded.push([source, slice]);
    } catch (error) {
      console.error(`Error collecting flight data for source "${source}"`, error);
    }
  }
  if (folded.length === 0) return outcome.value;
  const legacy = folded.length === 1 && folded[0][0] === "true";
  const data = legacy ? folded[0][1] : Object.fromEntries(folded);
  headers.set(SINGLE_FLIGHT_HEADER, folded.map(([source]) => source).join(","));
  // A payload can be partly markup — an invalidated region the integration
  // answered with a server component. That needs a body only the frame
  // policy knows how to build, so it gets first refusal on the fold;
  // declining (or not being installed) keeps the serialized envelope.
  if (context.transformFlightResult) {
    const transformed = await context.transformFlightResult(
      event,
      { value: outcome.value, data },
      context
    );
    if (transformed !== undefined) {
      // Headers accumulated during the call (the mutation's cookies, an
      // envelope's metadata) belong on whatever body carries the outcome.
      for (const cookie of headers.getSetCookie()) transformed.headers.append("Set-Cookie", cookie);
      headers.forEach((value, key) => {
        if (key !== "set-cookie" && !transformed.headers.has(key)) {
          transformed.headers.set(key, value);
        }
      });
      return transformed;
    }
  }
  // A void mutation's envelope omits the `value` key rather than carrying
  // `value: undefined`: both decode paths read `payload.value` as undefined
  // either way, but only the key-less shape is JSON-safe — and a mutation
  // returning nothing with JSON-safe flight data is THE common
  // single-flight response, which should ride the JSON fast path (see
  // encodeResult), not wake the codec.
  return outcome.value === undefined ? { data } : { value: outcome.value, data };
}

// The generic halves of flight-data collection, computed by core so every
// integration doesn't re-derive them from raw headers:
// - `revalidateKeys`: the outcome's `X-Revalidate` keys, split.
// - `foldedHeaders`: the request headers with the mutation's cookie effects
//   applied — the event response's `Set-Cookie`s (set during the call),
//   then the outcome's own (e.g. `redirect(to, { headers })`, which never
//   reach the event response but a browser round trip would have sent
//   back), later winning on conflict. Re-run reads observe post-mutation
//   cookie state, deletions included.
// - `targetUrl`: the URL the client will show after the mutation — the
//   redirect `Location` when the outcome carries one (resolved against the
//   request URL, as a browser would), the referring page otherwise.
//   Undefined without a usable referer (a non-browser caller has no page to
//   produce data for) and for redirects leaving the app's origin.
function digestOutcome(event, outcome) {
  const { request, response } = outcome;
  outcome.revalidateKeys = response?.headers.get(REVALIDATE_HEADER)?.split(",");
  outcome.foldedHeaders = foldSetCookies(request.headers, [
    ...(event.response?.headers?.getSetCookie() ?? []),
    ...(response?.headers?.getSetCookie() ?? [])
  ]);
  try {
    const referrer = request.headers.get("referer");
    if (referrer) {
      const location = response?.headers.get("Location");
      const target = location ? new URL(location, request.url) : new URL(referrer);
      if (target.origin === new URL(request.url).origin) outcome.targetUrl = target.toString();
    }
  } catch {
    // unparseable referer — same as no referer
  }
}

function parseSetCookie(setCookie) {
  const [pair, ...attributes] = setCookie.split(";");
  const eq = pair.indexOf("=");
  if (eq < 0) return undefined;
  const parsed = { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim() };
  for (const attribute of attributes) {
    const attrEq = attribute.indexOf("=");
    const key = (attrEq < 0 ? attribute : attribute.slice(0, attrEq)).trim().toLowerCase();
    const value = attrEq < 0 ? "" : attribute.slice(attrEq + 1).trim();
    if (key === "max-age") parsed.maxAge = Number(value);
    else if (key === "expires") parsed.expires = new Date(value);
  }
  return parsed;
} /**
 * Request headers with `setCookies` folded into the `Cookie` header, as the
 * browser would have applied them before its next request. Later entries
 * win on conflict, and deletions are honored (`Max-Age` at or below zero,
 * `Expires` in the past). The input headers are not modified.
 *
 * For work re-run on the server after a mutation — a
 * `CollectFlightDataHook` gathering fresh data, typically. That pass starts
 * from the request that triggered the mutation, whose cookies are
 * pre-mutation by definition, so a read depending on a session the mutation
 * just established would otherwise see the old state. Which responses
 * contribute their `Set-Cookie`s, and in what order, is the caller's
 * decision.
 *
 * @example
 * ```ts
 * const headers = foldSetCookies(event.request.headers, [
 *   ...(event.response?.headers?.getSetCookie() ?? []),
 *   ...(outcome.response?.headers?.getSetCookie() ?? [])
 * ]);
 * ```
 */
export function foldSetCookies(headers: Headers, setCookies: readonly string[]): Headers;

/**
 * Request headers with a set of `Set-Cookie` values folded into the
 * `Cookie` header, as the browser would have applied them before its next
 * request. Later entries win on conflict, and deletions are honored
 * (`Max-Age` at or below zero, `Expires` in the past).
 *
 * Work re-run on the server after a mutation — collecting single-flight
 * data, for instance — starts from the request that triggered the mutation,
 * whose cookies are by definition pre-mutation. Reads that depend on a
 * session the mutation just established would otherwise see the old state.
 * Which responses contribute (the request event's, the outcome's, both) is
 * the caller's decision.
 */
export function foldSetCookies(headers, setCookies) {
  const folded = new Headers(headers);
  if (!setCookies.length) return folded;

  const cookies = {};
  for (const pair of folded.get("cookie")?.split(";") ?? []) {
    const eq = pair.indexOf("=");
    if (eq > -1) cookies[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  for (const setCookie of setCookies) {
    const parsed = parseSetCookie(setCookie);
    if (!parsed) continue;
    if (
      (parsed.maxAge != null && parsed.maxAge <= 0) ||
      (parsed.expires != null && parsed.expires.getTime() <= Date.now())
    ) {
      delete cookies[parsed.name];
    } else {
      cookies[parsed.name] = parsed.value;
    }
  }
  folded.delete("cookie");
  const serialized = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  if (serialized) folded.set("cookie", serialized);
  return folded;
}

// Forwards a response's headers onto another header set. `Set-Cookie` goes
// through `getSetCookie()` and appends value-by-value — `Headers` iteration
// folds multi-value headers into one comma-joined entry on some runtimes,
// and a folded `Set-Cookie` is corrupt (commas are legal inside a single
// cookie's `Expires`). Everything else appends as iterated. This is the one
// way response headers may merge here: never `get`/`set` folding.
function mergeResponseHeaders(target, source) {
  source.forEach((value, key) => {
    if (key !== "set-cookie") target.append(key, value);
  });
  if (source.getSetCookie) {
    for (const cookie of source.getSetCookie()) target.append("Set-Cookie", cookie);
  } else if (source.has("set-cookie")) {
    // ancient Headers polyfill without getSetCookie: better one folded
    // entry than none
    target.append("Set-Cookie", source.get("set-cookie"));
  }
}

// The commit seam moved to `commitEventResponse` in ../server.js — one
// public implementation shared with integrations' handler edges (a
// middleware early return leaves through the same fold this handler's
// responses do), so the gap-fill/denylist semantics cannot drift.

// The statuses fetch treats as redirects and follows (Fetch §2.2.3,
// https://fetch.spec.whatwg.org/#redirect-status). Doing double duty: the
// statuses the no-JS handler may answer a form post with, and the exact set
// the dispatch masks to 200 + Location for scripted callers — the rest of
// the 3xx band (304 notably) is never followed by fetch and forwards as-is.
const validRedirectStatuses = new Set([301, 302, 303, 307, 308]); /**
 * Builds the `handleNoJS` implementation for the no-JS form convention: a
 * form posted without the client runtime has no way to receive a value, so
 * the call redirects back to the referring page (or to the result's own
 * `Location`, resolved against `base`) with the outcome riding a one-shot
 * flash cookie. `303 See Other` turns the POST into a GET unless the result
 * names a redirect status of its own. A result that is already a `Response`
 * carries its meaning in its metadata and is not flashed.
 *
 * The render that follows reads the cookie with `decodeFlashCookie` and
 * surfaces the outcome however it likes — that half is the integration's.
 *
 * The handler applies to every call it receives. `handleServerFunctionRequest`
 * already uses it for browser form posts, so wire it explicitly only to set
 * a `base`, or to extend the convention to direct HTTP calls by registering
 * it through `configureServerFunctionsServer`.
 */
export function createNoJSHandler(
  options?: NoJSHandlerOptions
): (result: unknown, request: Request, args: unknown[], thrown?: boolean) => Response;

/**
 * Builds the `handleNoJS` implementation for the no-JS form convention: a
 * form posted without the client runtime redirects back to the referring
 * page (or to the result's own `Location`) with the outcome riding a
 * one-shot flash cookie, for the render that follows to pick up.
 *
 * `base` is the app's mount path, used to resolve a relative `Location`.
 * The handler is unconditional — every call it receives redirects — so
 * wiring it explicitly opts every non-scripted call into the convention,
 * including direct HTTP ones.
 */
export function createNoJSHandler({ base = "" } = {}) {
  return function handleNoJS(result, request, args, thrown) {
    const url = new URL(request.url);
    // an unusable referer (no-referrer policy, garbage) still beats leaving
    // the browser sitting on the server function endpoint
    let back = new URL(base || "/", url.origin).toString();
    try {
      const referer = request.headers.get("referer");
      if (referer) back = new URL(referer).toString();
    } catch {}
    // form post -> GET: 303 See Other unless the result names a redirect status
    let status = 303;
    let headers;
    if (result instanceof Response) {
      // copy through the multi-Set-Cookie-preserving merge, not the
      // Headers constructor (which folds them on some runtimes)
      headers = new Headers();
      mergeResponseHeaders(headers, result.headers);
      if (result.headers.has("Location")) {
        headers.set(
          "Location",
          new URL(result.headers.get("Location"), url.origin + base).toString()
        );
        if (validRedirectStatuses.has(result.status)) status = result.status;
      } else {
        headers.set("Location", back);
      }
      // any body is dropped from the redirect we build — don't advertise it
      headers.delete("Content-Type");
      headers.delete("Content-Length");
    } else {
      headers = new Headers({ Location: back });
    }
    // Responses carry their meaning in their metadata; anything else flashes
    // the outcome for the next render to read.
    if (result && !(result instanceof Response)) {
      headers.append(
        "Set-Cookie",
        encodeFlashCookie(url.pathname + url.search, result, args, thrown)
      );
    }
    return new Response(null, { status, headers });
  };
}

let defaultNoJSHandler;

/**
 * Whether a request is a browser form post — the case the redirect
 * convention exists for. A real form sets its own content type and carries
 * no `BODY_FORMAT_HEADER`, which only the client runtime sends. Direct HTTP
 * callers (curl, a fetch from a script) fall outside it and keep the plain
 * response: redirecting them would be nonsense.
 */
function isFormPost(request) {
  if (request.method !== "POST" || request.headers.has(BODY_FORMAT_HEADER)) return false;
  const type = request.headers.get("content-type") || "";
  return (
    type.startsWith("application/x-www-form-urlencoded") || type.startsWith("multipart/form-data")
  );
}

/**
 * The response-side codec stream: `serializeStream` (shared.js) hardened
 * with request-lifetime teardown. Server-only on purpose — the shared half
 * is re-exported into client bundles, where this plumbing is dead weight.
 *
 * An abort of `signal` (the platform fires request.signal when the caller's
 * fetch aborts or the tab goes away) or the consumer cancelling the
 * ReadableStream (how platforms surface a dropped connection to the body)
 * stops pending serialization and tears down a top-level async-iterable
 * value — the producer's `iterator.return()` runs, so generator `finally`
 * blocks execute instead of the server pumping a stream nobody is reading.
 * Top-level only: that is the value-tier shape ("return a stream from the
 * server function"); iterables nested inside user objects are consumed by
 * the codec directly and stay untouched.
 */
export function serializeResponseStream(value, codecOptions, signal) {
  let closeIterator = null;
  let closed = false;
  let cancelSerialize = null;
  let onAbort = null;
  const teardown = () => {
    if (closed) return;
    closed = true;
    if (onAbort) signal.removeEventListener("abort", onAbort);
    if (cancelSerialize) cancelSerialize();
    if (closeIterator) closeIterator();
  };
  if (
    value !== null &&
    typeof value === "object" &&
    typeof value[Symbol.asyncIterator] === "function"
  ) {
    // Teardown-aware wrapper, installed BEFORE the codec sees the value:
    // seroval's stream pump has no cancellation of its own — once it holds
    // the iterator it pulls until done — so this wrapper is the only seam
    // where a dropped consumer can stop the producer. The codec only ever
    // calls next(), so that is all the wrapper exposes.
    const source = value;
    value = {
      [Symbol.asyncIterator]() {
        const it = source[Symbol.asyncIterator]();
        let finished = false;
        closeIterator = () => {
          if (finished) return;
          finished = true;
          try {
            const returned = it.return && it.return();
            if (returned && typeof returned.then === "function") returned.then(undefined, () => {});
          } catch {}
        };
        // torn down before the codec opened the value (abort raced the
        // codec load): close the source immediately, never pull
        if (closed) closeIterator();
        return {
          next: () => (finished ? Promise.resolve({ done: true, value: undefined }) : it.next())
        };
      }
    };
  }
  return new ReadableStream({
    // async on purpose: the codec is late-loaded (see the loading notes at
    // the top of shared.js), and a ReadableStream start may return a
    // promise — reads wait for it, so the stream's contract is unchanged
    async start(controller) {
      if (signal) {
        if (signal.aborted) {
          teardown();
          controller.close();
          return;
        }
        // Beyond producer teardown, an abort must TERMINATE the stream for
        // anyone still reading it (an in-process consumer's drain would
        // otherwise hang on a stream nobody will ever close). The cancel()
        // path below must NOT do this — there the stream is already
        // cancelled and the controller unusable.
        onAbort = () => {
          const alreadyClosed = closed;
          teardown();
          if (!alreadyClosed) {
            try {
              controller.error(signal.reason || new Error("The operation was aborted."));
            } catch {}
          }
        };
        signal.addEventListener("abort", onAbort);
      }
      const { serializeJSON } = await import("../../serialization/src/serializer.js");
      if (closed) {
        // torn down while the codec was loading; nothing was started
        try {
          controller.close();
        } catch {}
        return;
      }
      cancelSerialize = serializeJSON(value, {
        ...codecOptions,
        onParse(node) {
          if (!closed) controller.enqueue(createChunk(JSON.stringify(node)));
        },
        onDone() {
          if (closed) return;
          closed = true;
          if (onAbort) signal.removeEventListener("abort", onAbort);
          controller.close();
        },
        onError(error) {
          if (closed) return;
          closed = true;
          if (onAbort) signal.removeEventListener("abort", onAbort);
          controller.error(error);
        }
      });
    },
    cancel() {
      teardown();
    }
  });
}

function serializedResponse(value, headers, codec, signal) {
  headers.set(BODY_FORMAT_HEADER, BodyFormat.Serialized);
  headers.set("Content-Type", "text/plain");
  return new Response(serializeResponseStream(value, codec, signal), { headers });
}

function encodeResult(value, headers, status, codec, signal) {
  // A null-body status can answer void results only. Encoding a value would
  // throw a TypeError from the Response constructor AFTER the function ran,
  // escaping into dispatch's catch where it used to be sanitized into a
  // phantom generic error at 200 with the real cause appearing nowhere
  // (#3095). Answer the void shapes with a real null-body response, and
  // report a value-carrying result as the authoring error it is — legibly
  // in every build (the message names only the status), and built HERE
  // rather than thrown: this encoder also runs inside dispatch's catch,
  // where a throw would escape the handler entirely.
  if (NULL_BODY_STATUSES.has(status)) {
    if (value === undefined || value === null) {
      headers.set(BODY_FORMAT_HEADER, BodyFormat.Void);
      return new Response(null, { status, headers });
    }
    const error = new Error(
      `Server function answered status ${status}, which forbids a response body, with a value. ` +
        `Return respond(undefined, { status: ${status} }) for a bodiless answer, or drop the ` +
        `status to send the value.`
    );
    headers.set(ERROR_HEADER, encodeErrorHeaderValue(error.message));
    return encodeResult(error, headers, 500, codec, signal);
  }
  const direct = getHeadersAndBody(value);
  if (direct) {
    for (const [key, val] of Object.entries(direct.headers || {})) {
      headers.set(key, val);
    }
    return new Response(direct.body, { status, headers });
  }
  // The response mirror of the client's argument negotiation: results
  // without a natural HTTP encoding still avoid the codec when JSON can
  // carry them faithfully. A void result sends no body at all (the client's
  // decode answers undefined for body-less responses), and a JSON-safe one
  // — plain data, single-flight `{ value, data }` envelopes included —
  // rides `BodyFormat.Json`, which the client's extractBody already decodes
  // with bare JSON.parse. Only values that NEED typed reconstruction
  // (Dates, Maps, streams, promises, Errors — thrown errors always land
  // here) reach the streaming codec, and only their arrival makes the
  // client load its decode half (see shared.js loadSerializer). Negotiated
  // per response: mixed pages simply carry both formats.
  if (value === undefined) {
    headers.set(BODY_FORMAT_HEADER, BodyFormat.Void);
    return new Response(null, { status, headers });
  }
  // By the time a result is being encoded the function has already run —
  // side effects committed — so a failure HERE must never escape into
  // dispatch's catch, where it would be sanitized and reported as the
  // function itself throwing (a phantom error over a call that succeeded).
  // isJSONSafe no longer throws on cycles/depth (they answer "not safe"),
  // so this catch is belt and braces for what negotiation can still hit —
  // a throwing getter, an engine limit on an extreme shape — and it falls
  // through to the codec, which owns structured encoding errors.
  try {
    if (isJSONSafe(value)) {
      headers.set(BODY_FORMAT_HEADER, BodyFormat.Json);
      headers.set("Content-Type", "application/json");
      return new Response(JSON.stringify(value), { status, headers });
    }
  } catch {
    // fall through — serializedResponse overwrites the format headers the
    // JSON attempt may have set before stringify threw
  }
  const response = serializedResponse(value, headers, codec, signal);
  return status === 200 ? response : new Response(response.body, { status, headers });
}

// The error header is a classification label — the structured error travels
// in the body (the client throws the DECODED BODY and reads the header only
// for presence) — so nothing is lost by bounding it, and an unbounded one is
// fatal: a message past a receiver's header limit (undici defaults to 16 KB,
// nginx proxy buffers to 4-8 KB for the WHOLE header block) makes the whole
// response unreadable, replacing the application error with a network error
// (#3093). Percent-encoding inflates non-latin1 up to nine-fold, so the
// bound is enforced on the ENCODED value by re-encoding a shrinking slice of
// the source — never by cutting the encoding, where a split escape sequence
// would not decode.
const ERROR_HEADER_VALUE_LIMIT = 1024;

function boundedErrorHeaderValue(message) {
  let label = message.length > 256 ? message.slice(0, 256) : message;
  let encoded = encodeErrorHeaderValue(label);
  while (encoded.length > ERROR_HEADER_VALUE_LIMIT && label.length > 1) {
    // a slice can split a surrogate pair; the encoder well-forms it
    label = label.slice(0, Math.ceil(label.length / 2));
    encoded = encodeErrorHeaderValue(label);
  }
  return encoded;
}

/** Message a sanitized (production) server error carries on the wire. */
export const GENERIC_SERVER_ERROR_MESSAGE = "Internal Server Error";

// Build-variant dev flag. The `"_SOLID_DEV_"` string is replaced with a
// boolean by the bundler packaging this runtime — @solidjs/web builds a dev
// and a prod copy of its server-functions server entry and selects between
// them through the `development` export condition, so Vite dev serves full
// fidelity and every default resolution (plain node, production builds)
// gets the sanitizing copy. The strict comparison keeps raw, unreplaced
// source FAIL-SAFE: the bare string is not `true`, so a deep import that
// bypassed the bundled entries sanitizes and omits diagnostic bodies like a
// production build. Deliberately NOT process.env.NODE_ENV — the runtime is
// a web-standard package and keys dev behavior on build variants, not
// ambient node environment.
let DEV = "_SOLID_DEV_" === true; /**
 * Overrides the build-variant dev flag for this module instance — the seam
 * for test harnesses and hand-rolled bundles whose packaging cannot replace
 * `_SOLID_DEV_`. Applications never call this; select the dev build through
 * the `development` export condition instead.
 * @internal
 */
export function setServerFunctionsDev(dev: boolean): void;

/**
 * Overrides the build-variant dev flag for this module instance — the seam
 * for test harnesses and hand-rolled bundles whose packaging cannot replace
 * `_SOLID_DEV_`. Applications never call this; select the dev build through
 * the `development` export condition instead.
 * @internal
 */
export function setServerFunctionsDev(dev) {
  DEV = !!dev;
} /**
 * The production error-sanitization policy `handleServerFunctionRequest`
 * applies to a plain thrown value before serialization. Returns `value`
 * unchanged in the dev build or when it is branded safe (`markSafeError`);
 * otherwise returns a generic `Error` carrying `GENERIC_SERVER_ERROR_MESSAGE`.
 * Exposed for frameworks composing their own dispatch around the same policy.
 */
export function sanitizeServerError(value: unknown): unknown;

/**
 * Production error sanitization for a plain thrown value (not a
 * Response/envelope — those are intentional control flow, handled before
 * this). A raw `Error` (or thrown string/object) serialized to the client
 * would ship its `message` and every own-property verbatim over the wire —
 * an ORM/driver error's failing query, connection string, or bound params
 * included. So outside the dev build it is replaced with a generic `Error`,
 * preserving only that the client receives *an* `Error` (the protocol shape
 * consumers like the router's `submission.error` expect).
 *
 * The dev build keeps full fidelity (message, stack, own-props) for DX and
 * the dev toolbar inspector. The dev/prod line is the build variant (the
 * bundler-replaced `_SOLID_DEV_` flag behind the `development` export
 * condition), so fidelity is opt-in to dev builds and every other
 * resolution — production bundles, plain node, raw deep imports — fails
 * safe.
 *
 * Escape hatch: a value branded with `markSafeError` (`Symbol.for(
 * "solid.SafeError")`) is intentional client-facing content and passes
 * through untouched. Framework `wrapInvocation`/`transformResult` overrides
 * that map errors express intent the same way — throw a Response/envelope,
 * or brand the mapped error safe — so core never second-guesses them.
 */
export function sanitizeServerError(value) {
  if (DEV) return value;
  if (isSafeError(value)) return value;
  return new Error(GENERIC_SERVER_ERROR_MESSAGE);
} /**
 * Client-only inspection seam. A no-op on this entry so isomorphic
 * `@solidjs/web/server-functions` imports resolve.
 */
export function observeServerFunctionCalls(
  observer: (call: ServerFunctionCall) => void
): () => void;

// Client-only inspection seam. Present as a no-op so isomorphic
// `@solidjs/web/server-functions` imports resolve on the server entry.
export function observeServerFunctionCalls() {
  return () => {};
} /**
 * Builds the url a reference is called at, for integrations composing action
 * urls the runtime did not render — a router turning a bound action into a
 * `<form action>` for the no-JS path. `boundArgs` must be JSON-safe: the
 * server reads them the way it reads a form post's, and that convention has
 * no codec. Resolved against the configured endpoint, so a caller does not
 * have to know where the handler is mounted. Present on both entries so
 * isomorphic `@solidjs/web/server-functions` imports resolve.
 */
export function serverFunctionUrl(id: string, boundArgs?: readonly unknown[]): string;

/** Builds the url a reference is called at: `<endpoint>/<id>[?args=...]`. */
export function serverFunctionUrl(id, boundArgs) {
  const address = serverFunctionAddress(config.endpoint, id);
  if (!boundArgs || !boundArgs.length) return address;
  if (!isJSONSafe(boundArgs)) {
    throw new Error(
      "Bound arguments in an action url must be JSON-safe: the server reads them the way it " +
        "reads a form post's, and that convention has no codec. Pass the value through the " +
        "function's body, or call the reference instead of rendering a url for it."
    );
  }
  return `${address}?args=${encodeURIComponent(JSON.stringify(boundArgs))}`;
} /**
 * Reads the function id back out of a server-rendered action url — the
 * deconstruction half of `serverFunctionUrl`, for an integration that meets an
 * action url before the module that declared it has loaded (a router
 * synthesizing an invocation for a server component's form). Answers `null`
 * when the url is not an address. Present on both entries so isomorphic
 * `@solidjs/web/server-functions` imports resolve.
 */
export function parseServerFunctionUrl(url: string): string | null;

/** Reads the function id back out of a server-rendered action url. */
export function parseServerFunctionUrl(url) {
  const parsed = parseServerFunctionAddress(
    new URL(url, "http://localhost").pathname,
    config.endpoint
  );
  return parsed && parsed.id;
}

async function matchesOrigin(origin, request, matcher) {
  if (matcher === undefined) return origin === new URL(request.url).origin;
  if (typeof matcher === "function") return !!(await matcher(origin, request));
  return Array.isArray(matcher) ? matcher.includes(origin) : origin === matcher;
}

async function allowsServerFunctionRequest(request, options) {
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (fetchSite === "same-origin") return true;
  if (fetchSite === "same-site" || fetchSite === "cross-site" || fetchSite === "none") {
    return false;
  }

  const origin = request.headers.get("Origin");
  if (origin !== null) return matchesOrigin(origin, request, options.origin);

  const referer = request.headers.get("Referer");
  if (referer !== null) {
    try {
      return matchesOrigin(new URL(referer).origin, request, options.origin);
    } catch {
      return false;
    }
  }

  return options.allowRequestsWithoutOriginCheck === true;
}

const CSRF_VARY = ["Sec-Fetch-Site", "Origin", "Referer"];

function withCSRFVary(response) {
  const current = response.headers.get("Vary");
  if (current === "*") return response;

  const values = current ? current.split(",").map(value => value.trim()) : [];
  const names = new Set(values.map(value => value.toLowerCase()));
  for (const value of CSRF_VARY) {
    if (!names.has(value.toLowerCase())) values.push(value);
  }
  const vary = values.join(", ");

  try {
    response.headers.set("Vary", vary);
    return response;
  } catch {
    const headers = new Headers(response.headers);
    headers.set("Vary", vary);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
}

function forbiddenResponse() {
  return withCSRFVary(
    new Response(DEV ? "Forbidden" : null, {
      status: 403,
      headers: { "Cache-Control": "no-store" }
    })
  );
} /**
 * Web-standard HTTP handler for server function calls: resolves the
 * function id from the request, enforces the method allowlist (POST always
 * dispatches; GET and HEAD dispatch only to functions that declared `GET`,
 * with HEAD returning the equivalent GET's status and headers minus the
 * body; every other method answers 405), decodes arguments, runs the
 * function under a request-event scope, and encodes the result (forwarding
 * redirect/revalidation metadata through headers). Mount it on the endpoint
 * the client transport targets (default `/_server`); platform adapters (h3,
 * express, ...) convert their request shape to a web `Request` around it.
 *
 * Requests are same-origin by default. The handler accepts browser requests
 * proven by `Sec-Fetch-Site`, `Origin`, or `Referer`, and rejects requests
 * without usable metadata unless explicitly configured otherwise. GET/HEAD
 * requests to `GET`-declared functions skip this gate: they are reads by
 * contract, cross-site response READING is already blocked by same-origin
 * policy, and skipping it keeps the `Vary: Sec-Fetch-Site, Origin, Referer`
 * it would impose off the responses shared caches are meant to store.
 *
 * Every response leaves with `Cache-Control: no-store` unless the function
 * set its own cache policy (via `respond()` headers or a returned
 * `Response`) — caching is opt-in on the wire, not just in prose.
 *
 * When the event carries a `response` head stub (`event.response`, see the
 * server entry's `ResponseStub`), the handler folds it onto every outgoing
 * response as the head freezes — its `Set-Cookie` values (cookies appended
 * during the call) append cookie-by-cookie alongside the result's own,
 * other stub headers fill gaps (the call's response metadata wins; the
 * protocol-owned family — the error/format/single-flight tags, `Location`,
 * `X-Revalidate` — never fills, and neither does `Content-Type`/`Content-
 * Length` onto a bodiless response) — and marks the stub `committed`, so
 * later cookie/header writes report instead of silently missing the wire.
 *
 * ## Thrown-error sanitization (security default)
 *
 * A thrown `Response`/envelope (`redirect`/`reload`/`respond`) is intentional
 * control flow and is forwarded untouched. A *plain* thrown value (a bare
 * `Error`, string, or object) is different: serialized verbatim it would ship
 * its `message` and every own-property to the client — a driver/ORM error's
 * failing query, connection string, or bound parameters included. So outside
 * the dev build a plain thrown value is replaced with a generic `Error`
 * before serialization; the client still receives *an* `Error` (the shape
 * `submission.error` etc. expect), just with no leaked content. The dev
 * build keeps full fidelity (message, stack, own-props) for DX and the dev
 * toolbar inspector. Dev/prod is the BUILD VARIANT, not `NODE_ENV`:
 * `@solidjs/web` publishes a dev copy of this entry behind the
 * `development` export condition (what Vite dev resolves) and the default
 * resolution sanitizes — as does importing the runtime source directly with
 * no bundler signal (fail-safe).
 *
 * Escape hatch: brand the value with `markSafeError` (`Symbol.for(
 * "solid.SafeError")`) to send its content intact in every environment.
 * A `wrapInvocation`/`transformResult` override that maps errors expresses
 * intent the same way — throw a `Response`/envelope, or brand the mapped
 * error safe; an unbranded plain error it lets propagate is sanitized like
 * any other, so a framework onError policy must brand its result to keep a
 * custom client-facing message in production.
 *
 * @example
 * ```ts
 * import { handleServerFunctionRequest } from "@solidjs/web/server-functions";
 * import "virtual:solid-server-function-manifest";
 *
 * // in the server's request handling:
 * if (url.pathname.startsWith("/_server")) {
 *   return handleServerFunctionRequest(request);
 * }
 * ```
 */
export function handleServerFunctionRequest(
  request: Request,
  options?: HandleServerFunctionOptions
): Promise<Response>;

/**
 * Web-standard HTTP handler for server function calls. Mount it on the
 * endpoint the client transport targets (default `/_server`).
 *
 * Options:
 * - `createEvent(request)`: builds the request event (default: bare
 *   `{ request, locals: {} }`). Integrations supply their richer event.
 * - `provideEvent(event, fn)`: overrides the configured provider per call.
 * - `wrapInvocation(run, context)`: wraps the function execution itself —
 *   the per-invocation seam for framework policies (per-function
 *   middleware, auth, logging, error mapping). Called inside the event
 *   scope with the invocation identity already established
 *   (`getServerFunctionInvocation()` answers before, during and after
 *   `run()`); the context carries `{ id, args, event, request, direct }`.
 *   Must return (or resolve to) `run()`'s result — replacing it replaces
 *   the function's result. The configured hook (see
 *   `configureServerFunctionsServer`) also wraps direct SSR calls, where
 *   `context.direct` is `true` and `request` is absent.
 * - `transformResult(event, result, context)`: observes/replaces the result
 *   before encoding — the extension point for response metadata policies.
 *   The context carries the call's identity (`id`, parsed `args`) alongside
 *   the transport fields, matching `transformDirectResult`'s. Return a
 *   `ResponseEnvelope` (from ../response.js) to send HTTP metadata +
 *   payload.
 * - `collectFlightData(event, outcome)`: overrides the configured
 *   single-flight hook for this handler. Runs after `transformResult`,
 *   for scripted calls that sent the single-flight request header, on
 *   returned results and thrown Response/envelope signals alike (plain
 *   thrown errors never collect). The outcome carries the unwrapped
 *   `value`, the HTTP-metadata `response` (redirect location, revalidation
 *   keys), the `request`, the function `id`, and `thrown`. Whatever data
 *   payload it returns (undefined for none) is folded into the body as
 *   `{ value, data }` under the single-flight response header — the
 *   handler owns the enveloping, the hook owns the data.
 * - `transformFlightResult(event, outcome, context)`: overrides the
 *   configured single-flight fold policy for this handler. When the flight
 *   payload needs a body only a policy knows how to build (frames — an
 *   invalidated entry is markup), it gets first refusal on the
 *   `{ value, data }` outcome; returning a Response carries the outcome
 *   (call headers and cookies copied on), returning undefined keeps the
 *   plain serialized envelope.
 * - `handleNoJS(result, request, args)`: response for calls made without
 *   the client runtime (no instance header) — the override for the no-JS
 *   form convention. Falls back to the configured hook, then to
 *   `createNoJSHandler()` for browser form posts (redirect back with the
 *   outcome in a flash cookie); other no-instance callers, such as direct
 *   HTTP requests, get the normal serialized response.
 * - `csrf`: configures same-origin request validation, or disables it with
 *   `false`. Enabled by default.
 * - `codec`: overrides the configured codec options for this handler.
 */
export async function handleServerFunctionRequest(request, options = {}) {
  const codec = options.codec !== undefined ? options.codec : getServerFunctionsCodec();
  const url = new URL(request.url);
  const method = request.method;
  const address = resolveAddress(url);
  const functionId = address && address.id;
  // GET-declared functions are reads by contract, and the read methods are
  // exactly where the CSRF gate costs more than it buys: same-origin policy
  // already prevents a cross-site caller from READING the response, while
  // the gate's `Vary: Sec-Fetch-Site, Origin, Referer` fragments (or, on
  // CDNs that ignore Vary, poisons) the shared-cache entries the GET helper
  // exists to enable (#3071). State-changing dispatch (POST) stays gated.
  const declaredRead =
    (method === "GET" || method === "HEAD") &&
    functionId !== null &&
    METHODS.get(functionId) === "GET";
  const csrf = options.csrf !== undefined ? options.csrf : config.csrf;
  const protectsRequest = csrf !== false && !declaredRead;
  if (protectsRequest && !(await allowsServerFunctionRequest(request, csrf === true ? {} : csrf))) {
    return finalizeTransportResponse(forbiddenResponse(), method);
  }
  const instance = request.headers.get(INSTANCE_HEADER);

  if (!functionId) {
    const response = new Response(DEV ? "Server function not found" : null, { status: 404 });
    return finalizeTransportResponse(protectsRequest ? withCSRFVary(response) : response, method);
  }

  // Which of the two answer shapes this call gets — codec encodings for the
  // client transport, plain HTTP for everyone else — is decided by the
  // ADDRESS: the data address IS the scripted protocol, the bare address is
  // plain HTTP. On the url, not a header, because shared caches key on the
  // url and store one answer per key — a header-driven shape means one
  // caller kind's cached answer can be replayed to the other (#3094).
  //
  // TRANSITIONAL (remove before 2.0 stable): clients that predate the data
  // address signal scripted-ness with the instance header on the bare
  // address — an already-loaded tab keeps working across a server deploy.
  // Honoring it reopens the shared-url shape divergence, so answers it
  // shapes are never cacheable (see the no-store where dispatch's answer
  // meets the transport).
  const scripted = address.data || !!instance;

  let serverFunction;
  try {
    serverFunction = getServerFunction(functionId);
  } catch {
    // Labelled (#3110): the address is well-formed but its id is not part
    // of this deployment — the wire shape of version skew (a tab holding
    // the previous build's ids) or a genuinely removed function. Without
    // the label this 404 is indistinguishable from a CDN's or a proxy's,
    // and the one recovery that works — reload onto the current build —
    // cannot be targeted. The meaningless-path 404 above stays bare: a
    // mistyped route is not skew.
    const response = new Response(DEV ? `Unknown server function: ${functionId}` : null, {
      status: 404,
      headers: { [UNKNOWN_HEADER]: "true" }
    });
    return finalizeTransportResponse(protectsRequest ? withCSRFVary(response) : response, method);
  }

  // Method allowlist: POST always dispatches (the default transport);
  // GET and HEAD dispatch only to functions that declared GET (the server
  // half of `GET` records them) — no crafted read URLs against functions
  // that never opted in, and no side door through OTHER verbs either
  // (before #3069 a HEAD — sent freely by link checkers, uptime probes and
  // prefetchers — bypassed the gate entirely and executed any registered
  // function). Declaring GET grants the read methods without revoking POST:
  // the same function stays callable over the default transport (e.g. a
  // query()-wrapped function also called directly).
  if (method !== "POST" && !declaredRead) {
    const response = new Response(
      DEV ? `Method not allowed for server function: ${functionId}` : null,
      {
        status: 405,
        headers: { Allow: METHODS.get(functionId) === "GET" ? "POST, GET, HEAD" : "POST" }
      }
    );
    return finalizeTransportResponse(protectsRequest ? withCSRFVary(response) : response, method);
  }

  const event = options.createEvent ? options.createEvent(request) : { request, locals: {} };
  const provide = options.provideEvent || provideEvent;
  const flightHook =
    options.collectFlightData !== undefined ? options.collectFlightData : config.collectFlightData;
  // Same fallback pattern: a generic dispatcher calling
  // handleServerFunctionRequest(request) with no options still gets the
  // configured transform (frames installs itself here once, server-wide).
  const transformResult =
    options.transformResult !== undefined ? options.transformResult : config.transformResult;
  const wrapInvocation =
    options.wrapInvocation !== undefined ? options.wrapInvocation : config.wrapInvocation;
  const transformFlightResult =
    options.transformFlightResult !== undefined
      ? options.transformFlightResult
      : config.transformFlightResult;
  // Same fallback, then the built-in convention: an unconfigured app still
  // gets working progressive enhancement for real form posts, while direct
  // HTTP calls keep the plain response.
  const handleNoJS =
    options.handleNoJS !== undefined
      ? options.handleNoJS
      : config.handleNoJS !== undefined
        ? config.handleNoJS
        : isFormPost(request)
          ? defaultNoJSHandler || (defaultNoJSHandler = createNoJSHandler())
          : undefined;
  // single-flight is scripted-client opt-in: the caller sends the request
  // header naming the sources it can consume ("true" is the unnamed hook —
  // and the whole header, for clients that predate named sources), the
  // server must have hooks to produce the data. Only advertised sources
  // run: a client that never subscribed a source's consumer never pays for
  // its collection. Unrecognized-but-present headers (a hand-tagged
  // request from an older integration) fall back to the unnamed hook, so
  // any value that opted in before still opts in.
  const flightHeader = scripted ? request.headers.get(SINGLE_FLIGHT_HEADER) : null;
  const flightHooks = flightHeader
    ? flightHeader.split(",").flatMap(source => {
        const hook = source === "true" ? flightHook : flightSources.get(source);
        return hook ? [[source, hook]] : [];
      })
    : [];
  if (flightHeader && flightHooks.length === 0 && flightHook) {
    flightHooks.push(["true", flightHook]);
  }
  const collectsFlight = flightHooks.length > 0;

  let parsed;
  try {
    parsed = await parseArguments(request, url, scripted, codec);
  } catch {
    // A query that is not the encoding it claims to be is a malformed
    // request, not a failing call: 400 keeps it out of the function's error
    // channel, and answers the same way for every caller of that url.
    const response = new Response(DEV ? "Malformed server function arguments" : null, {
      status: 400
    });
    return finalizeTransportResponse(protectsRequest ? withCSRFVary(response) : response, method);
  }

  // What the fold needs to build a body itself, and what a result transform
  // needs to know to leave one for it. The call's identity (`id`, parsed
  // `args`) rides along, mirroring `transformDirectResult`'s context — a
  // policy keying state by the call (deriving a wire address, capturing a
  // prerender artifact) sees the same shape over either dispatch path.
  const flightContext = {
    id: functionId,
    args: parsed,
    instance,
    request,
    collectsFlight,
    codec,
    transformFlightResult
  };

  const headers = new Headers();
  // The whole dispatch funnels through one seam so every outgoing response
  // — encoded results, raw passthroughs, no-JS redirects, error bodies —
  // gets the event's response stub folded on and the stub marked committed
  // (see `commitEventResponse`). This is how cookies appended onto
  // `event.response.headers` during a server function reach the wire.
  const dispatch = async () => {
    try {
      let result = await provide(event, async () => {
        // Identity is established BEFORE the wrapper runs, so
        // getServerFunctionInvocation() answers throughout the wrap — code
        // ahead of run() (auth, logging) included.
        INVOCATIONS.set(event, { id: functionId });
        const run = () => serverFunction(...parsed);
        return wrapInvocation
          ? wrapInvocation(run, { id: functionId, args: parsed, event, request, direct: false })
          : run();
      });

      if (transformResult) {
        result = await transformResult(event, result, flightContext);
      }

      let status = 200;
      let metadata;
      // envelope (from `respond()` or transformResult): HTTP metadata + value
      if (isResponseEnvelope(result)) {
        const { response, value } = result;
        // consumers without the client runtime get the carried response
        // whole — e.g. respond()'s real JSON body (invisible PE)
        if (!scripted && !handleNoJS && response && response.body) {
          return response;
        }
        if (response && response.headers) {
          mergeResponseHeaders(headers, response.headers);
        }
        // Forward the status — except the statuses fetch FOLLOWS, for
        // scripted callers: the transport would never see the 3xx (and
        // `redirect: "manual"` yields an opaque response with the Location
        // unreadable), so redirect intent travels masked, as 200 + Location
        // metadata for the client integration to act on. Only the followable
        // set masks (see validRedirectStatuses) — a 304 is not a redirect
        // and is the natural answer for a conditional read (#3096) — and
        // unscripted callers always get real HTTP.
        if (
          response &&
          response.status &&
          (!scripted || !validRedirectStatuses.has(response.status))
        ) {
          status = response.status;
        }
        metadata = response;
        result = value;
      } else if (result instanceof Response) {
        // raw responses pass through untouched
        if (result.headers && result.headers.has("X-Content-Raw")) return result;
        if (scripted) {
          // forward headers
          if (result.headers) {
            mergeResponseHeaders(headers, result.headers);
          }
          // forward statuses fetch would not follow (redirect handling is
          // the client integration's job — the fetch call must not follow
          // it); non-redirect 3xx like 304 pass through (#3096)
          if (result.status && !validRedirectStatuses.has(result.status)) {
            status = result.status;
          }
          metadata = result;
          if (result.body == null) {
            result = null;
          }
        }
      }

      if (collectsFlight) {
        result = await foldFlightData(
          flightHooks,
          event,
          headers,
          {
            id: functionId,
            value: result,
            response: metadata,
            request,
            thrown: false
          },
          flightContext
        );
        // The fold built the body itself (markup in the payload) — it already
        // carries the accumulated headers.
        if (result instanceof Response && result.headers.has("X-Content-Raw")) return result;
      }

      // calls made without the client runtime (no-JS form posts)
      if (!scripted) {
        // `result` is an envelope's unwrapped value here, but the no-JS
        // handler reads redirect metadata off its argument — hand it the
        // envelope's response when the value is empty, matching what the
        // thrown path passes (#3096: a returned redirect envelope must
        // navigate a form post too).
        if (handleNoJS) return handleNoJS(result ?? metadata, request, parsed);
        if (result instanceof Response) return result;
        // the envelope's status forwards for unscripted callers too — this
        // used to hardcode 200 where the thrown path forwarded it (#3096)
        return encodeResult(result, headers, status, codec, request.signal);
      }

      return encodeResult(result, headers, status, codec, request.signal);
    } catch (x) {
      if (x instanceof Response || isResponseEnvelope(x)) {
        if (transformResult) {
          x = await transformResult(event, x, { ...flightContext, thrown: true });
        }
        let status = 200;
        let metadata;
        if (isResponseEnvelope(x)) {
          const { response, value } = x;
          if (response && response.headers) {
            mergeResponseHeaders(headers, response.headers);
          }
          if (
            response &&
            response.status &&
            (!scripted || !validRedirectStatuses.has(response.status))
          ) {
            status = response.status;
          }
          metadata = response;
          x = value;
        } else if (x instanceof Response) {
          if (x.headers) {
            mergeResponseHeaders(headers, x.headers);
          }
          if (x.status && (!scripted || !validRedirectStatuses.has(x.status))) {
            status = x.status;
          }
          metadata = x;
          if (x.body == null) {
            x = null;
          }
        }

        // thrown control-flow signals collect too — a thrown redirect carries
        // flight data for the destination route
        if (collectsFlight) {
          x = await foldFlightData(
            flightHooks,
            event,
            headers,
            {
              id: functionId,
              value: x,
              response: metadata,
              request,
              thrown: true
            },
            flightContext
          );
          // A thrown redirect is the common single-flight mutation shape, so
          // this is the path that carries markup for the destination — it still
          // has to be flagged as thrown for the client to re-throw it.
          if (x instanceof Response && x.headers.has("X-Content-Raw")) {
            x.headers.set(ERROR_HEADER, "true");
            return x;
          }
        }

        headers.set(ERROR_HEADER, "true");
        if (!scripted) {
          // `x` was nulled when the thrown Response had no body, but the no-JS
          // handler reads redirect metadata off the result — hand it the
          // original Response, matching what the returned path passes.
          if (handleNoJS) return handleNoJS(x ?? metadata, request, parsed, true);
          if (x instanceof Response) return x;
        }
        return encodeResult(x, headers, status, codec, request.signal);
      }

      // Plain thrown value (not a Response/envelope): the security-sensitive
      // path. Sanitized to a generic Error outside development unless branded
      // safe, so a driver/ORM error's message and own-properties never reach
      // the client (see sanitizeServerError). Both the wire body and the
      // ERROR_HEADER message derive from the sanitized value.
      const safe = sanitizeServerError(x);

      if (!scripted) {
        if (handleNoJS) return handleNoJS(safe, request, parsed, true);
        const message = safe instanceof Error ? safe.message : String(safe);
        return new Response(DEV ? message : null, { status: 500 });
      }

      const error = safe instanceof Error ? safe.message : typeof safe === "string" ? safe : "true";
      // header values are latin1 ByteStrings — Headers.set throws on anything
      // above U+00FF, so non-latin1 messages ride percent-encoded (the client
      // decodes symmetrically; the structured error still travels in the
      // body) — and bounded, so a long message cannot blow the response past
      // a receiver's header limits (see boundedErrorHeaderValue)
      headers.set(ERROR_HEADER, boundedErrorHeaderValue(error));
      // A real 500, not a 200 wearing the tag: the failure is known before a
      // byte of body exists, so the status line is still free to tell
      // intermediaries — CDN metrics, load-balancer health, log alerts —
      // what the tag tells the client (#3097). The tag stays the client's
      // authoritative signal (a failure discovered MID-STREAM still rides a
      // 200, in-band in the codec, because by then the status is spent);
      // thrown envelopes keep the author's status above.
      return encodeResult(safe, headers, 500, codec, request.signal);
    }
  };
  let response = commitEventResponse(await dispatch(), event);
  // TRANSITIONAL (leaves with the instance-header fallback above): an answer
  // the header shaped lives at the bare address, where plain-HTTP callers
  // read — a cache must never hold the codec shape there, so it is forced
  // no-store over any policy the function set (#3094). The data address is
  // untouched: one shape per url is the point of the split. Not guarded with
  // Vary because CDNs commonly refuse to store anything varying beyond
  // Accept-Encoding, which would revoke the cacheable declared reads #3071
  // restored; the reverse replay — a stored plain-HTTP entry answering a
  // LEGACY scripted reader — stays possible for author-cacheable reads until
  // that session reloads, and closes with the fallback.
  if (scripted && !address.data) {
    response = withForcedNoStore(response);
  }
  return finalizeTransportResponse(protectsRequest ? withCSRFVary(response) : response, method);
}

// TRANSITIONAL — see the call site.
function withForcedNoStore(response) {
  try {
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    // immutable headers (e.g. a raw fetch() Response passed through)
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
}

/**
 * Last-mile transport hygiene applied to every response leaving the handler.
 *
 * - `Cache-Control: no-store` unless the function set its own (via
 *   `respond()` headers or a returned Response): caching is opt-in ON THE
 *   WIRE the way the docs describe it in prose. Without the default, CDN
 *   zones with override-TTL or "cache everything" rules store per-user RPC
 *   responses (#3071).
 * - HEAD responses drop their body, as HTTP requires — the function still
 *   ran (HEAD is gated identically to GET), so status and headers are those
 *   of the equivalent GET (#3069).
 */
function finalizeTransportResponse(response, method) {
  const stripBody = method === "HEAD" && response.body !== null;
  if (stripBody || !response.headers.has("Cache-Control")) {
    try {
      if (!response.headers.has("Cache-Control")) {
        response.headers.set("Cache-Control", "no-store");
      }
      if (!stripBody) return response;
      // discard, don't leak: the encoded body may be a live codec stream
      response.body.cancel().catch(() => {});
      return new Response(null, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
    } catch {
      // immutable headers (e.g. a raw fetch() Response passed through)
      const headers = new Headers(response.headers);
      if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-store");
      if (stripBody) response.body.cancel().catch(() => {});
      return new Response(stripBody ? null : response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    }
  }
  return response;
}
