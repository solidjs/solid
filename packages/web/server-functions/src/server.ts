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
  RESPONSE_HEADER_VALUE_LIMIT,
  REVALIDATE_HEADER,
  isResponseEnvelope,
  isSafeError
} from "../../src/response.js";
import { COMPOSED_BODY_FRAMING, isHttpNavigationTarget } from "../../src/constants.js";
import { RequestContext, commitEventResponse, getRequestEvent } from "../../src/server.js";
import { encodeFlashCookie } from "./flash.js";
import {
  BODY_FORMAT_HEADER,
  BodyFormat,
  ERROR_HEADER,
  INSTANCE_HEADER,
  LIVE_SOURCE,
  REDIRECT_HEADER,
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
  encodeErrorTrailer,
  withMeta
} from "./shared.js";

export {
  ERROR_HEADER,
  FLASH_COOKIE,
  INSTANCE_HEADER,
  REDIRECT_HEADER,
  SERVER_FUNCTION_INVOKE,
  SINGLE_FLIGHT_HEADER,
  UNKNOWN_HEADER,
  clearFlashCookie,
  decodeErrorHeaderValue,
  decodeRedirectHeaderValue,
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

// Local bindings for the annotations below — the `export type` block only
// re-exports these names without bringing them into scope, and declaration
// emit would leave them dangling (implicit any for every consumer).
import type { ServerFunction, ServerFunctionMetadata } from "./shared.js";

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
  /**
   * Applies the origin gate to GET-declared reads as well. By default the
   * gate is skipped for declared reads: same-origin policy already keeps a
   * cross-site caller from READING the response, and the gate's `Vary`
   * fragments (or, on CDNs that ignore Vary, poisons) the shared-cache
   * entries the `GET` helper exists to enable (#3071). The premise that
   * skip rests on is `GET()`'s safety contract — declared reads are safe
   * to EXECUTE from any origin (#3114). A deployment that does not rely
   * on shared caches can enable this to gate its reads too.
   * @default false
   */
  protectDeclaredReads?: boolean;
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
   * `decodeResponse` sees them too. When `serializeErrorStacks` is omitted,
   * the server-function boundary defaults it from this module's compiled
   * development variant.
   */
  codec?: JSONCodecOptions;
  /**
   * Upper bound, in bytes, on a call's argument payload — the POST body,
   * or the `?args=` query encoding. The payload is buffered and decoded
   * before dispatch, so its cost is paid before application code can
   * decline it; the bound is enforced up front and a request over it is
   * refused with `413` before any decoding (#3115). Raise it for functions
   * that accept large uploads, or set `Infinity` to remove the bound.
   * @default 1_048_576 (1 MiB)
   */
  bodySizeLimit?: number;
  /**
   * Upper bound on the number of arguments a call may carry. The decoded
   * argument array is spread into the function call, so an unbounded list
   * forces a range error out of any function regardless of what it does;
   * past the bound the request is refused with `400` (#3115).
   * @default 1000
   */
  maxArguments?: number;
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
  /**
   * Overrides the configured argument payload bound for this handler (see
   * `ServerFunctionsServerConfig.bodySizeLimit`).
   */
  bodySizeLimit?: number;
  /**
   * Overrides the configured argument count bound for this handler (see
   * `ServerFunctionsServerConfig.maxArguments`).
   */
  maxArguments?: number;
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
  csrf: true,
  bodySizeLimit: 1_048_576,
  maxArguments: 1000
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
  codec,
  bodySizeLimit,
  maxArguments
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
  if (bodySizeLimit !== undefined) config.bodySizeLimit = bodySizeLimit;
  if (maxArguments !== undefined) config.maxArguments = maxArguments;
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

// Calling a generator only allocates it; calling a stream's reader is what
// runs its pull. A request scope around the function CALL therefore does not
// own either body. Bind each deferred operation to the event explicitly so
// direct SSR calls keep their per-call event after the proxy has returned.
// Non-deferred values pass through by identity and synchronously.
function scopeDeferredResult(value, scope) {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return value;

  const promised = scope(() => nativePromise(value));
  if (promised) {
    return promised.then(result => scope(() => scopeDeferredResult(result, scope)));
  }

  if (typeof ReadableStream !== "undefined" && value instanceof ReadableStream) {
    let reader;
    return new ReadableStream(
      {
        async pull(controller) {
          try {
            const step = await scope(() => {
              if (!reader) reader = value.getReader();
              return reader.read();
            });
            if (step.done) controller.close();
            else controller.enqueue(step.value);
          } catch (error) {
            controller.error(error);
          }
        },
        cancel(reason) {
          return scope(() => (reader ? reader.cancel(reason) : value.cancel(reason)));
        }
      },
      { highWaterMark: 0 }
    );
  }

  const scopedIterator = symbol => ({
    [symbol]() {
      const iterator = scope(() => value[symbol]());
      return new Proxy(iterator, {
        get(target, property) {
          const member = Reflect.get(target, property, target);
          return typeof member === "function" &&
            (property === "next" || property === "return" || property === "throw")
            ? (...args) => scope(() => member.apply(target, args))
            : member;
        }
      });
    }
  });
  if (typeof value[Symbol.asyncIterator] === "function") {
    return scopedIterator(Symbol.asyncIterator);
  }

  // Collections are synchronously materialized results, not deferred
  // executions. Keep their type and identity; the branch is for generator
  // and custom-iterator bodies whose next() runs authored code.
  if (
    typeof value[Symbol.iterator] === "function" &&
    !Array.isArray(value) &&
    !(value instanceof Map) &&
    !(value instanceof Set) &&
    !ArrayBuffer.isView(value)
  ) {
    return scopedIterator(Symbol.iterator);
  }

  return value;
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
// user/integration space, not the runtime's — and its per-call copy
// (#3156) makes writes call-local, which is the wrong lifetime for state
// the wrapper established before the copy existed.
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
  // A `GET()` declaration is made ABOUT a function, not about an id — it
  // grants GET dispatch and the origin-gate exemption (#3114), and both
  // must die with the binding they were granted to. Rebinding the id to a
  // different function (an id collision between integrations, a module
  // re-evaluated in a live process after an edit dropped the wrapper)
  // otherwise leaves the grant governing a function that never signed it:
  // a mutation reachable over GET, from any origin, with ambient cookies
  // (#3129). A function that still declares GET re-runs `GET()` right
  // after re-registering — module order guarantees it — so the grant
  // re-arms itself exactly when it is still meant.
  if (REGISTRATIONS.get(id) !== callback) METHODS.delete(id);
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
      // `locals` is copied per call, not shared (#3156). Reads still see
      // everything middleware put on the render's event — the only road
      // per-request context (auth, tenant, DB handle) has into an SSR-time
      // call — and nested objects stay shared by reference, so a
      // request-scoped cache or client keeps working. What dies is the
      // cross-call write channel: two concurrent direct calls assigning
      // `locals.x` overwrote each other AND the render, silently and
      // interleaving-dependent — exactly why the runtime itself keeps
      // invocation state out of locals (see INVOCATIONS). `event.response`
      // stays shared on purpose: a cookie set during SSR reaching the page
      // head is the point of the stub.
      const evt = { ...ogEvt, locals: { ...ogEvt.locals } };
      // Keyed on the derived event: the invocation is visible exactly within
      // this call's provideEvent scope and evaporates with the derived event.
      INVOCATIONS.set(evt, { id });
      evt.serverOnly = true;
      const scope = run => provideEvent(evt, run);
      let result = provideEvent(evt, () => {
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
      // A generator or stream body runs when the caller pulls it, after the
      // call-time scope above has gone. Bind the WRAPPER'S result (not merely
      // fn's) so a deferred wrapInvocation keeps the same semantics.
      result = scopeDeferredResult(result, scope);
      // In-process mirror of the handler's transformResult: direct SSR calls
      // pass their settled value through the configured policy (e.g. frames
      // wrapping a function result as an inline-renderable server component).
      // `args` rides along so a policy can derive the call's wire address
      // (`frameAddress`) — the same one the client derives for the same call.
      const transform = config.transformDirectResult;
      if (transform && result && typeof result.then === "function") {
        return result.then(value =>
          scopeDeferredResult(transform(value, { id, args, event: evt }), scope)
        );
      }
      return transform
        ? scopeDeferredResult(transform(result, { id, args, event: evt }), scope)
        : result;
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
 * DECLARING GET IS A SAFETY ASSERTION, not only a transport choice: the
 * CSRF origin gate is skipped for declared reads by design (same-origin
 * policy already keeps a cross-site caller from READING the response, and
 * the gate's `Vary` would fragment the shared-cache entries this helper
 * exists to enable), so a GET-declared function is EXECUTABLE from any
 * origin, with caller-chosen arguments, carrying the user's ambient
 * cookies — a cross-site `<form method="GET">` or top-level navigation
 * reaches it (#3114). Declare GET only for reads that are safe in the
 * HTTP sense (RFC 9110 §9.2.1): nothing a hostile caller gains by
 * triggering it — no quota burn, no audit write, no mail, nothing
 * expensive enough to be a denial-of-service lever. Anything less stays
 * on POST, which remains origin-gated; a deployment that does not rely on
 * shared caches can gate its reads too with
 * `csrf: { protectDeclaredReads: true }`.
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
 * Declaring GET is a safety assertion (see the public overload's notes and
 * #3114): the origin gate is skipped for declared reads, so the function
 * is executable from any origin with the user's ambient cookies — it must
 * be a safe read in the RFC 9110 §9.2.1 sense.
 *
 * The declaration is about the FUNCTION, not the id: registering a
 * different function under the same id revokes it (#3129), and the new
 * function's own `GET()` — which module order runs right after the
 * re-registration — is what re-grants it.
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
 * event (never in `event.locals`, which is user/integration space and is
 * copied per derived call — #3156). Distinct from `getServerFunctionMetadata(fn)`, which reads
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

// Mirrors the codec's JSON_CODEC_DEPTH_LIMIT (serialization/serializer-decode):
// the seroval path enforces it because payloads may come from an untrusted
// peer, but the body FORMAT is the caller's choice — selecting the plain
// JSON format handed the payload to a bare JSON.parse and skipped the cap
// entirely (#3119). This applies the same ceiling to that road.
const DECODE_DEPTH_LIMIT = 64;

/**
 * Breadth-first depth check over a decoded plain-JSON payload. Iterative on
 * purpose: the attack input is deep nesting, and a recursive walk would
 * re-create the stack overflow the cap exists to prevent. `JSON.parse`
 * output is acyclic and prototype-free, so plain enumeration covers it.
 */
function assertDecodeDepth(value) {
  let level = [value];
  for (let depth = 0; level.length > 0; depth++) {
    if (depth > DECODE_DEPTH_LIMIT) {
      throw new TypeError("Server function arguments exceed the decode depth limit");
    }
    const next = [];
    for (const node of level) {
      if (node === null || typeof node !== "object") continue;
      if (Array.isArray(node)) {
        for (const child of node) next.push(child);
      } else {
        for (const key of Object.keys(node)) next.push(node[key]);
      }
    }
    level = next;
  }
}

/**
 * Strips prototype-mutating keys from a decoded argument graph, in place.
 *
 * Both decode roads preserve the key faithfully — `JSON.parse` creates it
 * as an ordinary own property and the codec round-trips it the same way —
 * and core itself is unharmed: `Object.prototype` is never touched. What
 * the key subverts is the handler's most ordinary downstream move:
 * `Object.assign` merges by [[Set]], so merging a decoded argument into a
 * fresh object re-prototypes the copy with attacker-supplied data (#3168).
 * This boundary already makes decisions of exactly this class — the decode
 * depth cap, the RegExp exclusion, the argument-count bound — so the key
 * is stripped here at the seam rather than documented away.
 *
 * The walk is iterative (the codec revives cyclic graphs, and depth is the
 * attack input on the JSON road) with a visited set for cycles. It reaches
 * plain objects and arrays, plus the values and keys of revived Maps and
 * Sets, and enumerable properties on revived non-plain objects. Containers
 * keep their shape — the codec owns their construction, not this guard.
 */
const UNSAFE_ARGUMENT_KEYS = ["__proto__", "constructor", "prototype"];

function stripUnsafeArgumentKeys(value) {
  const stack = [value];
  const seen = new Set();
  while (stack.length) {
    const v = stack.pop();
    if (v === null || typeof v !== "object" || seen.has(v)) continue;
    seen.add(v);
    // Mutating in place never required a plain prototype. Strip every
    // container, then walk both own metadata and collection contents.
    for (const key of UNSAFE_ARGUMENT_KEYS) {
      delete v[key];
    }
    for (const key of Object.keys(v)) stack.push(v[key]);
    if (v instanceof Map) {
      for (const [k, entry] of v) stack.push(k, entry);
    } else if (v instanceof Set) {
      for (const member of v) stack.push(member);
    }
  }
  return value;
}

/**
 * Buffers a POST body that declared no length (chunked transfer), refusing
 * once it runs past the limit — a declared length is enforced by the HTTP
 * server's own framing and is checked against the limit before this runs.
 * The original body is read, not a clone: cancellation must tear down the
 * upload source rather than one branch of a tee (#3219). On success the
 * consumed body is replaced so the ordinary decoder can still read it.
 * Returns that replacement Request, or `null` past the limit.
 */
async function bufferBodyWithin(request, limit) {
  const reader = request.body.getReader();
  const signal = request.signal;
  const chunks = [];
  let total = 0;
  // Fetch does not couple a Request's signal to an arbitrary body stream.
  // Wake a pending read by cancelling its real reader when the host tells us
  // the request is gone (#3218); every cancel promise is observed so a
  // rejecting source cannot become an unhandled rejection.
  const onAbort = () => {
    reader.cancel(signal.reason).catch(() => {});
  };
  if (signal.aborted) onAbort();
  else signal.addEventListener("abort", onAbort, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw signal.reason;
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch (error) {
    reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(request, { body });
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
    let result;
    if (args.startsWith(";0x")) {
      result = await deserializeString(args, codec);
    } else {
      // The framed codec enforces its own depth cap; bare JSON must not be
      // the uncapped alternative (#3119).
      result = JSON.parse(args);
      assertDecodeDepth(result);
    }
    if (!Array.isArray(result)) {
      throw new TypeError("Server function arguments must encode an array");
    }
    stripUnsafeArgumentKeys(result);
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
    // Both argument-array encodings: codec-framed and plain JSON. The
    // framed codec enforces its own depth cap during decode; bare JSON
    // must not be the uncapped alternative (#3119). Either way the payload
    // is spread into the call, so anything but an array is malformed — a
    // 400, not a range error out of the function.
    if (bodyFormat === BodyFormat.Serialized || bodyFormat === BodyFormat.Json) {
      if (bodyFormat === BodyFormat.Json) assertDecodeDepth(decoded);
      if (!Array.isArray(decoded)) {
        throw new TypeError("Server function arguments must encode an array");
      }
      return stripUnsafeArgumentKeys(decoded);
    }
    if (decoded === undefined) {
      // Node hosts commonly construct a web Request from the incoming socket
      // stream even when the POST had no payload. The Fetch body is then
      // non-null, but there is still no argument to decode (#3214). Inspect
      // the bytes rather than trusting Content-Length: an adapter or proxy
      // can preserve a stale zero while supplying a non-empty stream.
      if (bodyFormat === null && (await request.clone().arrayBuffer()).byteLength === 0) {
        return parsed;
      }
      // The decode switch fell through: the format tag — or its duplicate-
      // header comma join, which `Headers` produces silently — names no
      // encoding this runtime has. Refusing is the point: substituting
      // `undefined` for the body calls the function on an argument it was
      // never sent, and the mutation commits and answers 200 (#3130). The
      // throw lands on dispatch's malformed-arguments 400, the same answer
      // a single unusable tag already earned from the codec.
      throw new TypeError("Server function body carries no usable encoding");
    }
    parsed.push(decoded);
  }
  return parsed;
}

/**
 * Runs the single-flight hooks and standardizes their contribution: each
 * `[source, hook]` pair that returns data is folded into the body's
 * `{ value, data }` payload, and the response's single-flight header names
 * the folded sources — the client routes slices to consumers by it. The
 * envelope is always keyed by source id, `{ [source]: slice, ... }` — the
 * unnamed hook's slice rides under its reserved id "true" like any other,
 * so the payload shape is one shape, not two. When every hook declines the
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
  const data = Object.fromEntries(folded);
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
      // Ownership BEFORE the first stamp (#3234, completing #3155): nothing
      // in the hook's contract says the Response is freshly built, and a
      // policy that memoizes its body would otherwise accumulate every
      // caller's session cookies permanently — the thrown path's tail copies
      // for exactly this reason, but only after these writes have already
      // landed on the shared object.
      const owned = ownResponse(transformed);
      // Headers accumulated during the call (the mutation's cookies, an
      // envelope's metadata) belong on whatever body carries the outcome.
      for (const cookie of headers.getSetCookie()) owned.headers.append("Set-Cookie", cookie);
      headers.forEach((value, key) => {
        if (key !== "set-cookie" && !owned.headers.has(key)) {
          owned.headers.set(key, value);
        }
      });
      return owned;
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
    if (key !== "set-cookie" && !COMPOSED_BODY_FRAMING.has(key)) target.append(key, value);
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
// the dispatch masks to 200 + REDIRECT_HEADER for scripted callers — the
// rest of the 3xx band (304 notably) is never followed by fetch and
// forwards as-is.
const validRedirectStatuses = new Set([301, 302, 303, 307, 308]);

// A scripted caller can never see a real 3xx — fetch follows the redirect
// statuses before the transport reads them (`redirect: "manual"` yields an
// opaque response with the Location unreadable) — so the redirect is masked
// to 200 and carried whole in REDIRECT_HEADER: the author's status plus the
// target RESOLVED against the request url, exactly the meaning HTTP assigns
// the Location a form post to this address would have received (#3102).
// Resolving server-side removes the reader's string-shape guess between
// relative and absolute spellings (#3107) — both arrive as the same
// absolute url by construction. Location itself is dropped from the masked
// answer: on a 200 it has no HTTP meaning, and it collided with authored
// Locations on statuses that forward (a 201's created-at is data, not
// navigation).
function maskRedirect(headers, response, requestUrl) {
  const target = response.headers && response.headers.get("Location");
  if (target) {
    headers.set(REDIRECT_HEADER, `${response.status} ${new URL(target, requestUrl)}`);
  }
  headers.delete("Location");
}

// The transport half of redirect()'s and initWithRevalidate's bound
// (#3158): an over-long response header is not delivered — the proxy drops
// or rejects it AFTER the handler committed its mutation, leaving the
// caller a socket-level error naming nothing — and a hand-built Response
// reaches this transport with no helper in the loop (a ~1 MB Location
// became a ~1 MB redirect header on the wire). The invariant lives HERE,
// at the edge where the composed headers leave, one check for every
// producer — returned or thrown, raw or envelope-carried, scripted mask or
// plain passthrough — and the helpers' own throws (inside the function
// body, with the legible authoring-time message) become the fast path
// rather than the only guard. Refused, never trimmed, for the helpers' own
// reasons: a cut target is a DIFFERENT address, a dropped revalidate key is
// a silently stale cache. Runs ahead of the stub fold so integration
// cookies still ride the refusal (#3159).
const BOUNDED_COMPOSED_HEADERS = [REDIRECT_HEADER, "Location", REVALIDATE_HEADER];

// Scheme floor for outgoing navigation targets (#3175): only http(s) — or a
// scheme-less relative form, which resolves against an http(s) request url —
// may leave on a navigation header. maskRedirect resolves `Location` with
// `new URL(target, requestUrl)`, where an absolute scheme WINS over the
// base, so the classic open-redirect shape (`throw redirect(next)` with
// `next` from a query param) emitted `javascript:alert(document.cookie)` as
// the header's "resolved absolute target" — same-origin script execution in
// any integration that navigates to the decoded value. This is the floor,
// not the policy: cross-origin http(s) (OAuth hand-offs) still flows — the
// same-origin-vs-allowlist ruling is a separate, pending decision — and a
// custom app scheme (deep links) is refused by default until that ruling
// gives it an opt-in. The decoder enforces the same floor independently
// (decodeRedirectHeaderValue), so a hostile peer cannot re-open the class
// against integrations either. The shared parser also guards late streaming
// SSR redirects before they become executable script.

// The transport half of redirect()'s and initWithRevalidate's invariants:
// composed-header BOUNDS (#3158 — an over-long header dies at a proxy
// AFTER the mutation committed) and the navigation-target scheme floor
// (#3175 — see above). The invariants live HERE, at the edge where the
// composed headers leave, one check for every producer — returned or
// thrown, raw or envelope-carried, scripted mask or plain passthrough —
// and the helpers' own throws (inside the function body, with the legible
// authoring-time message) become the fast path rather than the only guard.
// Refused, never trimmed or stripped, for the helpers' own reasons: a cut
// or rewritten target is a DIFFERENT address, a dropped revalidate key is
// a silently stale cache. Runs ahead of the stub fold so integration
// cookies still ride the refusal (#3159).
function enforceComposedHeaderInvariants(response) {
  for (const name of BOUNDED_COMPOSED_HEADERS) {
    const value = response.headers.get(name);
    if (value === null) continue;
    if (value.length > RESPONSE_HEADER_VALUE_LIMIT) {
      return refuseComposedHeader(
        response,
        name,
        `${name} response header refused at ${value.length} characters`,
        DEV
          ? `The ${name} response header is ${value.length} characters; past ` +
              `${RESPONSE_HEADER_VALUE_LIMIT} it would overflow receivers (an 8 KiB proxy ` +
              `buffer holds the whole header block) and the response dies at the socket after ` +
              `the mutation committed. Refused rather than trimmed: a cut redirect target is a ` +
              `different address, a dropped revalidate key is a silently stale cache. The ` +
              `redirect()/reload() helpers enforce this bound with the full reasoning at the ` +
              `call site.`
          : null
      );
    }
    if (name === REVALIDATE_HEADER) continue;
    // REDIRECT_HEADER rides as "<status> <target>"; Location is the target
    const target = name === REDIRECT_HEADER ? value.slice(value.indexOf(" ") + 1) : value;
    if (!isHttpNavigationTarget(target)) {
      return refuseComposedHeader(
        response,
        name,
        `${name} response header refused: non-http(s) navigation target`,
        DEV
          ? `The ${name} response header carries a navigation target with a non-http(s) ` +
              `scheme ("${target.slice(0, 64)}"). A javascript: target is same-origin script ` +
              `execution in any integration that navigates to it, so only http(s) and ` +
              `relative targets leave this transport. If the target came from request data ` +
              `(?next= and friends), validate it against your own origin before redirecting.`
          : null
      );
    }
  }
  return response;
}

function refuseComposedHeader(response, name, headerMessage, body) {
  // the replaced body's producers may be demand-parked — release them
  if (response.body) {
    try {
      const cancelled = response.body.cancel();
      if (cancelled && typeof cancelled.then === "function") cancelled.then(undefined, () => {});
    } catch {}
  }
  const headers = new Headers();
  headers.set(
    ERROR_HEADER,
    boundedErrorHeaderValue(DEV ? headerMessage : GENERIC_SERVER_ERROR_MESSAGE)
  );
  return new Response(body, { status: 500, headers });
}

// Dev-only (#3101): a 304 forwards transparently — it is not a redirect,
// and unscripted callers need the real status — but the scripted transport
// sends no conditional headers (no If-None-Match), so a hand-rolled 304
// answers a question the caller never asked: its bodiless answer decodes
// to `undefined` and consumer state clears, reading as data loss. The
// conditional exchange belongs to the BROWSER on a GET-declared function
// with ETag/Cache-Control, where a 304 revalidates the HTTP cache and the
// caller replays the cached 200 without ever seeing the 304.
function warnScripted304(functionId) {
  if (DEV) {
    console.warn(
      `Server function "${functionId}" answered a scripted call with 304 Not Modified. ` +
        `The client transport sends no conditional headers, so nothing was asked to be ` +
        `revalidated: the call resolves to undefined, not "unchanged". For conditional ` +
        `reads, declare the function GET and set ETag/Cache-Control response headers - ` +
        `the browser owns that exchange and replays its cached answer on a 304.`
    );
  }
} /**
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
 * Whether a request is form-SHAPED: a POST with a form content type and no
 * `BODY_FORMAT_HEADER` (which only the client runtime sends). Shape alone
 * is not the convention's gate — a page script's fetch can be form-shaped
 * too — so dispatch additionally reads `Sec-Fetch-Mode` to keep the
 * redirect convention on actual form navigations (#3139). Tagged direct
 * HTTP callers fall outside the shape test entirely and keep the plain
 * response.
 */
function isFormPost(request) {
  if (request.method !== "POST" || request.headers.has(BODY_FORMAT_HEADER)) return false;
  const type = request.headers.get("content-type") || "";
  return (
    type.startsWith("application/x-www-form-urlencoded") || type.startsWith("multipart/form-data")
  );
}

// `sanitizeServerError` guards the one road a thrown error takes out of
// dispatch. A failure can also escape through the RESULT GRAPH — a rejected
// promise, an async iterable that throws, a stream that errors — where it
// reaches the codec as a value to encode rather than as a throw, and never
// meets the sanitizer. The leak is the one the sanitizer exists to stop: a
// driver error's message and own-properties (failing query, connection
// string, bound params) riding the wire verbatim. Worse than the thrown
// case, because the head is already committed — the answer is a 200
// carrying no error tag.
//
// So the CHANNELS are wrapped before the codec sees them. Not the rejection
// (it has not happened yet), and not the Errors already in the graph: an
// Error reached as a value was never thrown, so it is data and the author's.
//
// Each container is recorded BEFORE its children are walked, so a cycle —
// which seroval encodes natively as a back-reference — resolves to the
// container being built instead of recursing forever. A cycle also forces
// the rebuild to stand, since a descendant already holds it. Containers
// that changed nothing are passed through by reference so identity survives
// for the codec, though the rebuilt shell is allocated either way: it has to
// exist before the walk that decides whether it was needed.
//
// Left alone deliberately, so a channel behind one is unguarded: class
// instances, whose own properties are not ours to rebuild (private fields,
// getters, invariants). Plain-object accessors and Map keys used to sit in
// that list too — but the codec pumps both, so "not ours to invoke" was not
// protection, it was a bypass: a rejecting promise behind a getter or used
// as a Map key rode the wire unsanitized, was never torn down, and on the
// promise path took the process down with an unhandled rejection (#3176).
// Enumerable getters are now invoked once and materialized as data
// properties; Map keys are walked like values.
//
// `state.gate` (optional — serializeResponseStream threads it, #3125) hooks
// the two STREAMING channels into the response lifetime as they are walked:
// wantsMore/awaitDemand park a source's pulls behind the response queue's
// demand, and onOpen registers an idempotent closer with the response
// teardown. Without it (frame-sink, tests) the channels are sanitize-only,
// as before.
//
// `state.scope` binds authored deferred operations — iterator steps, stream
// reads, and re-entrant walks of yielded/resolved values — to the dispatch
// event (#3222). It is explicit at each operation because merely creating an
// iterator or stream inside provideEvent does not scope the body a later
// consumer drives.
//
// The container descent is ITERATIVE (#3160): the recursive walk overflowed
// on a deep-but-legal result (~10k+ nesting) and the RangeError escaped into
// dispatch's catch as a phantom function error — the exact hazard this
// function's getter policy names and avoids, reopened by its own recursion
// (isJSONSafe was rewritten the same way for the same reason). enterGuard
// resolves leaves and channel wrappers immediately and answers containers
// with a Frame; guardFailures drives the frames on an explicit stack.
// Channel callbacks re-enter guardFailures from their own async contexts,
// which start fresh call stacks, so only the synchronous descent carries one.
/** @internal */
export function guardFailures(value, state) {
  if (!state) state = { seen: new WeakMap(), cyclic: new WeakSet() };
  const entered = enterGuard(value, state);
  if (!(entered instanceof Frame)) return entered;
  const stack = [entered];
  // A finished child's result, parked for the parent frame to record into
  // the slot it descended from. The sentinel is unforgeable, so it can
  // never collide with a real guarded value.
  let delivered = NOTHING;
  for (;;) {
    const top = stack[stack.length - 1];
    const items = top.items;
    let pushed = null;
    while (top.i < items.length) {
      const i = top.i;
      let original;
      if (top.kind === OBJECT) {
        const descriptor = top.descriptors[items[i]];
        if ("value" in descriptor) {
          original = descriptor.value;
        } else if (typeof descriptor.get === "function") {
          // Getter-backed accessor: the codec invokes it anyway, so refusing
          // to was never protection — it let a channel behind a getter ride
          // the wire unsanitized and untorn (#3176). Invoke ONCE (cached
          // across a frame suspension — the loop re-enters this slot after a
          // child container resolves) and materialize the result as a data
          // property below, so the codec reads the guarded value instead of
          // re-invoking. A throwing getter propagates to dispatch's catch —
          // the codec's own read would have failed the call anyway, and this
          // way it fails with a status instead of mid-stream.
          if (top.accessorRead !== i) {
            try {
              top.accessorValue = descriptor.get.call(top.value);
            } catch (error) {
              // Sanitized AT the throw: on the synchronous walk dispatch's
              // catch would sanitize anyway, but a re-entrant walk (inside a
              // wrapped promise's continuation) turns this throw into that
              // channel's rejection, which rides the wire as-is.
              throw sanitizeServerError(error);
            }
            top.accessorRead = i;
          }
          original = top.accessorValue;
        } else {
          // setter-only: reads as undefined for us and for the codec alike
          top.i++;
          continue;
        }
      } else {
        // MAP items are flattened [k0, v0, k1, v1, …] — keys are guarded
        // like any other slot (#3176: a promise AS a Map key is pumped by
        // the codec too; wrapping changes key identity exactly the way it
        // changes any wrapped value's).
        original = items[i];
      }
      let guarded;
      if (delivered !== NOTHING) {
        guarded = delivered;
        delivered = NOTHING;
      } else {
        guarded = enterGuard(original, state);
        if (guarded instanceof Frame) {
          pushed = guarded;
          break;
        }
      }
      if (top.kind === ARRAY) {
        if (guarded !== original) {
          top.next[i] = guarded;
          top.changed = true;
        }
      } else if (top.kind === MAP) {
        if ((i & 1) === 0) top.pendingKey = guarded;
        else top.next.set(top.pendingKey, guarded);
        if (guarded !== original) top.changed = true;
      } else if (top.kind === SET) {
        top.next.add(guarded);
        if (guarded !== original) top.changed = true;
      } else if (guarded !== original || top.accessorRead === i) {
        // A materialized accessor always rewrites its slot (even when the
        // value needed no wrapping): only the rebuilt shell carries the
        // data property — pass the original through and the codec would
        // invoke the getter afresh, minting a new unguarded channel.
        Object.defineProperty(top.next, items[i], {
          value: guarded,
          writable: true,
          configurable: true,
          enumerable: top.descriptors[items[i]].enumerable
        });
        top.changed = true;
      }
      top.i++;
    }
    if (pushed !== null) {
      stack.push(pushed);
      continue;
    }
    stack.pop();
    const out = keepGuarded(top.value, top.next, top.changed, state);
    if (stack.length === 0) return out;
    delivered = out;
  }
}

const NOTHING = Symbol();
const ARRAY = 0;
const MAP = 1;
const SET = 2;
const OBJECT = 3;

/** One synchronous container mid-walk. Module-private, so a user value can
 * never satisfy the driver's `instanceof Frame` dispatch. */
class Frame {
  constructor(kind, value, next, items, descriptors) {
    this.kind = kind;
    this.value = value;
    this.next = next;
    this.items = items;
    this.descriptors = descriptors;
    this.i = 0;
    this.changed = false;
    // Materialized-accessor slot cache: which slot index was read through
    // its getter (so a frame suspension never re-invokes it) and the value
    // that read produced (#3176).
    this.accessorRead = -1;
    this.accessorValue = undefined;
    // MAP frames: the guarded key parked while its value's slot resolves.
    this.pendingKey = undefined;
  }
}

/** Resolve one value: leaves, seen entries, and channel wrappers answer
 * immediately; synchronous containers register their shell in `state.seen`
 * (children — cycles included — must resolve to the shell being built) and
 * answer a Frame for the driver. */
function guardOperation(state, run) {
  return state.scope ? state.scope(run) : run();
}

function enterGuard(value, state) {
  if (value === null || typeof value !== "object") return value;
  if (state.seen.has(value)) {
    state.cyclic.add(value);
    return state.seen.get(value);
  }

  // Ahead of the async-iterable branch: a ReadableStream is async-iterable
  // on every server runtime, so that branch would claim it and this one
  // would never run.
  if (typeof ReadableStream !== "undefined" && value instanceof ReadableStream) {
    let reader;
    const gate = state.gate;
    let finished = false;
    const close = () => {
      if (finished) return;
      finished = true;
      try {
        const cancelled = guardOperation(state, () => (reader ? reader.cancel() : value.cancel()));
        if (cancelled && typeof cancelled.then === "function") cancelled.then(undefined, () => {});
      } catch {}
    };
    const guardedStream = new ReadableStream({
      async pull(controller) {
        try {
          // Demand gate + teardown (#3125): same contract as the iterable
          // branch below — park ahead of the source read, re-check finished
          // after the wait (teardown can land while parked).
          if (gate && !finished && !gate.wantsMore()) await gate.awaitDemand();
          if (finished) {
            controller.close();
            return;
          }
          if (!reader) reader = guardOperation(state, () => value.getReader());
          const { done, value: chunk } = await guardOperation(state, () => reader.read());
          // the chunk is walked like a step value: a channel nested in one
          // would otherwise reach the codec unguarded
          done
            ? controller.close()
            : controller.enqueue(guardOperation(state, () => guardFailures(chunk, state)));
        } catch (error) {
          controller.error(guardOperation(state, () => sanitizeServerError(error)));
        }
      },
      cancel(reason) {
        finished = true;
        return guardOperation(state, () => (reader ? reader.cancel(reason) : value.cancel(reason)));
      }
    });
    if (gate) gate.onOpen(close);
    state.seen.set(value, guardedStream);
    return guardedStream;
  }

  if (typeof value.then === "function") {
    const guardedPromise = Promise.resolve(value).then(
      resolved => guardOperation(state, () => guardFailures(resolved, state)),
      error => {
        throw guardOperation(state, () => sanitizeServerError(error));
      }
    );
    // The guard consumes the source rejection and moves its sanitized form
    // onto this derived promise. Usually the codec owns that promise, but an
    // unrelated encode failure can abandon it before the codec attaches its
    // handlers (#3216). Keep a fallback owner on the promise WE minted: this
    // does not change its rejection for codec consumers, and it deliberately
    // does not claim promises the walk cannot reach (for example, one hidden
    // behind a class instance).
    guardedPromise.catch(() => {});
    state.seen.set(value, guardedPromise);
    return guardedPromise;
  }

  if (typeof value[Symbol.asyncIterator] === "function") {
    const source = value;
    const gate = state.gate;
    const guardedIterable = {
      [Symbol.asyncIterator]() {
        const iterator = guardOperation(state, () => source[Symbol.asyncIterator]());
        let finished = false;
        const close = () => {
          if (finished) return;
          finished = true;
          try {
            const returned = iterator.return && guardOperation(state, () => iterator.return());
            if (returned && typeof returned.then === "function") returned.then(undefined, () => {});
          } catch {}
        };
        // Registers with the response teardown (#3125): the codec pumps
        // EVERY iterable in the graph — nested ones included — so each open
        // must be closable when the consumer leaves, or an abandoned request
        // leaks the producer (a DB cursor's finally that never runs).
        if (gate) gate.onOpen(close);
        const step = () =>
          finished
            ? Promise.resolve({ done: true, value: undefined })
            : guardOperation(state, () => iterator.next()).then(
                step => {
                  if (step.done) {
                    finished = true;
                    return step;
                  }
                  return {
                    done: false,
                    value: guardOperation(state, () => guardFailures(step.value, state))
                  };
                },
                error => {
                  throw guardOperation(state, () => sanitizeServerError(error));
                }
              );
        return {
          // Pulls straight through while the response queue has room, and
          // parks until a read makes room when it does not. `finished` is
          // checked FIRST: teardown can land while a pull is in flight, and
          // the release it fires then finds nothing parked — so a gate
          // checked first would park the next pull on a resolver nobody
          // will ever call, stranding the codec's pump. `finished` is
          // re-read inside step() for the same reason from the other
          // direction.
          next: () =>
            finished || !gate || gate.wantsMore() ? step() : gate.awaitDemand().then(step),
          return: () => {
            close();
            return Promise.resolve({ done: true, value: undefined });
          }
        };
      }
    };
    state.seen.set(value, guardedIterable);
    return guardedIterable;
  }

  // Seroval can also defer authored work through a synchronous generator.
  // It is not a failure channel, so it needs no sanitizer wrapper, but its
  // iterator methods need the same explicit request scope (#3222).
  if (
    state.scope &&
    typeof value[Symbol.iterator] === "function" &&
    !Array.isArray(value) &&
    !(value instanceof Map) &&
    !(value instanceof Set) &&
    !ArrayBuffer.isView(value)
  ) {
    const scopedIterable = scopeDeferredResult(value, state.scope);
    state.seen.set(value, scopedIterable);
    return scopedIterable;
  }

  if (Array.isArray(value)) {
    const next = value.slice();
    state.seen.set(value, next);
    return new Frame(ARRAY, value, next, value, null);
  }

  if (value instanceof Map) {
    const next = new Map();
    state.seen.set(value, next);
    // Keys are guarded too (#3176): the codec pumps a promise-as-key the
    // same as any value, so an unguarded key was an unsanitized, untorn
    // channel. Entries flatten to [k0, v0, k1, v1, …] so the driver walks
    // keys and values with one cursor; the frame recorder pairs them back.
    const items = [];
    for (const entry of value) items.push(entry[0], entry[1]);
    return new Frame(MAP, value, next, items, null);
  }

  if (value instanceof Set) {
    const next = new Set();
    state.seen.set(value, next);
    return new Frame(SET, value, next, [...value], null);
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    state.seen.set(value, value);
    return value;
  }

  // Descriptors carry across so a frozen or non-writable shape survives the
  // rebuild. Getter-backed accessors are materialized by the driver (#3176):
  // invoked once there, rewritten as data properties on this shell.
  const descriptors = Object.getOwnPropertyDescriptors(value);
  // The shell is scratch the codec reads once and the author never holds, so
  // make its fresh descriptors rewritable in place. This preserves the one
  // serialization flag (`enumerable`) while frozen slots can be replaced
  // (#3196, #3198), and keeps an authored own `__proto__` descriptor as data
  // instead of interpreting its name while copying through an ordinary object.
  for (const key of Object.keys(descriptors)) {
    descriptors[key].configurable = true;
    if ("value" in descriptors[key]) descriptors[key].writable = true;
  }
  const next = Object.create(prototype, descriptors);
  state.seen.set(value, next);
  // The codec reads enumerable string properties; hidden accessors must stay
  // hidden without being invoked merely because another slot needs guarding.
  return new Frame(OBJECT, value, next, Object.keys(value), descriptors);
}

/** A rebuild stands if anything below changed, or if a cycle already took it. */
function keepGuarded(value, next, changed, state) {
  if (changed || state.cyclic.has(value)) return next;
  state.seen.set(value, value);
  return value;
}

/**
 * The response-side codec stream: `serializeStream` (shared.js) hardened
 * with request-lifetime teardown. Server-only on purpose — the shared half
 * is re-exported into client bundles, where this plumbing is dead weight.
 *
 * An abort of `signal` (the platform fires request.signal when the caller's
 * fetch aborts or the tab goes away) or the consumer cancelling the
 * ReadableStream (how platforms surface a dropped connection to the body)
 * stops pending serialization and tears down EVERY async-iterable or
 * ReadableStream source in the result graph, nested ones included (#3125) —
 * each producer's `iterator.return()` / `reader.cancel()` runs, so
 * generator `finally` blocks execute instead of the server pumping streams
 * nobody is reading. The wiring rides guardFailures' walk: it already wraps
 * every channel before the codec sees the value, so the demand gate and the
 * teardown registry are threaded through its state (`{ items: rows() }` —
 * a cursor beside a total — gets the same two guarantees as `return rows()`).
 */
export function serializeResponseStream(value, codecOptions, signal, scope) {
  let closed = false;
  // Demand gate. seroval's pump pulls each source as fast as it resolves and
  // enqueues every node the moment it is parsed, so without this a slow
  // consumer never slows the producer: the whole result accumulates in the
  // stream's queue, in server memory, unbounded. The consumer's reads drive
  // `pull`, which releases parked source pulls.
  //
  // `desiredSize > 0` means "fewer than one chunk queued": the stream takes
  // no queuing strategy, so it runs on the default high-water mark of 1.
  // That default is what sets the depth, and raising it is how you would
  // trade memory for fewer round trips.
  //
  // The waiters are a LIST because the codec pumps every source in the
  // graph concurrently (#3125), and a pull must wake ALL of them: waking
  // one would strand the rest when the woken source finishes without
  // enqueuing (a done step produces no chunk, so no further pull ever
  // fires). Wake-all keeps per-pull production bounded by the live source
  // count — each woken source steps once and re-parks on its next pull.
  let streamController = null;
  let demandWaiters = null;
  const wantsMore = () => streamController !== null && streamController.desiredSize > 0;
  const awaitDemand = () => new Promise(resolve => (demandWaiters ??= []).push(resolve));
  const supplyDemand = () => {
    const resolvers = demandWaiters;
    demandWaiters = null;
    if (resolvers) for (const resolve of resolvers) resolve();
  };
  // Every source the codec has opened, top-level and nested alike —
  // guardFailures registers each through gate.onOpen as the codec reaches
  // it. Closers are idempotent.
  const sourceClosers = new Set();
  const gate = {
    wantsMore,
    awaitDemand,
    onOpen(close) {
      // torn down before the codec opened this source (abort raced the
      // codec load, or a nested open raced teardown): close it immediately,
      // never pull
      if (closed) close();
      else sourceClosers.add(close);
    }
  };
  const guardState = { seen: new WeakMap(), cyclic: new WeakSet(), gate, scope };
  value = guardOperation(guardState, () => guardFailures(value, guardState));
  let cancelSerialize = null;
  let onAbort = null;
  // Ends the sources and releases pulls parked on the demand gate. Every
  // path that stops the stream has to run this: a parked pull holds its
  // source open and nothing else will resolve it — `desiredSize` is 0 after
  // close and null after error, so the gate never reopens on its own.
  const finishSource = () => {
    for (const close of sourceClosers) close();
    sourceClosers.clear();
    supplyDemand();
  };
  const teardown = () => {
    if (closed) return;
    closed = true;
    if (onAbort) signal.removeEventListener("abort", onAbort);
    if (cancelSerialize) cancelSerialize();
    finishSource();
  };
  return new ReadableStream({
    // async on purpose: the codec is late-loaded (see the loading notes at
    // the top of shared.js), and a ReadableStream start may return a
    // promise — reads wait for it, so the stream's contract is unchanged
    async start(controller) {
      streamController = controller;
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
          finishSource();
          controller.close();
        },
        onError(error) {
          if (closed) return;
          closed = true;
          if (onAbort) signal.removeEventListener("abort", onAbort);
          finishSource();
          // The head is committed by the time an encode failure arrives, so
          // the status is spent and no error tag can be added — and merely
          // erroring the stream truncates the body over a socket, which the
          // peer decodes as `undefined`: a write that succeeded becomes
          // indistinguishable from one that returned nothing, the worst
          // available reading for a non-idempotent mutation (#3117). So the
          // failure travels IN BAND: a terminal error frame the decoder
          // recognizes and throws. Sanitized like any other failure — an
          // encode error's message can carry the value that refused to
          // encode; the dev build keeps the cause for DX.
          try {
            const delivered = sanitizeServerError(
              DEV && error instanceof Error
                ? new Error(`Server function result could not be encoded: ${error.message}`)
                : error
            );
            controller.enqueue(createChunk(encodeErrorTrailer(delivered)));
            controller.close();
          } catch {
            try {
              controller.error(error);
            } catch {}
          }
        }
      });
    },
    pull() {
      supplyDemand();
    },
    cancel() {
      teardown();
    }
  });
}

function serializedResponse(value, headers, codec, signal, scope) {
  headers.set(BODY_FORMAT_HEADER, BodyFormat.Serialized);
  headers.set("Content-Type", "text/plain");
  return new Response(serializeResponseStream(value, codec, signal, scope), { headers });
}

function encodeResult(value, headers, status, codec, signal, scope) {
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
    return encodeResult(error, headers, 500, codec, signal, scope);
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
    const jsonSafe = scope ? scope(() => isJSONSafe(value)) : isJSONSafe(value);
    if (jsonSafe) {
      headers.set(BODY_FORMAT_HEADER, BodyFormat.Json);
      headers.set("Content-Type", "application/json");
      const body = scope ? scope(() => JSON.stringify(value)) : JSON.stringify(value);
      return new Response(body, { status, headers });
    }
  } catch {
    // fall through — serializedResponse overwrites the format headers the
    // JSON attempt may have set before stringify threw
  }
  try {
    const response = serializedResponse(value, headers, codec, signal, scope);
    return status === 200 ? response : new Response(response.body, { status, headers });
  } catch (error) {
    // The synchronous half of the codec road threw — guardFailures' walk (a
    // user-hostile custom iterator, an engine limit on an extreme shape) or
    // Response construction — AFTER the function ran and succeeded. Rename
    // before rethrowing so the failure is attributed as an ENCODE error
    // (mirroring serializeResponseStream's onError trailer policy: dev keeps
    // the cause for DX, production sanitizes downstream), never reported as
    // the function itself throwing — the phantom error over a call that
    // succeeded (#3160).
    throw DEV && error instanceof Error
      ? new Error(`Server function result could not be encoded: ${error.message}`)
      : error;
  }
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
// ambient node environment. The general serialization entry has no build
// variants and keeps its NODE_ENV-based stack default; the server-function
// boundary below supplies this compiled flag when its codec option leaves
// `serializeErrorStacks` unspecified (#3221).
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
  // Strict `=== true`: this is a security gate, so anything else fails
  // CLOSED. A truthy non-boolean (`"no"`, a verdict object) is the shape a
  // matcher that explains its decision most naturally returns — coercion
  // read those as "allow" (#3169).
  if (typeof matcher === "function") return (await matcher(origin, request)) === true;
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
}

function nativePromise(value) {
  if (value instanceof Promise) return value;
  try {
    // `instanceof` is realm-local. The intrinsic brand check accepts a
    // genuine Promise from another realm without adopting arbitrary thenables.
    if (Object.prototype.toString.call(value) === "[object Promise]")
      return Promise.prototype.then.call(value, value => value);
  } catch {}
}

/**
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
 * - `codec`: overrides the configured codec options for this handler. When
 *   `serializeErrorStacks` is omitted, it defaults from this module's
 *   compiled development variant.
 */
export async function handleServerFunctionRequest(request, options = {}) {
  const codec = {
    ...(options.codec !== undefined ? options.codec : getServerFunctionsCodec())
  };
  // This is the server-function boundary's policy, not the standalone
  // serialization package's: the selected server.dev/server artifact owns
  // the default. Copy before filling it so per-handler and configured codec
  // objects remain exactly as their callers supplied them.
  codec.serializeErrorStacks ??= DEV;
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
  // The skip is `GET()`'s safety contract at work (see its notes and
  // #3114); `protectDeclaredReads` is the opt-in for deployments that
  // would rather gate reads than share their cache entries.
  const protectsRequest =
    csrf !== false &&
    (!declaredRead || (typeof csrf === "object" && csrf.protectDeclaredReads === true));
  // Labelled (#3110): the address is well-formed but its id is not part of
  // this deployment — the wire shape of version skew (a tab holding the
  // previous build's ids) or a genuinely removed function. Without the
  // label this 404 is indistinguishable from a CDN's or a proxy's, and the
  // one recovery that works — reload onto the current build — cannot be
  // targeted.
  //
  // Answered BEFORE the origin gate, deliberately (#3136). A removed id is
  // not in METHODS, so it can no longer be recognised as a declared read
  // and the gate fired on it — hiding the label behind a 403 from exactly
  // the callers that carry no fetch metadata (a CDN revalidating a
  // declared read, a monitor, a server-to-server client; Node's fetch
  // sends none of the three headers the gate reads). Nothing is registered
  // at an unknown id, so the gate has nothing there to protect, and the
  // ids themselves are public by construction: the compiler emits them
  // into the shipped client bundle. The lookup is a side-effect-free Map
  // read, so nothing user-authored runs earlier than it did. The
  // meaningless-path 404 below stays bare and stays gated: a mistyped
  // route is not skew.
  let serverFunction;
  if (functionId) {
    try {
      serverFunction = getServerFunction(functionId);
    } catch {
      // no Vary: the answer does not depend on origin proof, so it must
      // not fragment shared-cache entries on it
      return finalizeTransportResponse(
        new Response(DEV ? `Unknown server function: ${functionId}` : null, {
          status: 404,
          headers: { [UNKNOWN_HEADER]: "true" }
        }),
        method
      );
    }
  }
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
  // caller kind's cached answer can be replayed to the other (#3094). The
  // instance header does not shape the answer; it still identifies the
  // call (invocation context, no-JS gating).
  const scripted = address.data;

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

  // The argument payload is buffered and decoded before dispatch, so its
  // cost is paid before application code can decline it — bound it before
  // paying (#3115). A CONFORMING declared Content-Length is trusted (the
  // HTTP server's framing enforces it); a body without one — or with a
  // declaration that isn't a plain digit string (#3153) — is buffered under
  // the cap. The `?args=` encoding is the same payload on a different road,
  // so it gets the same ceiling.
  const bodySizeLimit =
    options.bodySizeLimit !== undefined ? options.bodySizeLimit : config.bodySizeLimit;
  const argsEncoding = url.searchParams.get("args");
  if (argsEncoding !== null && argsEncoding.length > bodySizeLimit) {
    const response = new Response(
      DEV ? "Server function arguments exceed the configured bodySizeLimit" : null,
      { status: 413 }
    );
    return finalizeTransportResponse(protectsRequest ? withCSRFVary(response) : response, method);
  }
  if (method === "POST" && request.body !== null && bodySizeLimit !== Infinity) {
    // Trust only a CONFORMING declaration — digits, per RFC 9110 §8.6. The
    // bare Number() parse lost that information: Number("-1") is -1, which
    // is neither `> limit` nor falsy, so a negative declaration satisfied
    // NEITHER guard and the body streamed into the decoder uncapped
    // (#3153). A stock node:http parser refuses it first, but an adapter
    // that builds the Request itself, or a rewriting proxy, delivers it
    // here — anything non-conforming now routes through the bounded buffer
    // alongside the undeclared bodies.
    const raw = request.headers.get("content-length");
    const declared = raw !== null && /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (declared > bodySizeLimit) {
      const response = new Response(
        DEV ? "Server function request body exceeds the configured bodySizeLimit" : null,
        { status: 413 }
      );
      return finalizeTransportResponse(protectsRequest ? withCSRFVary(response) : response, method);
    }
    if (!(declared > 0)) {
      let bounded;
      try {
        bounded = await bufferBodyWithin(request, bodySizeLimit);
      } catch {
        // A failed or aborted upload is an incomplete argument encoding,
        // not a handler failure. Match the decoder's malformed-body answer
        // instead of rejecting out of dispatch (#3217).
        const response = new Response(DEV ? "Malformed server function arguments" : null, {
          status: 400
        });
        return finalizeTransportResponse(
          protectsRequest ? withCSRFVary(response) : response,
          method
        );
      }
      if (bounded === null) {
        const response = new Response(
          DEV ? "Server function request body exceeds the configured bodySizeLimit" : null,
          { status: 413 }
        );
        return finalizeTransportResponse(
          protectsRequest ? withCSRFVary(response) : response,
          method
        );
      }
      request = bounded;
    }
  }

  // An async createEvent is out of contract (the type is synchronous), but
  // handing a pending Promise downstream is the worst failure available: the
  // function runs, the caller sees 200, and every header the integration
  // wrote on the stub vanishes (#3170). So it is awaited — but only when it
  // is genuinely a Promise. The event is a datum an integration handed back,
  // not something the runtime asked to be async, and awaiting anything
  // wearing a `then` parked the request forever on a lazy-locals proxy and
  // starved the event loop on a self-resolving one (#3199). A failure here
  // is answered rather than thrown: no event exists yet, so there is no stub
  // to fold and nothing downstream can report it.
  let event;
  try {
    event = options.createEvent ? options.createEvent(request) : { request, locals: {} };
    const promised = nativePromise(event);
    if (promised) event = await promised;
  } catch (error) {
    const safe = sanitizeServerError(error);
    const message = safe instanceof Error ? safe.message : String(safe);
    const headers = new Headers();
    headers.set(ERROR_HEADER, boundedErrorHeaderValue(message));
    // A scripted failure is still runtime protocol, so encode it like a
    // function throw rather than making the client misclassify it as an
    // untagged peer 500. Plain HTTP keeps the ordinary bodiless production
    // response.
    const response = scripted
      ? encodeResult(safe, headers, 500, codec, request.signal)
      : new Response(DEV ? message : null, { status: 500 });
    return finalizeTransportResponse(protectsRequest ? withCSRFVary(response) : response, method);
  }
  // Once an event exists, its response stub folds onto EVERY exit — the
  // refusals below included (#3159). A refusal that returned directly
  // dropped the stub silently: an integration's Set-Cookie written in
  // createEvent (a rotated session, a fresh CSRF token) never reached the
  // browser on exactly the requests where something already went wrong, and
  // the next request carried stale credentials with the failure pointing at
  // the wrong place. Committing here also arms the stub's late-write
  // instrumentation, same as the dispatch tail.
  const refuseCommitted = raw => {
    const response = commitEventResponse(raw, event);
    return finalizeTransportResponse(protectsRequest ? withCSRFVary(response) : response, method);
  };
  const provide = options.provideEvent || provideEvent;
  const scope = run => provide(event, run);
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
  //
  // The convention is for form NAVIGATIONS — the browser follows the 303
  // and the flash cookie carries the outcome to the next render. Which
  // caller kind this is was decided by the ABSENCE of a header (#3139,
  // the shape-on-the-url doctrine's one leftover): a same-origin page
  // script posting a form-encoded body — fetch(url, { body: new
  // URLSearchParams(...) }) — is form-shaped too, and routing IT into the
  // convention lands it on the referrer's HTML with `response.ok === true`
  // while its answer disappears into its own cookie jar. The browser's own
  // word tells the two apart: a real form navigation sends `Sec-Fetch-Mode:
  // navigate` (or nothing, on older browsers), a script's fetch never does.
  // The script's call is refused as malformed — BEFORE dispatch, because
  // the old behavior's real harm was running the mutation and then hiding
  // the outcome — pointing at the two spellings that work. Answering it
  // plain instead would put a second, header-decided shape on the bare
  // address, which is the exact thing #3094 moved onto the url.
  let handleNoJS = options.handleNoJS !== undefined ? options.handleNoJS : config.handleNoJS;
  if (handleNoJS === undefined && !scripted && isFormPost(request)) {
    const fetchMode = request.headers.get("Sec-Fetch-Mode");
    if (fetchMode === null || fetchMode === "navigate") {
      handleNoJS = defaultNoJSHandler || (defaultNoJSHandler = createNoJSHandler());
    } else {
      const response = new Response(
        DEV
          ? "The bare server-function address answers form navigations with the " +
              "no-JS redirect convention. Scripted callers use the data address " +
              `(…/data/${functionId}) or send the ${BODY_FORMAT_HEADER} tag.`
          : null,
        { status: 400 }
      );
      return refuseCommitted(response);
    }
  }
  // single-flight is scripted-client opt-in: the caller sends the request
  // header naming the sources it can consume ("true" is the unnamed hook's
  // reserved id), the server must have hooks to produce the data. Only
  // advertised sources run: a client that never subscribed a source's
  // consumer never pays for its collection, and an id naming no registered
  // hook simply does not fold.
  //
  // POST only — the server half of the client's own rule (client.ts: reads
  // "stay plain — folding per-request flight data into them would defeat
  // caching"). A GET is a cacheable URL, and folding on it would put two
  // bodies at one cache key — the plain value and an envelope carrying
  // data the hook computed from THAT caller's request — with nothing
  // naming the variance, under whatever public Cache-Control the author
  // wrote (#3128). The shipped client never sends the header on a read;
  // honoring it from anyone else hands a curl one shared-cache poisoning.
  const flightHeader =
    scripted && method === "POST" ? request.headers.get(SINGLE_FLIGHT_HEADER) : null;
  const flightHooks = flightHeader
    ? flightHeader.split(",").flatMap(source => {
        const hook = source === "true" ? flightHook : flightSources.get(source);
        return hook ? [[source, hook]] : [];
      })
    : [];
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
    return refuseCommitted(response);
  }

  // The decoded array is spread into the call, so an unbounded argument
  // list forces a range error out of ANY function regardless of what it
  // does (#3115). Refused as the malformed request it is.
  const maxArguments =
    options.maxArguments !== undefined ? options.maxArguments : config.maxArguments;
  if (parsed.length > maxArguments) {
    const response = new Response(
      DEV ? "Server function call exceeds the configured maxArguments" : null,
      { status: 400 }
    );
    return refuseCommitted(response);
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
      // provideEvent's contract — run the callback, once, with `event`
      // visible to getRequestEvent() — is enforced rather than assumed
      // (#3172): every way a hand-written hook gets it wrong used to answer
      // a successful-looking 200. The two data-integrity violations are
      // counted here at the seam: a second invocation is refused BEFORE the
      // function body runs again (a retry wrapper or a misplaced await
      // double-committed a mutation under a 200, silently), and a hook that
      // never invoked the callback must not resolve as a void success a
      // caller cannot distinguish from a function that returned nothing.
      // Both land on dispatch's catch — a sanitized 500 in production, the
      // hook named in development — and the count is re-checked after the
      // hook returns, so swallowing the in-flight refusal does not turn it
      // back into a 200.
      let invocations = 0;
      const invokeOnce = async () => {
        // Identity is established BEFORE the wrapper runs, so
        // getServerFunctionInvocation() answers throughout the wrap — code
        // ahead of run() (auth, logging) included.
        INVOCATIONS.set(event, { id: functionId });
        const run = () => serverFunction(...parsed);
        return wrapInvocation
          ? wrapInvocation(run, { id: functionId, args: parsed, event, request, direct: false })
          : run();
      };
      let result = await provide(event, () => {
        if (++invocations > 1) {
          // thrown synchronously, never as a rejected promise: the second
          // execution must not START, and a hook that ignores the return
          // must not mint an unobserved rejection
          throw new Error(
            "provideEvent invoked the server function callback more than once: a second " +
              "invocation would commit the call's side effects twice. The hook must call " +
              "fn exactly once and return its result."
          );
        }
        return invokeOnce();
      });
      if (invocations !== 1) {
        throw new Error(
          invocations === 0
            ? "provideEvent returned without invoking the server function callback: the call " +
                "would have answered as a void success without running the function. The hook " +
                "must call fn exactly once and return its result."
            : "provideEvent invoked the server function callback more than once: a second " +
                "invocation would commit the call's side effects twice. The hook must call " +
                "fn exactly once and return its result."
        );
      }

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
        // scripted callers: redirect intent travels masked, as 200 +
        // REDIRECT_HEADER for the client integration to act on (see
        // maskRedirect). Only the followable set masks (see
        // validRedirectStatuses) — a 304 is not a redirect and is the
        // natural answer for a conditional read (#3096) — and unscripted
        // callers always get real HTTP.
        if (
          response &&
          response.status &&
          (!scripted || !validRedirectStatuses.has(response.status))
        ) {
          status = response.status;
        } else if (response && response.status) {
          maskRedirect(headers, response, request.url);
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
          // it); non-redirect 3xx like 304 pass through (#3096), redirects
          // ride REDIRECT_HEADER (see maskRedirect)
          if (result.status && !validRedirectStatuses.has(result.status)) {
            status = result.status;
          } else if (result.status) {
            maskRedirect(headers, result, request.url);
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
        return encodeResult(result, headers, status, codec, request.signal, scope);
      }

      if (status === 304) warnScripted304(functionId);
      return encodeResult(result, headers, status, codec, request.signal, scope);
    } catch (x) {
      // Plain-thrown tail, hoisted so the thrown-path transformResult can
      // divert to it: the security-sensitive path. Sanitized to a generic
      // Error outside development unless branded safe, so a driver/ORM
      // error's message and own-properties never reach the client (see
      // sanitizeServerError). Both the wire body and the ERROR_HEADER
      // message derive from the sanitized value.
      const respondThrown = value => {
        const safe = sanitizeServerError(value);
        if (!scripted) {
          if (handleNoJS) return handleNoJS(safe, request, parsed, true);
          const message = safe instanceof Error ? safe.message : String(safe);
          return new Response(DEV ? message : null, { status: 500 });
        }
        const error =
          safe instanceof Error ? safe.message : typeof safe === "string" ? safe : "true";
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
        return encodeResult(safe, headers, 500, codec, request.signal, scope);
      };
      if (x instanceof Response || isResponseEnvelope(x)) {
        if (transformResult) {
          try {
            x = await transformResult(event, x, { ...flightContext, thrown: true });
          } catch (hookError) {
            // Same hook, same failure, same containment as the return path
            // (#3171): there a throwing transformResult lands in this catch
            // as a plain error and answers a sanitized 500. Uncontained here,
            // it escaped the handler entirely — no status, no event stub,
            // the host adapter left to improvise.
            return respondThrown(hookError);
          }
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
          } else if (response && response.status) {
            maskRedirect(headers, response, request.url);
          }
          metadata = response;
          x = value;
        } else if (x instanceof Response) {
          if (x.headers) {
            mergeResponseHeaders(headers, x.headers);
          }
          if (x.status && (!scripted || !validRedirectStatuses.has(x.status))) {
            status = x.status;
          } else if (x.status) {
            maskRedirect(headers, x, request.url);
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
            // ownership before the write — the fold may hand back a Response
            // an integration hook caches (see ownResponse)
            x = ownResponse(x);
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
        if (scripted && status === 304) warnScripted304(functionId);
        return encodeResult(x, headers, status, codec, request.signal, scope);
      }

      // Plain thrown value (not a Response/envelope) — see respondThrown above.
      return respondThrown(x);
    }
  };
  // Ownership seam (#3155): the dispatched value may be a Response the
  // application still holds — a module-level redirect singleton, a memoized
  // per-tenant Response — and every stamp past this line (the stub fold's
  // cookies, `Vary`, `Cache-Control`) would otherwise land on that shared
  // object permanently: one caller's session cookie served to the next, with
  // no error anywhere. Copying once here lets the whole transport tail
  // mutate freely instead of auditing every write site, and covers every
  // foreign-response path at once (raw passthrough, unscripted returns and
  // throws, custom handleNoJS results, envelope-carried responses).
  const response = commitEventResponse(
    enforceComposedHeaderInvariants(ownResponse(await dispatch())),
    event
  );
  return finalizeTransportResponse(protectsRequest ? withCSRFVary(response) : response, method);
}

// A fresh Response around the same body: status, statusText and headers are
// copied (Response doubles as its own ResponseInit), so the copy's headers
// are mutable even when the source's were immutable (Response.redirect, a
// raw fetch() response). The body stream is shared, not duplicated — a
// body-carrying singleton still self-destructs on second use ("Body is
// unusable"), which is the loud failure that was always there. The catch
// covers shapes the constructor refuses (Response.error()'s status 0):
// those pass through as before.
function ownResponse(response) {
  try {
    return new Response(response.body, response);
  } catch {
    return response;
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
  // Never onto a 304: a 304 is not a stored response, it is an UPDATE to
  // one — RFC 9111 §4.3.4 has the cache freshen its stored entry with the
  // header fields the 304 carries. `no-store` here would not decline to
  // store this answer; it would instruct the cache to DROP the entry the
  // conditional request was sent to keep alive, leaving the read worse off
  // than uncached — a conditional round trip and then a full refetch,
  // every other read, forever (#3134). An author who echoes Cache-Control
  // on the 304 (RFC 9110 §15.4.5) was always untouched; this covers the
  // minimal correct 304 the dev warning's own advice leads to. 204/205 are
  // ordinary answers, not cache updates, and keep the default.
  const defaultsCache = !response.headers.has("Cache-Control") && response.status !== 304;
  if (stripBody || defaultsCache) {
    try {
      if (defaultsCache) {
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
      if (defaultsCache && !headers.has("Cache-Control")) headers.set("Cache-Control", "no-store");
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
