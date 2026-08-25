import { JSONCodecOptions } from "../serializer-decode.js";
import { ServerFunction, ServerFunctionMetadata } from "./shared.js";

export {
  ChunkReader,
  ERROR_HEADER,
  FLASH_COOKIE,
  FUNCTION_HEADER,
  INSTANCE_HEADER,
  SINGLE_FLIGHT_HEADER,
  clearFlashCookie,
  createChunk,
  decodeErrorHeaderValue,
  decodeResponse,
  decodeResponsePayload,
  deserializeStream,
  encodeErrorHeaderValue,
  frameAddress,
  getFlightDataConsumer,
  getServerFunctionMetadata,
  getServerFunctionsCodec,
  hasFlashCookie,
  isServerFunction,
  serializeString,
  subscribeFlightData,
  withMeta
} from "./shared.js";
export { REVALIDATE_HEADER } from "../response.js";
export type {
  FlightDataConsumer,
  FlightDataContext,
  ServerFunction,
  ServerFunctionMetadata,
  SingleFlightPayload
} from "./shared.js";

/** The context `prepareRequest` receives alongside the outgoing RequestInit. */
export interface PrepareRequestContext {
  /** The build-stable id of the function being called. */
  id: string;
  /**
   * The reference's declaration metadata (e.g. `method: "GET"` for
   * `GET(fn)` references). Plain references carry an empty object.
   */
  meta: ServerFunctionMetadata | undefined;
}

/**
 * Client-side session-dynamic transport hook: runs before every
 * server-function fetch. Return (or mutate and return) the RequestInit the
 * transport will use — the hook sees the final init, transport headers
 * included. The motivating case is dynamic credentials that rotate during
 * a session and apply uniformly to every call (OAuth bearer tokens); it is
 * the client-side symmetric of the server handler hooks. Single hook, not
 * a chain — compose by wrapping functions in userland.
 */
export type PrepareRequestHook = (
  init: RequestInit,
  context: PrepareRequestContext
) => RequestInit | Promise<RequestInit>;

/** Options for `configureServerFunctionsClient`. */
export interface ServerFunctionsClientConfig {
  /**
   * Endpoint the server's HTTP handler is mounted on. Must match the
   * server configuration — SSR'd reference `url`s (e.g. form actions) and
   * client fetches both derive from it. Prefix it when the app serves from
   * a base path (e.g. `` `${BASE_URL}_server` ``).
   * @default "/_server"
   */
  endpoint?: string;
  /**
   * Codec options (extra plugins etc.) for encoding arguments and decoding
   * results — must match the server's. Stored in the shared layer, so
   * `decodeResponse` sees them too.
   */
  codec?: JSONCodecOptions;
  /**
   * Runs before every server-function fetch. Return (or mutate and return)
   * the RequestInit the transport will use; `context.meta` is the
   * reference's declaration metadata (e.g. method). For session-dynamic
   * cross-cutting concerns — bearer tokens, tracing headers:
   *
   * ```ts
   * configureServerFunctionsClient({
   *   prepareRequest(init) {
   *     return {
   *       ...init,
   *       headers: { ...init.headers, Authorization: `Bearer ${session.token()}` }
   *     };
   *   }
   * });
   * ```
   */
  prepareRequest?: PrepareRequestHook;
  /**
   * Response-side integration seam — the client mirror of the handler's
   * `transformResult`. `handle(response, ctx)` sees every response before
   * the transport decodes it; returning anything but undefined resolves the
   * call with that value. `capture(info)` runs synchronously at the call
   * site (before any await) and its return arrives as `ctx.context`, so
   * ambient per-call state (e.g. a reactive owner) survives to response
   * time. See `createServerComponentHandler` in frame-transport for the
   * canonical implementation.
   */
  responseHandler?: {
    capture?(info: { id: string; meta: unknown }): unknown;
    handle(
      response: Response,
      ctx: { id: string; meta: unknown; args: unknown[]; context: unknown }
    ): unknown;
  };
  /**
   * Encoder for argument lists JSON can't carry faithfully. JSON-safe args
   * always go as plain JSON (no codec in the bundle); anything else throws
   * unless this is set. Installed by `enableRichArguments()` from the
   * rich-args entry — set directly only for custom wire encodings.
   */
  serializeArgs?(args: unknown[]): string | Promise<string>;
}

/**
 * Configures the client transport. Call once, before any server function is
 * invoked — typically in the client entry, next to `hydrate()`. Only needed
 * when deviating from the defaults (custom endpoint, codec plugins, or a
 * `prepareRequest` hook).
 */
export function configureServerFunctionsClient(config?: ServerFunctionsClientConfig): void;

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
 * Observes cloned requests and responses without handling them. Subscribe
 * from devtools; do not use this to replace `prepareRequest` /
 * `responseHandler`. The server entry exports a no-op of the same name so
 * isomorphic `@solidjs/web/server-functions` imports resolve.
 */
export function observeServerFunctionCalls(
  observer: (call: ServerFunctionCall) => void
): () => void;

/**
 * Declares a server function callable over HTTP GET: calls to the returned
 * reference go out as GET requests with the arguments codec-encoded in the
 * query string — cacheable by HTTP infrastructure. Cache headers flow
 * through the handler's header forwarding
 * (`respond(data, { headers: { "cache-control": "max-age=60" } })`).
 *
 * The declaration rides the metadata channel
 * (`getServerFunctionMetadata(fn)?.method === "GET"`) for routers and
 * integrations to detect, and the server honors it: GET-declared functions
 * accept GET requests in addition to the default POST transport (declaring
 * GET grants, it does not revoke); functions that never declared GET answer
 * GET requests with 405. Server-side the wrapper is identity-flavored — SSR
 * calls stay in-process.
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

/** Wire-state transitions a live call's iterable can report. */
export type LiveSourceStatus = "connected" | "reconnecting" | "closed";

/**
 * A live call's answer: the source's iterable, plus an optional `onstatus`
 * side channel for the wire facts the reconnect loop erases from the value
 * stream — `"connected"` on each successful (re)connect, `"reconnecting"`
 * (with the error) on each transient post-connect death, `"closed"` when
 * the source completes or the consumer ends it — with the error when the
 * end was a definite rejection (4xx) failing fast instead of retrying.
 */
export type LiveSource<R> = R & {
  onstatus?: (state: LiveSourceStatus, error?: unknown) => void;
};

/**
 * Declares a value-shaped live source: a server function returning an async
 * iterable whose yields are successive VALUES of one logical query, with the
 * contract that the source re-yields current state on every invocation.
 * Calls to the returned reference produce an iterable that survives the
 * connection — post-connect deaths re-invoke with exponential backoff
 * (reset per healthy value, woken early by connectivity returning),
 * first-connect failures reject like a normal call, and `break` aborts the
 * in-flight request. Live calls are reads and never opt into single-flight
 * enveloping. Wire state, if wanted, rides the returned iterable's
 * `onstatus` hook. Compose with `GET` inside-out: `live(GET(fn))`.
 */
export function live<A extends readonly any[], R>(
  fn: (...args: A) => R
): ServerFunction<A, LiveSource<Awaited<R>>>;

/**
 * Compiler ABI — emitted by compiled `"use server"` client output where a
 * server function was referenced; produces the fetch-backed callable for
 * the function's build-stable id. Development builds pass the function's
 * source name as the trailing argument (dev-only metadata seeded on the
 * metadata channel; never emitted in production). Not meant for
 * hand-written code.
 *
 * The optional `base` targets calls at that url verbatim instead of the
 * configured endpoint — for integrations reconstructing a callable from a
 * server-rendered action url (e.g. a router intercepting a form submit whose
 * `action="/_server?id=...&args=..."` came off the wire): bound arguments
 * stay in the query string, where the server reads them for natural-encoding
 * bodies (FormData, urlencoded).
 * @internal
 */
export function createServerReference(id: string, name?: string, base?: string): ServerFunction;

/**
 * Compiler ABI — only ever referenced by server-mode compiler output;
 * throws so a misconfigured build (server transform feeding a client
 * bundle) fails loudly instead of with a missing-export error. Not meant
 * for hand-written code.
 * @internal
 */
export function registerServerReference(): never;

/**
 * Identity of the currently executing server function call — see the
 * server entry. Named here so isomorphic code can import the type from
 * either entry.
 */
export interface ServerFunctionInvocation {
  id: string;
}

/**
 * Client no-op mirror of the server entry's accessor: there is never a
 * server function call in flight on the client, so this always returns
 * undefined. Present so `"use server"` modules that import it stay
 * import-stable in client builds before dead-code elimination.
 */
export function getServerFunctionInvocation(): ServerFunctionInvocation | undefined;
