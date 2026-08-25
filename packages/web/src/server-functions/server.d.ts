import { ResponseEnvelope } from "../response.js";
import { JSONCodecOptions } from "../serializer-decode.js";
import { RequestEvent } from "../server.js";

export {
  ERROR_HEADER,
  FLASH_COOKIE,
  FUNCTION_HEADER,
  INSTANCE_HEADER,
  SINGLE_FLIGHT_HEADER,
  clearFlashCookie,
  decodeErrorHeaderValue,
  decodeResponse,
  decodeResponsePayload,
  encodeErrorHeaderValue,
  getServerFunctionMetadata,
  hasFlashCookie,
  isServerFunction,
  subscribeFlightData,
  withMeta
} from "./shared.js";
export type {
  FlightDataConsumer,
  FlightDataContext,
  ServerFunction,
  ServerFunctionMetadata,
  SingleFlightPayload
} from "./shared.js";
export { decodeFlashCookie, encodeFlashCookie } from "./flash.js";
export type { FlashSubmission } from "./flash.js";
import { ServerFunction, ServerFunctionMetadata } from "./shared.js";

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

/**
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

/** Options for `createNoJSHandler`. */
export interface NoJSHandlerOptions {
  /** The app's mount path, for resolving a relative redirect `Location`. */
  base?: string;
}

/**
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
   * The single-flight hook: produces the data payload folded into
   * responses of calls that opted in (see `CollectFlightDataHook`).
   * Registered once by the integration that owns data production (a
   * router); per-handler `collectFlightData` options override it.
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
   * Endpoint the HTTP handler is mounted on, used for the `url` of SSR'd
   * references (e.g. form actions) — must match the client configuration.
   * Prefix it when the app serves from a base path (e.g.
   * `` `${BASE_URL}_server` ``).
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
 * Configures the server runtime. Call once at server startup, before
 * handling requests. Only needed when deviating from the defaults (custom
 * endpoint, codec plugins, an explicit event provider, or a single-flight
 * hook).
 */
export function configureServerFunctionsServer(config?: ServerFunctionsServerConfig): void;

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

/**
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

/**
 * Looks up a registered server function by id; throws for unknown ids.
 * The HTTP handler uses this for dispatch — integrations building custom
 * dispatch (or introspection) can too.
 */
export function getServerFunction<T extends any[], R>(id: string): (...args: T) => R;

/**
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

/**
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

/** Identity of the currently executing server function call. */
export interface ServerFunctionInvocation {
  id: string;
}

/**
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

/**
 * Web-standard HTTP handler for server function calls: resolves the
 * function id from the request, gates GET dispatch on the declaration (405
 * for a GET request to a function that never declared `GET`; POST is always
 * accepted), decodes arguments, runs the function under a request-event scope,
 * and encodes the result (forwarding redirect/revalidation metadata
 * through headers). Mount it on the endpoint the client transport targets
 * (default `/_server`); platform adapters (h3, express, ...) convert their
 * request shape to a web `Request` around it.
 *
 * Requests are same-origin by default. The handler accepts browser requests
 * proven by `Sec-Fetch-Site`, `Origin`, or `Referer`, and rejects requests
 * without usable metadata unless explicitly configured otherwise.
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

/** Message a sanitized (production) server error carries on the wire. */
export const GENERIC_SERVER_ERROR_MESSAGE: string;

/**
 * The production error-sanitization policy `handleServerFunctionRequest`
 * applies to a plain thrown value before serialization. Returns `value`
 * unchanged in the dev build or when it is branded safe (`markSafeError`);
 * otherwise returns a generic `Error` carrying `GENERIC_SERVER_ERROR_MESSAGE`.
 * Exposed for frameworks composing their own dispatch around the same policy.
 */
export function sanitizeServerError(value: unknown): unknown;

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

/**
 * Client-only inspection seam. A no-op on this entry so isomorphic
 * `@solidjs/web/server-functions` imports resolve.
 */
export function observeServerFunctionCalls(
  observer: (call: ServerFunctionCall) => void
): () => void;

/**
 * Overrides the build-variant dev flag for this module instance — the seam
 * for test harnesses and hand-rolled bundles whose packaging cannot replace
 * `_DX_DEV_`. Applications never call this; select the dev build through
 * the `development` export condition instead.
 * @internal
 */
export function setServerFunctionsDev(dev: boolean): void;
