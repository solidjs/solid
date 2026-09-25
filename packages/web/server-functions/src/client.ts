// @ts-nocheck
// Client half of the server function runtime ABI. Compiled client output
// calls `createServerReference(id)` where a server function was referenced;
// the function body never reaches this bundle. Hoisted from SolidStart's
// fns/client.ts with neutral header names and a configurable endpoint.
import { REVALIDATE_HEADER } from "../../src/response.js";
import { observeCall } from "../../src/observe.js";

// Replaced per build (see src/observe.ts): the observe emitter and its
// wrapper fold out of the prod artifact behind it.
const IS_OBSERVE = "_SOLID_OBSERVE_" as unknown as boolean;
// Replaced per build too; dev-only diagnostics fold out behind it.
const IS_DEV = "_SOLID_DEV_" as unknown as boolean;
// Local bindings for the annotations below — the `export type` block only
// re-exports these names without bringing them into scope, and declaration
// emit would leave them dangling (implicit any for every consumer).
import type { ServerFunction, ServerFunctionMetadata } from "./shared.js";
import {
  BODY_FORMAT_HEADER,
  BodyFormat,
  ERROR_HEADER,
  EventStreamReader,
  LAST_EVENT_ID_HEADER,
  LIVE_LOCAL,
  LIVE_RESUME_FROM,
  LIVE_SOURCE,
  LIVE_WIRE,
  REDIRECT_HEADER,
  SERVER_FUNCTION_INVOKE,
  SERVER_FUNCTION_METADATA,
  SINGLE_FLIGHT_HEADER,
  UNKNOWN_HEADER,
  configureServerFunctionsCodec,
  decodeResponse,
  deliverFlightData,
  extractBody,
  getFlightDataSourceIds,
  getHeadersAndBody,
  hasFlightMetadata,
  getServerFunctionMetadata,
  getServerFunctionsCodec,
  isJSONSafe,
  isServerFunction,
  MAX_GET_URL_LENGTH,
  parseServerFunctionAddress,
  positionDigest,
  provideServerFunctionRPC,
  serverFunctionActionUrlFor,
  serverFunctionAddress,
  serverFunctionDataAddress,
  serverFunctionLiveAddress,
  serverFunctionUrlFor,
  withMeta
} from "./shared.js";

// The flash cookie's name, detection and clearing are re-exported here so
// isomorphic integration code imports them from one specifier; the codec
// that fills the cookie is server-only and stays behind the server entry.
export {
  // Wire-protocol utilities re-exported for the frame transport: an
  // integration whose bundling would otherwise give the transport a private
  // copy of this module (solid-web's frames client) resolves its shared.js
  // import HERE instead — one copy of the framing/addressing code in the
  // app, and the codec/flight-consumer config the transport reads is the
  // shared built instance by construction.
  ChunkReader,
  ERROR_HEADER,
  EVENT_STREAM_HEARTBEAT,
  EventStreamReader,
  FLASH_COOKIE,
  LAST_EVENT_ID_HEADER,
  // the live loop's wire slot: the frames transport reads it off the
  // handler ctx to run a frame stream under the loop's lifetime
  LIVE_WIRE,
  REDIRECT_HEADER,
  SERVER_FUNCTION_INVOKE,
  SINGLE_FLIGHT_HEADER,
  UNKNOWN_HEADER,
  clearFlashCookie,
  createChunk,
  createEventChunk,
  decodeErrorHeaderValue,
  decodeRedirectHeaderValue,
  decodeResponse,
  decodeResponsePayload,
  deliverFlightData,
  deserializeStream,
  encodeErrorHeaderValue,
  frameAddress,
  getFlightDataConsumer,
  getFlightDataSourceIds,
  getServerFunctionMetadata,
  getServerFunctionsCodec,
  hasFlashCookie,
  hasFlightMetadata,
  invoke,
  isEventStream,
  isServerFunction,
  positionDigest,
  // the rich-args entry's codec write half: its bundled form (solid-web's
  // server-functions/dist/rich-args.js) resolves shared.js imports here so
  // the codec config it reads is the shared built instance
  serializeString,
  subscribeFlightData,
  withMeta
} from "./shared.js";
export { REVALIDATE_HEADER } from "../../src/response.js";

import { JSONCodecOptions } from "../../serialization/src/serializer-decode.js";

export type {
  FlightDataConsumer,
  FlightDataContext,
  InvokeOptions,
  ServerFunction,
  ServerFunctionInvoker,
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
   * Mount path the server's HTTP handler answers on. Must match the server
   * configuration — the id travels as the segment after it, and SSR'd
   * reference `url`s (e.g. form actions) and client fetches both derive
   * from it. Prefix it when the app serves from a base path
   * (e.g. `` `${BASE_URL}_server` ``).
   *
   * An absolute URL (`"https://api.example.com/_server"`) targets a handler
   * on another origin — for a client-only build served from elsewhere: a
   * static site, a browser extension, a WebView (`capacitor://localhost`)
   * whose local server owns every path on its own hostname. The call is
   * then cross-origin, and the server admits it only when its
   * `configureServerFunctionsServer({ csrf: { origin } })` allowlist names
   * the page's origin; it answers with the CORS headers the browser needs
   * (`Access-Control-Allow-Origin`, the preflight, the protocol's headers
   * exposed). Authenticate such a client with a bearer token through
   * `prepareRequest` rather than cookies; cookies travel cross-site only
   * with a `credentials: "include"` init, `SameSite=None; Secure` on the
   * cookie, and `csrf.allowCredentials` on the server.
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
   * Sends every server-function request — retries, telemetry, a test
   * double, or an app's own route. Always called as `(address, init)`, the
   * address relative to the document as the global one receives it, so
   * `parseServerFunctionActionUrl` reads the id back out for telemetry. `null`
   * restores the global.
   *
   * ```ts
   * configureServerFunctionsClient({
   *   fetch: (address, init) => fetch(rewrite(address), init)
   * });
   * ```
   *
   * Forward `init` — the call's `signal` rides on it, and dropping it voids
   * both the caller's abort and the teardown a live source's `break`
   * performs. Keep the call on the configured `endpoint`'s origin: a send
   * to any other is stamped `Sec-Fetch-Site: cross-site`, and the handler
   * admits it only when its `csrf.origin` allowlist names the page's
   * origin (see `endpoint`). Hand back what the peer answered, unread.
   *
   * A retrying wrapper may re-send a request that got NO response; it must
   * never replay one whose response ended. A response that dies mid-body may
   * have executed (mutations are not idempotent), and reconnecting a live
   * source is the runtime's job — a replay would race it.
   *
   * The wrapper replaces delivery for the requests the runtime chooses to
   * send; the call-to-request mapping itself is not contractual.
   */
  fetch?: ((address: string, init: RequestInit) => Response | Promise<Response>) | null;
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
 * Identity of the currently executing server function call — see the
 * server entry. Named here so isomorphic code can import the type from
 * either entry.
 */
export interface ServerFunctionInvocation {
  id: string;
}

const config = {
  endpoint: "/_server",
  fetch: undefined,
  prepareRequest: undefined,
  responseHandler: undefined,
  serializeArgs: undefined
};

/**
 * The url a `GET()` reference's own call requests — the address to preload
 * (`<link rel="preload" as="fetch">`), prefetch, warm in a service worker, or
 * fetch by hand — built the way the transport builds it, so a fetch of it IS
 * the call and matches the reference's later call in every cache that keys
 * on the url. Arguments ride the query as they do on the wire (`?args=`,
 * JSON), and must be JSON-safe here: the codec's encoding is asynchronous,
 * and a url rendered as a value cannot wait for it. Resolved against the
 * configured endpoint. The answer at this url is the transport's (codec
 * shape) — read one by hand with `decodeResponse`.
 *
 * Defined for declared reads only. A reference on the default transport
 * POSTs, and a POST is not described by its url; this throws with a pointer
 * (declare `GET(fn)`, or start the call with `invoke(fn, { priority: "low"
 * }, ...args)`). Also throws when the url would be long enough for the call
 * to fall back to POST — a url you hold is always one the transport would
 * request.
 *
 * ```tsx
 * const getUser = GET(async (id: string) => { "use server"; ... });
 * <link rel="preload" as="fetch" crossorigin href={serverFunctionUrl(getUser, id)} />
 * ```
 *
 * The form-post address is a different url — `fn.url`, or
 * `serverFunctionActionUrl` for one with bound arguments. The server entry
 * exports the same function so isomorphic imports resolve.
 */
export function serverFunctionUrl<A extends readonly unknown[]>(
  fn: ServerFunction<A, any>,
  ...args: A
): string;

/** The url a `GET()` reference's call requests: `<endpoint>/data/<id>[?args=...]`. */
export function serverFunctionUrl(fn, ...args) {
  return serverFunctionUrlFor(config.endpoint, fn, args);
} /**
 * Builds the plain-HTTP address of a function — what a `<form action>` posts
 * to without the runtime — for integrations composing action urls the
 * runtime did not render: a router turning a bound action into a form
 * action for the no-JS path. Takes the reference, or its id for an
 * integration that has only that (one reconstructing a callable from a
 * server-rendered url, before the declaring module has loaded).
 * `boundArgs` must be JSON-safe: the server reads them the way it reads a
 * form post's, and that convention has no codec. Resolved against the
 * configured endpoint, so a caller does not have to know where the handler
 * is mounted. Without bound arguments this is `fn.url`.
 *
 * Not where the reference's own call goes — for that (preloading, a fetch by
 * hand) see `serverFunctionUrl`. The server entry exports the same function
 * so isomorphic `@solidjs/web/server-functions` imports resolve.
 */
export function serverFunctionActionUrl(
  fn: ServerFunction | string,
  ...boundArgs: readonly unknown[]
): string;

/** The plain-HTTP address of a function: `<endpoint>/<id>[?args=...]`. */
export function serverFunctionActionUrl(fn, ...boundArgs) {
  return serverFunctionActionUrlFor(config.endpoint, fn, boundArgs);
} /**
 * Reads the function id back out of a server-rendered action url — the
 * deconstruction half of `serverFunctionActionUrl`, for an integration that
 * meets an action url before the module that declared it has loaded (a
 * router synthesizing an invocation for a server component's form). Answers
 * `null` when the url is not an address.
 */
export function parseServerFunctionActionUrl(url: string): string | null;

/** Reads the function id back out of a server-rendered action url. */
export function parseServerFunctionActionUrl(url) {
  const parsed = parseServerFunctionAddress(
    new URL(url, globalThis.location?.href || "http://localhost").pathname,
    config.endpoint
  );
  return parsed && parsed.id;
}

function serializeArguments(args) {
  if (!config.serializeArgs) {
    throw new Error(
      "Server function arguments are sent as JSON by default and these " +
        "arguments are not JSON-serializable. Call enableRichArguments() " +
        '(from "@solidjs/web/server-functions/rich-args") once at startup ' +
        "to send Dates, Maps, Sets, typed arrays, etc. through the codec — " +
        "or pass a single Blob/FormData/File argument, which has a native " +
        "HTTP encoding."
    );
  }
  return config.serializeArgs(args);
} /**
 * Configures the client transport. Call once, before any server function is
 * invoked — typically in the client entry, next to `hydrate()`. Only needed
 * when deviating from the defaults (custom endpoint, codec plugins, or a
 * `prepareRequest` hook, or a custom `fetch`).
 */
export function configureServerFunctionsClient(config?: ServerFunctionsClientConfig): void;

/**
 * Configures the transport before any server function is called: the
 * endpoint the server handler is mounted on, the codec options (extra
 * plugins etc. — must match the server's; stored in the shared layer so
 * `decodeResponse` sees them too), and the `prepareRequest` hook applied
 * to every outgoing server-function fetch (session-dynamic transport
 * policy — bearer tokens, tracing headers), and the `fetch` the transport
 * sends with.
 *
 * `responseHandler` is the response-side integration seam — the client
 * mirror of the handler's `transformResult`. `handle(response, ctx)` sees
 * every response before the transport decodes it; returning anything but
 * undefined resolves the call with that value instead. `capture(info)`
 * runs synchronously at the call site, before any await, and its return
 * arrives as `ctx.context` — ambient per-call state (e.g. a reactive
 * owner) survives to response time even though handling is async.
 */
export function configureServerFunctionsClient({
  endpoint,
  codec,
  fetch,
  prepareRequest,
  responseHandler,
  serializeArgs
} = {}) {
  if (endpoint !== undefined) config.endpoint = endpoint;
  if (codec !== undefined) configureServerFunctionsCodec(codec);
  if (fetch !== undefined) config.fetch = fetch;
  if (prepareRequest !== undefined) config.prepareRequest = prepareRequest;
  if (responseHandler !== undefined) config.responseHandler = responseHandler;
  if (serializeArgs !== undefined) config.serializeArgs = serializeArgs;
}

// Longest url the GET transport will build before falling back to POST.
// Every proxy, CDN and server in a request's path draws its own line — the
// lowest in common use is around 2 KB — so the transport stays under the
// smallest of them rather than discovering the limit as a 414 in production.
// Measured on the absolute url, which is what those limits apply to. The
// constant lives in shared.js: `serverFunctionUrl` refuses to render a url
// the transport would not request, on both entries.

// Fills the late-bound RPC seam (registry.js) with this transport's
// surface. Called from createServerReference/GET — the code compiled
// `'use server'` output invokes at module scope — NOT at this module's own
// scope: routers import codec-free helpers from the same built entry, and a
// top-level registration would be an unshakeable side effect pinning `GET`,
// `decodeResponse` and the codec behind them into every such bundle. Hung
// off the reference constructors, the whole transport (seroval included)
// tree-shakes away unless a reference actually exists — and when one does,
// the seam is filled before any integration code can hold it.
let rpcProvided = false;
function provideRPC() {
  if (rpcProvided) return;
  rpcProvided = true;
  provideServerFunctionRPC({ GET, decodeResponse });
}

// A reconstructed callable's base is a rendered PLAIN-HTTP address
// (`/_server/<id>?args=...`) — what a form posts to without the runtime.
// The transport's own calls belong at the data address, where answers are
// the codec's (#3094) — or at the live address, where they are the codec's
// in event-stream framing — so the kind's segment is spliced in ahead of
// the id; mount, origin and the query (bound arguments) ride along
// untouched.
function siblingAddressFor(base, kind) {
  const splitAt = base.search(/[?#]/);
  const path = splitAt < 0 ? base : base.slice(0, splitAt);
  const rest = splitAt < 0 ? "" : base.slice(splitAt);
  const slash = path.lastIndexOf("/");
  if (path.endsWith(`/${kind}/`, slash + 1)) return base; // already one
  return `${path.slice(0, slash + 1)}${kind}/${path.slice(slash + 1)}${rest}`;
}
const dataAddressFor = base => siblingAddressFor(base, "data");
const liveAddressFor = base => siblingAddressFor(base, "live");

function serverFunctionFailure(response, value) {
  // The labelled unknown-id 404 (#3110): the deployment that answered does
  // not know this call's id — version skew (a tab holding the previous
  // build's ids across a deploy) or a genuinely removed function.
  const unknown = response.headers.get(UNKNOWN_HEADER) !== null;
  const error =
    value ??
    new Error(
      unknown
        ? "Server function is not part of the deployment that answered (version skew or removed function)"
        : `Server function call failed with status ${response.status}`
    );
  // Stamp the HTTP status so policy layers (live retry loops, router
  // channels) can classify the failure: 4xx is a definite rejection that
  // retrying cannot change, 5xx/status-less is transient. An error that
  // already carries a status (app-authored) keeps its own.
  if (error instanceof Error && !("status" in error)) {
    error.status = response.status;
    // Retry-After survives to the retry layers too: a peer naming the wait
    // (a rate limiter's 429, a load balancer's 503) has answered the only
    // question a backoff guesses at (#3100). Seconds, like the header —
    // the HTTP-date form is converted.
    const retryAfter = parseRetryAfter(response.headers.get("Retry-After"));
    if (retryAfter !== undefined) error.retryAfter = retryAfter;
  }
  // Named on the error so an integration can recover from skew — reload
  // the document onto the current build — instead of surfacing a generic
  // failed call. Retrying cannot help: the id will stay unknown until the
  // page runs the new bundle.
  if (unknown && error instanceof Error) error.unknownFunction = true;
  return error;
}

// RFC 9110 §10.2.3: delta-seconds or an HTTP-date. Anything else is a header
// the peer got wrong, and guessing at it would put garbage on the error.
function parseRetryAfter(header) {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  return undefined;
}

// A call is a read when it is GET-encoded (a cacheable url) or declared one
// with `read: true` (a POST-shaped read: live sources, say — streams have no
// envelope story). Flight hooks and the consumer delivery that mirrors them
// are mutation policy, so both halves of the transport decide on this.
function isReadCall(options) {
  return !!options.read || (!!options.method && options.method.toUpperCase() === "GET");
}

async function createRequest(base, id, options, meta) {
  const headers = { ...options.headers };
  // A live loop's reconnect names where it left off. The one transport
  // header a read may carry (see below): it rides only to the live address,
  // which is `no-store` and never preloaded, so nothing keys on it.
  const wire = options[LIVE_WIRE];
  if (wire) {
    options = { ...options };
    delete options[LIVE_WIRE];
    if (wire.position !== undefined) headers[LAST_EVENT_ID_HEADER] = wire.position;
  }
  // A GET-encoded call's identity is its url, and nothing else: caches key
  // on it, and a `<link rel="preload" as="fetch">` is reused only by a
  // fetch matching it exactly, headers included, so a read carries no
  // header of the transport's own (#3406) — the scripted-caller signal is
  // the data address (#3094), and cross-wire correlation is the trace
  // context's job.
  //
  // Subscribing to flight data IS the single-flight opt-in: with consumers
  // registered the transport asks the server for collection on every
  // mutation call; a consumer-less app never asks the server to do
  // collection work. The header value is the registered source ids — the
  // server runs only the collectors the client can consume; the unnamed
  // registration rides under its reserved id "true" (see
  // getFlightDataSourceIds). Reads stay plain — folding per-request flight
  // data into a cacheable url would defeat caching.
  const flightSources = getFlightDataSourceIds();
  if (flightSources.length > 0 && !isReadCall(options)) {
    headers[SINGLE_FLIGHT_HEADER] = flightSources.join(",");
  }
  let init = {
    method: "POST",
    ...options,
    headers
  };
  // The session-dynamic transport hook runs last, over the final
  // RequestInit (transport headers included), so session policy can adjust
  // anything the transport is about to send.
  if (config.prepareRequest) {
    const prepared = await config.prepareRequest(init, { id, meta });
    // The hook's return is validated, not adopted wholesale (#3174): the
    // natural mistake — returning a fresh `{ headers }` instead of
    // spreading — used to silently drop the argument payload, the abort
    // signal and every protocol header, and the call still dispatched (as
    // a bare GET the handler answers 405, with nothing naming the cause).
    // The method the transport set is the sentinel: it is the one field
    // every call carries (a read has no body and no header of its own), and
    // a fresh `{ headers }` has none — `fetch` would default it to GET and
    // a POST call would dispatch without its payload. Everything else stays
    // the hook's to change — a deliberate body/signal replacement is in
    // contract (streaming uploads), dropping the protocol is not.
    if (prepared && prepared !== init) {
      if (typeof prepared !== "object") {
        throw new Error(
          "prepareRequest must return (or mutate and return) the RequestInit it received; " +
            `it returned a ${typeof prepared}. Spread the init: ` +
            "init => ({ ...init, headers: { ...init.headers, ... } })"
        );
      }
      if (
        typeof prepared.method !== "string" ||
        prepared.method.toUpperCase() !== init.method.toUpperCase()
      ) {
        throw new Error(
          `prepareRequest returned an init without the transport's ${init.method} method, ` +
            "which would send the call without its payload or protocol. Spread the init it " +
            "received: init => ({ ...init, headers: { ...init.headers, ... } })"
        );
      }
    }
    init = prepared || init;
  }
  const send = config.fetch || fetch;
  return send(base, init);
}

async function initializeResponse(base, id, options, args, meta) {
  // No args, skip serialization
  if (args.length === 0) {
    return createRequest(base, id, options, meta);
  }
  // A single argument with a natural HTTP encoding goes as-is
  if (args.length === 1) {
    const result = getHeadersAndBody(args[0]);
    if (result) {
      return createRequest(
        base,
        id,
        {
          ...options,
          body: result.body,
          headers: {
            ...options.headers,
            ...result.headers
          }
        },
        meta
      );
    }
  }
  // JSON-safe argument lists go as plain JSON — no codec on the wire, and
  // (because nothing else here references the serializer) no serialize-half
  // of the codec in the bundle. The try mirrors the server's encodeResult:
  // isJSONSafe answers "not safe" for cycles/depth instead of throwing, so
  // this only catches what negotiation can still hit (a throwing getter,
  // an engine limit) — falling through to the codec below, never rejecting
  // the call over the format choice itself.
  try {
    if (isJSONSafe(args)) {
      return createRequest(
        base,
        id,
        {
          ...options,
          body: JSON.stringify(args),
          headers: {
            ...options.headers,
            "Content-Type": "application/json",
            [BODY_FORMAT_HEADER]: BodyFormat.Json
          }
        },
        meta
      );
    }
  } catch {
    // fall through to the codec
  }
  // Bound calls ending in a natural HTTP encoding — `action.with(id)`
  // posting FormData/URLSearchParams — reuse the server-rendered form-post
  // convention: JSON-safe leading arguments ride the url's `?args` (the
  // handler prepends url arguments before natural-encoding bodies) and the
  // trailing argument IS the body. The same wire shape the no-JS fallback
  // produces, so bound form actions need no codec. `undefined` coerces to
  // null as it does in a router-rendered action url (JSON has none).
  // Strings are excluded so an `undefined` before one reaches the codec.
  if (args.length > 1) {
    try {
      const last = args[args.length - 1];
      const trailing = typeof last !== "string" && getHeadersAndBody(last);
      const leading = args.slice(0, -1).map(arg => (arg === undefined ? null : arg));
      if (trailing && isJSONSafe(leading)) {
        const target =
          base +
          (base.includes("?") ? "&" : "?") +
          "args=" +
          encodeURIComponent(JSON.stringify(leading));
        return createRequest(
          target,
          id,
          {
            ...options,
            body: trailing.body,
            headers: {
              ...options.headers,
              ...trailing.headers
            }
          },
          meta
        );
      }
    } catch {
      // same contract as above — negotiation failures fall to the codec
    }
  }
  // Everything else needs the codec, which is opt-in (enableRichArguments).
  return createRequest(
    base,
    id,
    {
      ...options,
      body: await serializeArguments(args),
      headers: {
        ...options.headers,
        "Content-Type": "text/plain",
        [BODY_FORMAT_HEADER]: BodyFormat.Serialized
      }
    },
    meta
  );
}

// `args` is the wire encoding's argument list; `callArgs` is the call's REAL
// arguments for the handler's context. They differ for GET calls, whose
// arguments ride pre-encoded in the url (wire args empty) — a handler keying
// state by the call (function + arguments) must still see the real ones.
// Observe tier: the `"call"` record (`OBSERVE.records`, see `CallEvent`) —
// the call as the caller awaited it, request through decode; with no
// listener the dispatch runs bare, not even reading the clock. The wrapper
// exists in the observe and dev artifacts only: `fetchServerFunction` below
// is the dispatch itself where the literal folds, so prod pays neither the
// extra frame nor the promise hop.
async function observedFetch(base, id, options, args, meta, callArgs = args) {
  const observation = observeCall(
    id,
    options.method && options.method.toUpperCase() === "GET" ? "GET" : "POST",
    callArgs
  );
  if (!observation) return dispatchServerFunction(base, id, options, args, meta, callArgs);
  let result;
  try {
    result = await dispatchServerFunction(base, id, options, args, meta, callArgs, observation);
  } catch (error) {
    observation.settle("error", error);
    throw error;
  }
  observation.settle("ok", result);
  return result;
}
const fetchServerFunction = IS_OBSERVE ? observedFetch : dispatchServerFunction;

async function dispatchServerFunction(base, id, options, args, meta, callArgs = args, observation) {
  // Captured synchronously at the call site (an async function body runs
  // sync up to its first await), so ambient call context is still live.
  const handler = config.responseHandler;
  const context = handler && handler.capture ? handler.capture({ id, meta }) : undefined;

  // The call owns an AbortController so a streaming result can be ENDED, not
  // just abandoned: `iterator.return()` on the received iterable aborts the
  // fetch, which closes the response body here (settling the codec's
  // bookkeeping through the drain's failure sweep) and fires
  // `request.signal` on the server (tearing the producer down). Only minted
  // when the caller didn't bring a signal — a caller-supplied signal already
  // owns the wire, and cancellation stays theirs.
  const controller = options.signal ? undefined : new AbortController();
  if (controller) options = { ...options, signal: controller.signal };

  const response = await initializeResponse(base, id, options, args, meta);
  if (IS_OBSERVE && observation) observation.response(response);

  // The integration seam sees the response first: a handler that claims it
  // (returns non-undefined) owns the call's result — and, when a `live` loop
  // made the call, its lifetime: the loop's wire slot rides along (see
  // LIVE_WIRE) so the handler can read the body through the loop's reader
  // and hang the connection's end on the slot as the decoder would.
  if (handler) {
    const ctx = { id, meta, args: callArgs, context };
    if (options[LIVE_WIRE]) ctx[LIVE_WIRE] = options[LIVE_WIRE];
    const handled = handler.handle(response, ctx);
    if (handled !== undefined) return handled;
  }

  // Every response the runtime encodes carries the body format — a void one
  // and a thrown one included — so at 400 and up its absence means the peer
  // refused. Answered before the passthrough beneath, because a refusal can
  // carry a `Location` of its own and the passthrough would hand it back as
  // control flow; and undecoded, because its body is someone else's, not a
  // payload for the caller.
  if (response.status >= 400 && !response.headers.has(BODY_FORMAT_HEADER)) {
    throw serverFunctionFailure(response, undefined);
  }

  // The protocol's own error tag is the failure signal, alone: among
  // responses the runtime encoded (body format present), the status is the
  // author's to choose — `respond(value, { status: 500 })` resolves like any
  // other returned value, and only a THROWN outcome rejects (#3097). A
  // peer's own 5xx (proxy, load balancer) carries no body format and was
  // already refused above, so dropping the status from this decision loses
  // nothing.
  const failed = response.headers.has(ERROR_HEADER);

  // Mutation responses with registered flight consumers: the transport owns
  // the unwrap, and the consumers own what the response MEANS beyond its
  // value. Two things reach them, on one delivery:
  //
  // - Folded data: the standardized `{ value, data }` body is decoded and
  //   each slice of the keyed envelope goes to its source's consumer (the
  //   unnamed one subscribes under the reserved id "true"); the response
  //   header names the folded sources.
  // - Integration metadata — the redirect carrier and `X-Revalidate` keys —
  //   is envelope-level: it describes what the mutation did to every cache
  //   on the page (navigate here, these keys went stale), not a slice of
  //   data for one of them. So a response carrying it is delivered to EVERY
  //   registered consumer, folded or not, its slice `undefined` where the
  //   server folded none for it. An integration that subscribed applies
  //   redirects and revalidation without wrapping the call, and a redirect
  //   the server collected no data for — a cross-origin target, a declined
  //   or failing collector, no hook registered at all — still navigates
  //   instead of landing on the caller as a raw `Response`.
  //
  // `value` returns to the caller as if the call were plain. Reads stay
  // out of this: a GET (or `read: true`) response is the caller's data, and
  // a read path that answers a redirect is the reading integration's to
  // interpret in place (holding the read across the navigation, say), so
  // it passes through whole below. Error semantics mirror that passthrough:
  // metadata-bearing responses are control flow for the consumers, bare
  // error-tagged ones throw the value.
  //
  // The delivery itself — which consumer gets which slice, in what order —
  // is `deliverFlightData`, the one implementation every transport that can
  // carry the envelope shares (the frames client's flight application
  // decodes its envelope from `outcome` chunks and then calls the same
  // function), so a mutation reads identically whichever body shape it
  // arrived in. What stays here is the plain body's decode and the
  // read-call exclusion, which are this transport's.
  if (!isReadCall(options) && getFlightDataSourceIds().length > 0) {
    const folded = response.headers.has(SINGLE_FLIGHT_HEADER);
    const metadata = hasFlightMetadata(response);
    if (metadata || folded) {
      // Decoded from the response ITSELF: the transport owns this body, the
      // consumers' contract says it arrives consumed (`FlightDataContext`),
      // and a clone would tee the whole envelope into a branch nobody reads
      // (#3244). Only a folded response carries the envelope; a metadata
      // response the server folded nothing into is the plain value.
      const decoded = response.body
        ? await extractBody(response, getServerFunctionsCodec())
        : undefined;
      const enveloped = folded && decoded !== undefined;
      const value = enveloped ? decoded.value : decoded;
      await deliverFlightData(response, enveloped ? decoded.data : undefined);
      if (failed && !metadata) {
        throw serverFunctionFailure(response, value);
      }
      return value;
    }
  }

  // Responses the caller's integration needs to see whole — redirects,
  // revalidation and single-flight payloads on a read or with no consumer
  // registered — pass through untouched; the integration decodes the body
  // itself with `decodeResponse`. The runtime's redirects ride
  // REDIRECT_HEADER (#3102; an authored `Location` on a forwarding status
  // like 201 is data, not control flow, and decodes normally). A real 3xx
  // status is a peer's control flow: fetch follows the followable set
  // before the transport sees it, so one only arrives where something
  // opted out of following — except 304, which is the answer to a
  // conditional read, not navigation.
  if (
    response.headers.has(REDIRECT_HEADER) ||
    response.headers.has(REVALIDATE_HEADER) ||
    response.headers.has(SINGLE_FLIGHT_HEADER) ||
    (response.status >= 300 && response.status < 400 && response.status !== 304)
  ) {
    return response;
  }

  // Among success answers, only what the runtime wrote may resolve the call
  // (#3173, revisiting #3087): every response the runtime encodes carries
  // the body format — a void one included — and a verbatim passthrough
  // carries X-Content-Raw. A 2xx with neither is ordinary infrastructure
  // answering in the origin's place (a captive portal, a WAF interstitial,
  // a CDN error page served at 200, a misrouted SPA index), and resolving
  // it as `undefined` read "no data" where the truth was "not our server" —
  // indistinguishable from a void result, invisible to error boundaries,
  // and a committed-looking success for a mutation. The header alone is
  // judge, never the body: #3087's rule against content-type heuristics
  // stands, only its scope moved. 304 is left alone — it is the answer to
  // a conditional read, not a payload, and decodes to nothing at any peer.
  if (
    response.status < 300 &&
    !response.headers.has(BODY_FORMAT_HEADER) &&
    !response.headers.has("X-Content-Raw")
  ) {
    throw serverFunctionFailure(
      response,
      new Error(
        `Server function response carries no recognized encoding (status ${response.status}` +
          `${
            response.headers.get("Content-Type")
              ? `, content-type ${response.headers.get("Content-Type")}`
              : ""
          }): answered by something other than the server function runtime`
      )
    );
  }

  // Decoded from the response ITSELF, not a clone (#3244). The transport
  // owns this body — every road that hands it to somebody else has already
  // returned above — so a clone would only tee it into a branch nobody
  // reads, which queues the whole payload for the life of the read.
  // `decodeResponse` keeps its clone for integrations, who still own theirs.
  const result = response.body
    ? await extractBody(response, getServerFunctionsCodec(), options[LIVE_WIRE])
    : undefined;
  if (failed) {
    throw serverFunctionFailure(response, result);
  }
  // Streaming result: wrap so stopping consumption stops the CALL. Without
  // this, `return()` (a `break` in for-await) only detaches the local
  // iterator — the fetch keeps downloading and the server keeps producing.
  // Top-level only, matching the server's value-tier teardown scope.
  if (controller && result?.[Symbol.asyncIterator]) {
    return {
      [Symbol.asyncIterator]() {
        const it = result[Symbol.asyncIterator]();
        return {
          next: () => it.next(),
          return: value => (controller.abort(), Promise.resolve({ done: true, value }))
        };
      }
    };
  }
  return result;
} /**
 * Compiler ABI — emitted by compiled `"use server"` client output where a
 * server function was referenced; produces the fetch-backed callable for
 * the function's build-stable id. Development builds pass the function's
 * source name as the trailing argument (dev-only metadata seeded on the
 * metadata channel; never emitted in production). Not meant for
 * hand-written code.
 *
 * The optional `base` roots calls at that url instead of the configured
 * endpoint — for integrations reconstructing a callable from a
 * server-rendered action url (e.g. a router intercepting a form submit whose
 * `action="/_server/<id>?args=..."` came off the wire): bound arguments
 * stay in the query string, where the server reads them for natural-encoding
 * bodies (FormData, urlencoded). The rendered url is the plain-HTTP address;
 * the callable's own calls are scripted, so they go to its data-address
 * sibling (`/_server/data/<id>?args=...`) — same mount, same query.
 * @internal
 */
export function createServerReference(id: string, name?: string, base?: string): ServerFunction;

/**
 * Produces the client-side callable for a server function id. The returned
 * proxy exposes `id` (the build-stable function id) and `url` (direct HTTP
 * invocation — form actions, progressive enhancement) and carries the
 * declaration-metadata brand so `isServerFunction` recognizes it.
 *
 * Development output passes the function's source name as the trailing
 * argument; it seeds the metadata channel as a default — explicit
 * `withMeta`/`GET` writes shallow-merge over it like any other write.
 */
export function createServerReference(id, name, base) {
  provideRPC();
  const metadata = name === undefined ? {} : { name };
  // An explicit base roots calls at that url — integrations reconstructing
  // a callable from a server-rendered action url (`/_server/<id>?args=...`) keep
  // its bound arguments in the query string, where the server reads them
  // for natural-encoding bodies; the call itself goes to the rendered
  // address's data-address sibling (see dataAddressFor). Default calls
  // derive from the configured endpoint (lazily — it may be configured
  // after module scope runs).
  // One body for both entrances — `fn(...args)` and `invoke(fn, args,
  // options)`: the invocation channel IS the call path with the per-call
  // options slot exposed, so the two can never drift.
  const run = (args, invokeOptions) => {
    // Local-answer seam, SYNCHRONOUS on purpose: an integration that already
    // holds this call's result (e.g. a document-SSR'd server-component
    // boundary at hydration time) answers without a promise — so async
    // consumers (dynamic under a hydrating Loading) never observe a pending
    // beat that would commit them to a fallback and discard SSR'd content.
    const send = () =>
      fetchServerFunction(
        base ? dataAddressFor(base) : serverFunctionDataAddress(config.endpoint, id),
        id,
        invokeOptions ? { ...invokeOptions } : {},
        args,
        metadata
      );
    const handler = config.responseHandler;
    if (handler && handler.intercept && !adoptedCall(invokeOptions)) {
      const hit = handler.intercept({ id, meta: metadata, args });
      if (hit !== undefined) return localOrSend(hit, send);
    }
    return send();
  };
  const fn = (...args) => run(args);
  fn[SERVER_FUNCTION_METADATA] = metadata;
  fn[SERVER_FUNCTION_INVOKE] = run;

  return new Proxy(fn, {
    get(target, prop) {
      if (prop === "id") return id;
      if (prop === "url") {
        return base || serverFunctionAddress(config.endpoint, id);
      }
      return target[prop];
    }
  });
} /**
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
 * DECLARING GET IS A SAFETY ASSERTION, not only a transport choice: the
 * server's CSRF origin gate is skipped for declared reads by design
 * (same-origin policy already keeps a cross-site caller from READING the
 * response, and the gate's `Vary` would fragment the shared-cache entries
 * this helper exists to enable), so a GET-declared function is EXECUTABLE
 * from any origin, with caller-chosen arguments, carrying the user's
 * ambient cookies (#3114). Declare GET only for reads that are safe in the
 * HTTP sense (RFC 9110 §9.2.1): nothing a hostile caller gains by
 * triggering it. Anything less stays on POST, which remains origin-gated;
 * a deployment that does not rely on shared caches can gate its reads too
 * with `csrf: { protectDeclaredReads: true }`.
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
 * Declares a server function callable over HTTP GET: calls to the returned
 * reference go out as GET requests with the arguments codec-encoded in the
 * query string — cacheable by HTTP infrastructure. The declaration is
 * recorded on the metadata channel (`getServerFunctionMetadata(fn).method
 * === "GET"`) for routers and integrations to read, and the server half
 * honors it: the declaration grants GET dispatch without revoking the
 * default POST transport, while GET requests to undeclared functions
 * answer 405.
 *
 * Declaring GET is a safety assertion (see the public overload's notes and
 * #3114): the origin gate is skipped for declared reads, so the function
 * must be a safe read in the RFC 9110 §9.2.1 sense.
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
  if (!isServerFunction(fn)) {
    throw new Error("GET expects a server function reference");
  }
  provideRPC();
  const id = fn.id;
  // the GET-transport callable inherits the source reference's declared
  // metadata (withMeta composes with GET in either order)
  const metadata = { ...getServerFunctionMetadata(fn) };
  // Per-call invocation composes through the declaration: the channel is
  // the same body with the options slot exposed, so `invoke(GET(fn), args,
  // { signal })` goes over the query encoding, POST fallback included.
  const run = async (args, invokeOptions) => {
    const handler = config.responseHandler;
    if (handler && handler.intercept && !adoptedCall(invokeOptions)) {
      const hit = handler.intercept({ id, meta: metadata, args });
      if (hit !== undefined) return localOrSend(hit, () => send(args, invokeOptions));
    }
    return send(args, invokeOptions);
  };
  const send = async (args, invokeOptions) => {
    const opts = invokeOptions || {};
    // A live loop calling through the declaration is the third caller kind
    // and gets the third address (see serverFunctionLiveAddress); the query
    // encoding and the POST fallback are the same at either.
    const address = opts[LIVE_WIRE]
      ? serverFunctionLiveAddress(config.endpoint, id)
      : serverFunctionDataAddress(config.endpoint, id);
    if (!args.length) {
      return fetchServerFunction(address, id, { ...opts, method: "GET" }, [], metadata, args);
    }
    // The handler accepts both encodings: plain JSON and the codec's framed
    // string (distinguished by the `;0x` frame prefix).
    const encoded = isJSONSafe(args) ? JSON.stringify(args) : await serializeArguments(args);
    const url = `${address}?args=${encodeURIComponent(encoded)}`;
    const absolute = new URL(url, globalThis.location?.href || "http://localhost").href;
    // Arguments too long for a url call over POST instead: a cache miss, not
    // an error. A GET declaration grants the read methods without revoking
    // the default transport, so the same call still dispatches — it just
    // stops being cacheable, which beats a 414 from whichever proxy in the
    // chain draws the line first. `read` keeps it a read: the declaration
    // says so, and a POST-shaped read must not ask the server for
    // single-flight collection, which is mutation policy.
    if (absolute.length > MAX_GET_URL_LENGTH) {
      return fetchServerFunction(address, id, { ...opts, read: true }, args, metadata);
    }
    return fetchServerFunction(url, id, { ...opts, method: "GET" }, [], metadata, args);
  };
  const wrapped = (...args) => run(args);
  wrapped[SERVER_FUNCTION_METADATA] = metadata;
  wrapped[SERVER_FUNCTION_INVOKE] = run;
  wrapped.id = id;
  // lazy like the base proxy's: the endpoint may be configured after the
  // module-scope GET(...) call runs
  Object.defineProperty(wrapped, "url", {
    get: () => serverFunctionAddress(config.endpoint, id),
    configurable: true
  });
  // the declaration itself is a metadata write like any other
  return withMeta(wrapped, { method: "GET" });
}

// Dev-only: the open live connections on this page, by function id. `live`
// holds one connection per source for as long as the source is alive, and
// a browser allows six per origin under HTTP/1.1 — the seventh request to
// the origin (a navigation, a fetch, an image) waits behind them. HTTP/2 is
// part of `live`'s precondition; the warning fires once, when the sixth
// connection opens on a page whose own document came over HTTP/1.x (the
// resource timing entry for a live response only exists once it has ended,
// so the navigation's protocol stands in for the origin's).
const openLiveConnections = IS_DEV ? new Map() : undefined;
let warnedHttp1 = false;
function trackLiveConnection(id, open) {
  const count = openLiveConnections.get(id) || 0;
  if (open) openLiveConnections.set(id, count + 1);
  else if (count > 1) openLiveConnections.set(id, count - 1);
  else openLiveConnections.delete(id);
  if (!open || warnedHttp1) return;
  let total = 0;
  for (const n of openLiveConnections.values()) total += n;
  if (total <= 5) return;
  const navigation =
    typeof performance !== "undefined" && typeof performance.getEntriesByType === "function"
      ? performance.getEntriesByType("navigation")[0]
      : undefined;
  const protocol = navigation && navigation.nextHopProtocol;
  if (typeof protocol !== "string" || !/^http\/1(\.[01])?$/.test(protocol)) return;
  warnedHttp1 = true;
  const names = [...openLiveConnections].map(([fnId, n]) => (n > 1 ? `${fnId} ×${n}` : fnId));
  console.warn(
    `live: ${total} live connections are open (${names.join(", ")}) and this page was served ` +
      `over ${protocol}. Browsers allow six connections per origin under HTTP/1.1, so the next ` +
      `request to this origin — a navigation, a fetch, an image — waits behind them. live ` +
      `requires HTTP/2: the dev server speaks it with \`server.https\`; production hosts do by default.`
  );
} /**
 * A live reference: calling it opens an iteration and hands back the
 * reconnecting iterable ITSELF, synchronously — not a promise of one (the
 * transport connects lazily, on the first pull). This is the client-half
 * shape; the server half's in-process call is async and resolves to the
 * branded iterable, so isomorphic consumers `await` the call — awaiting
 * the client's plain iterable is identity. Identity fields mirror
 * `ServerFunction`.
 */
export interface LiveServerFunction<A extends readonly any[] = any[], R = any> {
  (...args: A): LiveSource<R>;
  /** The build-stable function id (stable across the client and server builds). */
  readonly id: string;
  /** URL invoking this function directly over HTTP. */
  readonly url: string;
}

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
): LiveServerFunction<A, Awaited<R>>;

/**
 * Declares a value-shaped live source: a server function returning an async
 * iterable whose yields are successive VALUES of one logical query. The
 * declaration buys the wire-level lifecycle a raw stream doesn't have:
 * calls to the returned reference produce an iterable that survives the
 * connection — when the stream dies (network drop, server restart; the
 * rejections the transport's failure wiring produces) it re-invokes the
 * function with exponential backoff and keeps yielding, resetting the
 * backoff on every healthy value. A failure on the FIRST connect still
 * rejects like a normal call (a typo shouldn't retry silently), normal
 * completion completes the iterable, and `break` aborts the in-flight
 * request through the transport's return() wiring.
 *
 * Deliberately wire-level ONLY. Each iteration of the returned iterable is
 * its own connection (that's what makes reconnect trivial); sharing is the
 * reactive graph's job — ONE call site consumes the stream and every
 * reader of that memo shares its latest value, so sharing across the tree
 * means hoisting the memo, the same idiom as any fetch. There is no cached
 * value by design: the value-shaped contract makes the SERVER the cache —
 * every (re)connect re-yields current state as its first value. This is
 * the wire contract a data layer builds ON, not a data layer itself: a
 * router-level live query can hold ONE iteration open and multicast it
 * (keying, replay-latest, refcounts all channel-side), and its refresh
 * stays honest — close the iteration, open a new one, fresh connection by
 * construction. There is no revalidation here (a live source self-updates;
 * a mutation's effects arrive through the open stream) and hence no
 * single-flight participation (live calls are reads and never request
 * enveloping). All behavior lives inside this declaration — apps that
 * never import `live` carry none of it. Compose with `GET` inside-out
 * (`live(GET(fn))`): live must be the outermost declaration, since its
 * behavior wraps the call.
 *
 * Wire state, if a UI wants it, rides an optional `onstatus` hook on the
 * returned iterable — a side channel for the facts the retry loop
 * deliberately erases from the value stream: `"connected"` on each
 * successful (re)connect, `"reconnecting"` (with the error) on each
 * post-connect death, `"closed"` when the source completes or the
 * consumer ends it. Retry is for transient deaths only: a definite
 * rejection (4xx — the server understood and refused) fails fast, firing
 * `"closed"` with the error and rejecting the consumer's pull — except
 * the statuses that themselves say "retry" (408, 425, 429) and any
 * answer carrying Retry-After, which reconnect like a 5xx, honoring the
 * named wait. First-connect failures emit nothing (the rejection
 * already surfaces through the call). The hook is per CALL: iterating one
 * object twice interleaves both lifecycles into it. Data freshness is
 * usually the better question and belongs in the value (timestamps /
 * heartbeats) — the hook is for genuinely wire-shaped UI.
 *
 * ```ts
 * export const stockPrice = live(async function* (symbol: string) {
 *   "use server";
 *   for await (const tick of subscribe(symbol)) yield tick.price;
 * });
 *
 * // consumer, wiring status to a signal:
 * const src = stockPrice("ACME");
 * src.onstatus = setStatus;
 * const price = createMemo(() => src);
 * ```
 */
/**
 * A local hit's resolution: a synchronous hit IS the answer; a deferred hit
 * (a promise — the integration's answer has not landed yet, e.g. a boundary
 * the document is still delivering) answers when it settles, and settling
 * to nothing is a miss after all — the call goes to the wire then.
 */
function localOrSend(hit, send) {
  if (hit === null || typeof hit.then !== "function") return hit;
  return hit.then(answer => (answer === undefined ? send() : answer));
}

/**
 * Whether a call is a `live` iteration's connect AFTER the document's
 * answer was yielded (the wire slot rides on the invoke options, see
 * LIVE_WIRE): the intercept that answered it locally must not answer
 * again — this connect is the one that goes to the wire.
 */
function adoptedCall(options) {
  const wire = options && options[LIVE_WIRE];
  return !!(wire && wire.adopted);
}

export function live(fn) {
  if (!isServerFunction(fn)) {
    throw new Error("live expects a server function reference");
  }
  const id = fn.id;
  const metadata = { ...getServerFunctionMetadata(fn), live: true };
  const makeIterable = (args, invokeOptions) => {
    // The document's answer, SYNCHRONOUSLY at the call (the local-answer
    // seam the plain proxy has, see dispatchServerFunction): an integration
    // showing this call at t=0 — a frames boundary the page carries, adopted
    // at hydration — answers without a wire. The answer rides on the
    // iterable as LIVE_LOCAL: a hydrating node adopts it as its value now
    // and takes over at its scope's release (solid-js's compute wrapper);
    // any other consumer's iteration yields it first, then connects. Either
    // way the connect that follows is not answered locally again (`adopted`).
    const handler = config.responseHandler;
    const local =
      handler && handler.intercept ? handler.intercept({ id, meta: metadata, args }) : undefined;
    const iterable = {
      [LIVE_SOURCE]: true,
      [Symbol.asyncIterator]() {
        let it; // current underlying iterator (undefined between connections)
        let connected = false; // a connect succeeded once — later deaths reconnect
        let attempts = 0;
        let stopped = false;
        let closed = false; // "closed" fires exactly once per iteration
        // The current connection's lifetime signal (see LIVE_WIRE): set by
        // the decoder when the answer arrived as a codec stream, undefined
        // for an answer with no stream behind it (a void or intercepted
        // answer), whose local iterator's end is then the whole story.
        let ended;
        let timer, wake; // interruptible backoff sleep
        const DONE = { done: true, value: undefined };
        // The iteration owns a controller so ending consumption (`break`)
        // severs the wire; a caller-supplied signal (invoke) rides alongside
        // through AbortSignal.any — either ends the iteration, and because
        // the combined signal reaches every (re)connect's fetch, an abort
        // cancels the CURRENT connection whichever attempt it is.
        const invokeSignal = invokeOptions && invokeOptions.signal;
        const controller = new AbortController();
        // The iteration's wire slot (see LIVE_WIRE): the reader it opens
        // records each event's `id:` as the position, and every (re)connect
        // sends the position back as `Last-Event-ID` — a cursor for a source
        // that named one, the runtime's value digest otherwise, which lets
        // the server skip a first emission this iteration already holds.
        // The reader is built here so that `live` is what carries it.
        // `connection` is renewed per connect; the decoder hangs the body's
        // end on it (see deserializeStream) — the lifetime signal below.
        // A hydration takeover seeds the position from the value the page
        // was served with (LIVE_RESUME_FROM, stamped by the hydrating node's
        // compute wrapper), so a takeover that finds the same value on the
        // server costs nothing on the wire. The iteration yields that value
        // FIRST, before it connects: the server's digest-equal skip means the
        // wire may never carry a first emission, and the node that re-ran its
        // compute for the takeover has no other way to land — left pending,
        // it holds every write of the tick that released it (the root pass's
        // held writes replay in that same tick) until the source changes.
        // Landing the value the consumer already holds is equality-quiet for
        // a memo and a no-op reconcile for a projection.
        let resume = iterable[LIVE_RESUME_FROM];
        // The document's answer (see LIVE_LOCAL above): yielded first, like
        // a resume value, and it marks the iteration adopted — the connect
        // after it goes to the wire. A resume marks it too: the page already
        // shows what a local answer would hand over.
        let seed = iterable[LIVE_LOCAL];
        const wire = {
          position: resume !== undefined ? positionDigest(resume) : undefined,
          connection: undefined,
          adopted: resume !== undefined,
          open: body => new EventStreamReader(body, wire)
        };
        // Ends handed over by connections that died while this iteration
        // meant to go on: their open deferreds are left pending (the
        // re-yielded answer supersedes them) until the iteration ends for
        // good, when they are settled by HOW it ended — see emitClosed.
        const ends = [];
        const settle = (end, error) => {
          try {
            error !== undefined ? end.sweep() : end.close();
          } catch {}
        };
        const settleAll = error => {
          while (ends.length) settle(ends.pop(), error);
        };
        const wireOptions = {
          ...invokeOptions,
          [LIVE_WIRE]: wire,
          signal: invokeSignal
            ? AbortSignal.any([invokeSignal, controller.signal])
            : controller.signal
        };
        // Wire-state side channel: the retry loop erases deaths from the
        // value stream BY DESIGN (encapsulated reconnect), so the hook is
        // the only place downstream can learn them. Read late (at fire
        // time) so consumers can assign after receiving the object; a
        // throwing hook must not corrupt the loop. Facts only the
        // transport knows: "connected" (each successful (re)connect),
        // "reconnecting" (each post-connect death, with the error),
        // "closed" (source completed or consumer ended — invisible to a
        // memo consumer, which just latches). First-connect failures emit
        // nothing: the rejection already surfaces through the call.
        const emit = (state, error) => {
          try {
            iterable.onstatus && iterable.onstatus(state, error);
          } catch {}
        };
        // dev connection accounting (see trackLiveConnection); idempotent
        // per connection so every road a connection ends by can call it
        let counted = false;
        const track = open => {
          if (!IS_DEV || open === counted) return;
          counted = open;
          trackLiveConnection(id, open);
        };
        const emitClosed = error => {
          track(false);
          // Ending for good: settle whatever is still open — the deferreds
          // outlived deaths left pending, and the current connection's once
          // its body ends (severed by the controller, or already done) — by
          // how the iteration ended. BY ERROR (a 4xx, the caller's signal):
          // fail them, so no consumer of a nested value hangs on a failure
          // it needs to hear about. BY THE CONSUMER (`return()` — a memo
          // re-invoking with new arguments) or by the source completing:
          // nested streams complete and nested promises stay pending. Their
          // readers are superseded by the next answer — reactivity moves
          // everything downstream — and an error here would reach a child
          // still attached to the old answer as a failure it did not cause
          // (an AbortError from our own controller halting the page).
          settleAll(error);
          if (ended) ended.then(end => settle(end, error));
          if (closed) return;
          closed = true;
          emit("closed", error);
        };
        const closeIt = value => {
          track(false);
          const current = it;
          it = undefined;
          if (current) {
            try {
              const r = current.return && current.return(value);
              if (r && typeof r.then === "function") r.then(undefined, () => {});
            } catch {}
          }
        };
        const callOnce = () => {
          // A GET-composed reference is already a flight-free read with its
          // own query-string encoding — delegate through its invocation
          // channel so the wire options (the combined signal and the wire
          // slot, which moves it to the live address) reach its fetch.
          // Otherwise call the transport directly, at the live address, with
          // the POST marked a read: live responses are streams, which have
          // no single-flight envelope story (and flight collection is
          // mutation policy).
          if (metadata.method === "GET") return fn[SERVER_FUNCTION_INVOKE](args, wireOptions);
          const handler = config.responseHandler;
          if (handler && handler.intercept && !wire.adopted) {
            const hit = handler.intercept({ id, meta: metadata, args });
            if (hit !== undefined) return hit;
          }
          return fetchServerFunction(
            liveAddressFor(fn.url),
            id,
            { ...wireOptions, read: true },
            args,
            metadata,
            args
          );
        };
        const pull = async () => {
          if (resume !== undefined) {
            const value = resume;
            resume = undefined;
            if (!stopped) return { done: false, value };
          }
          if (seed !== undefined) {
            // A deferred local answer (the boundary is still arriving) is
            // awaited: it lands with the reveal, and the connect follows it
            // — never ahead of the document's own render. Settling to
            // nothing is a miss after all: straight to the wire.
            const value = typeof seed.then === "function" ? await seed : seed;
            seed = undefined;
            if (value !== undefined) {
              wire.adopted = true;
              if (!stopped) return { done: false, value };
            }
          }
          while (!stopped) {
            try {
              if (!it) {
                const connection = (wire.connection = { ended: undefined });
                const result = await callOnce();
                connected = true;
                ended = connection.ended;
                // a plain-value answer is a one-value stream
                it =
                  result !== null && typeof result === "object" && result[Symbol.asyncIterator]
                    ? result[Symbol.asyncIterator]()
                    : (async function* () {
                        yield result;
                      })();
                // stopped while connecting: the just-arrived stream must
                // still be ended, and the controller severs its wire
                if (stopped) {
                  closeIt();
                  controller.abort();
                  return DONE;
                }
                track(true);
                emit("connected");
              }
              // The answer is alive while its RESPONSE is (RFC 10, Lifetime):
              // a nested stream or promise inside a yielded object keeps the
              // connection open after the top-level iterable is done, and a
              // body that ends on open deferreds is a death whichever level
              // they sit at. So the read races the body's end — values still
              // buffered win the race, the loop reads them first — and a
              // finished top-level iterator waits for the end to say which
              // it was: completion (nothing owed) completes the iteration;
              // death reconnects and re-yields the whole answer.
              const r = await (ended
                ? Promise.race([it.next(), ended.then(end => ({ end }))])
                : it.next());
              if (r.end || r.done) {
                const end = r.end || (ended && (await ended));
                if (end && end.open > 0) {
                  // a death this iteration will outlive: the open deferreds
                  // stay pending until it ends for good (see ends); the
                  // body's error goes down the reconnect path like a
                  // rejected read would
                  ends.push(end);
                  throw end.error;
                }
                // completion: nothing is open, so settling is a no-op, but
                // it is what a decoder without a live loop would have run
                if (end) settle(end);
                emitClosed();
                return DONE;
              }
              if (stopped) return DONE;
              attempts = 0; // healthy value: backoff resets
              return r;
            } catch (error) {
              // The consumer already ended the iteration (return() aborting
              // a pending pull): the rejection is our own teardown, not news.
              if (stopped) return DONE;
              // First-connect failures surface (normal call semantics); a
              // stream that had connected died — retry with backoff. The next
              // successful connect starts a NEW logical answer: value-shaped
              // sources re-yield current state on invocation by contract.
              if (!connected) throw error;
              // A caller-supplied signal (invoke) aborting ends the
              // iteration for good — surfaced as rejection like any aborted
              // call, never retried.
              if (invokeSignal && invokeSignal.aborted) {
                stopped = true;
                emitClosed(error);
                throw error;
              }
              // Definite rejections fail fast: a 4xx means the server
              // understood and refused — auth revoked, resource gone —
              // and retrying cannot change the answer. The error surfaces
              // through the consumer like a first-connect failure would.
              // Except where the status itself says the opposite: 408 (the
              // server timed the REQUEST out and invites a repeat, RFC 9110
              // §15.5.9), 425 (early data refused, retry after handshake,
              // RFC 8470) and 429 (rate limited — the one status that
              // exists to say "come back later", RFC 6585 §4) are transient
              // by definition, and usually infrastructure's answer rather
              // than the application's (#3100). A Retry-After on any status
              // is the peer inviting the retry in as many words.
              if (
                error !== null &&
                typeof error === "object" &&
                typeof error.status === "number" &&
                error.status >= 400 &&
                error.status < 500 &&
                error.status !== 408 &&
                error.status !== 425 &&
                error.status !== 429 &&
                typeof error.retryAfter !== "number"
              ) {
                stopped = true;
                emitClosed(error);
                throw error;
              }
              closeIt();
              emit("reconnecting", error);
              await new Promise(resolve => {
                wake = resolve;
                // A peer that named the wait (Retry-After) is answering the
                // question the exponential backoff guesses at — honor it,
                // capped: retrying a shade early against a misconfigured
                // header costs one more (again-named) wait, while sitting
                // out an unbounded one would end the stream in all but name.
                // The named wait doesn't consume an attempt; the backoff
                // resumes where it left off if the header disappears.
                const named =
                  error !== null &&
                  typeof error === "object" &&
                  typeof error.retryAfter === "number"
                    ? Math.min(error.retryAfter * 1000, 60000)
                    : undefined;
                timer = setTimeout(resolve, named ?? Math.min(500 * 2 ** attempts++, 10000));
                // connectivity returning wakes the sleep — no reason to sit
                // out an 8s backoff when the network just came back (typeof
                // guard: non-browser consumers have no global EventTarget)
                if (typeof addEventListener === "function")
                  addEventListener("online", resolve, { once: true });
                // an invoke signal aborting wakes it too: the next loop's
                // connect rejects immediately and the abort surfaces
                if (invokeSignal) invokeSignal.addEventListener("abort", resolve, { once: true });
              });
              clearTimeout(timer);
              if (typeof removeEventListener === "function") removeEventListener("online", wake);
              if (invokeSignal) invokeSignal.removeEventListener("abort", wake);
              timer = wake = undefined;
            }
          }
          return DONE;
        };
        return {
          next: () => pull(),
          return(value) {
            stopped = true;
            if (timer !== undefined) clearTimeout(timer);
            if (wake) wake();
            closeIt(value);
            // the iteration's controller severs the in-flight connection
            controller.abort();
            emitClosed();
            return Promise.resolve({ done: true, value });
          }
        };
      }
    };
    if (local !== undefined) iterable[LIVE_LOCAL] = local;
    return iterable;
  };
  const wrapped = (...args) => makeIterable(args);
  wrapped[SERVER_FUNCTION_METADATA] = metadata;
  wrapped[SERVER_FUNCTION_INVOKE] = makeIterable;
  wrapped.id = id;
  // lazy like the base proxy's: the endpoint may be configured after the
  // module-scope live(...) call runs
  Object.defineProperty(wrapped, "url", {
    get: () => fn.url,
    configurable: true
  });
  return wrapped;
} /**
 * Compiler ABI — only ever referenced by server-mode compiler output;
 * throws so a misconfigured build (server transform feeding a client
 * bundle) fails loudly instead of with a missing-export error. Not meant
 * for hand-written code.
 * @internal
 */
export function registerServerReference(): never;

// Only ever referenced by server-mode compiler output; present so a
// misconfigured build fails loudly instead of with a missing-export error.
export function registerServerReference() {
  throw new Error("registerServerReference must not be called in the client build");
} /**
 * Client no-op mirror of the server entry's accessor: there is never a
 * server function call in flight on the client, so this always returns
 * undefined. Present so `"use server"` modules that import it stay
 * import-stable in client builds before dead-code elimination.
 */
export function getServerFunctionInvocation(): ServerFunctionInvocation | undefined;

// Client no-op mirror of the server entry's accessor: there is never a
// server function call in flight on the client, so this answers undefined.
// Present so `"use server"` modules that import it stay import-stable in
// client builds before dead-code elimination.
export function getServerFunctionInvocation() {
  return undefined;
}
