// @ts-nocheck
// Client half of the server function runtime ABI. Compiled client output
// calls `createServerReference(id)` where a server function was referenced;
// the function body never reaches this bundle. Hoisted from SolidStart's
// fns/client.ts with neutral header names and a configurable endpoint.
import { REVALIDATE_HEADER } from "../../src/response.js";
// Local bindings for the annotations below — the `export type` block only
// re-exports these names without bringing them into scope, and declaration
// emit would leave them dangling (implicit any for every consumer).
import type { ServerFunction, ServerFunctionMetadata } from "./shared.js";
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
  configureServerFunctionsCodec,
  decodeResponse,
  getFlightDataConsumer,
  getFlightDataSourceIds,
  getHeadersAndBody,
  getServerFunctionMetadata,
  isJSONSafe,
  isServerFunction,
  parseServerFunctionAddress,
  provideServerFunctionRPC,
  serverFunctionAddress,
  serverFunctionDataAddress,
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
  FLASH_COOKIE,
  INSTANCE_HEADER,
  REDIRECT_HEADER,
  SERVER_FUNCTION_INVOKE,
  SINGLE_FLIGHT_HEADER,
  UNKNOWN_HEADER,
  clearFlashCookie,
  createChunk,
  decodeErrorHeaderValue,
  decodeRedirectHeaderValue,
  decodeResponse,
  decodeResponsePayload,
  deserializeStream,
  encodeErrorHeaderValue,
  frameAddress,
  getFlightDataConsumer,
  getFlightDataSourceIds,
  getServerFunctionMetadata,
  getServerFunctionsCodec,
  hasFlashCookie,
  invoke,
  isServerFunction,
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
   * `parseServerFunctionUrl` reads the id back out for telemetry. `null`
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
   * performs. Keep the call same-origin, since a cross-origin send is
   * stamped `Sec-Fetch-Site: cross-site` and the handler's origin gate
   * refuses it, and hand back what the peer answered, unread.
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

const CALL_OBSERVERS = new Set();

function notifyCallObservers(type, id, instance, value, meta) {
  if (CALL_OBSERVERS.size === 0) return;
  const field = type === "request" ? "request" : "response";
  const time = performance.now();
  for (const observer of new Set(CALL_OBSERVERS)) {
    try {
      observer({ type, id, instance, [field]: value.clone(), meta, time });
    } catch (error) {
      console.error(error);
    }
  }
} /**
 * Observes cloned requests and responses without handling them. Subscribe
 * from devtools; do not use this to replace `prepareRequest` /
 * `responseHandler`. The server entry exports a no-op of the same name so
 * isomorphic `@solidjs/web/server-functions` imports resolve.
 */
export function observeServerFunctionCalls(
  observer: (call: ServerFunctionCall) => void
): () => void;

export function observeServerFunctionCalls(observer) {
  CALL_OBSERVERS.add(observer);
  return () => CALL_OBSERVERS.delete(observer);
} /**
 * Builds the url a reference is called at, for integrations composing action
 * urls the runtime did not render — a router turning a bound action into a
 * `<form action>` for the no-JS path. `boundArgs` must be JSON-safe: the
 * server reads them the way it reads a form post's, and that convention has
 * no codec. Resolved against the configured endpoint, so a caller does not
 * have to know where the handler is mounted. The server entry exports the
 * same function so isomorphic `@solidjs/web/server-functions` imports resolve.
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
 * when the url is not an address.
 */
export function parseServerFunctionUrl(url: string): string | null;

/** Reads the function id back out of a server-rendered action url. */
export function parseServerFunctionUrl(url) {
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

let INSTANCE = 0;

// Longest url the GET transport will build before falling back to POST.
// Every proxy, CDN and server in a request's path draws its own line — the
// lowest in common use is around 2 KB — so the transport stays under the
// smallest of them rather than discovering the limit as a 414 in production.
// Measured on the absolute url, which is what those limits apply to.
const MAX_GET_URL_LENGTH = 2000;

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
// the codec's (#3094), so the data segment is spliced in ahead of the id;
// mount, origin and the query (bound arguments) ride along untouched.
function dataAddressFor(base) {
  const splitAt = base.search(/[?#]/);
  const path = splitAt < 0 ? base : base.slice(0, splitAt);
  const rest = splitAt < 0 ? "" : base.slice(splitAt);
  const slash = path.lastIndexOf("/");
  if (path.endsWith("/data/", slash + 1)) return base; // already one
  return `${path.slice(0, slash + 1)}data/${path.slice(slash + 1)}${rest}`;
}

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

async function createRequest(base, id, instance, options, meta) {
  const headers = {
    ...options.headers,
    [INSTANCE_HEADER]: instance
  };
  // Subscribing to flight data IS the single-flight opt-in: with consumers
  // registered the transport asks the server for collection on every
  // mutation call; a consumer-less app never asks the server to do
  // collection work. The header value is the registered source ids — the
  // server runs only the collectors the client can consume; the unnamed
  // registration rides under its reserved id "true" (see
  // getFlightDataSourceIds).
  // GET-encoded calls are reads (cacheable URLs) and stay plain — folding
  // per-request flight data into them would defeat caching. `read: true`
  // marks a POST-shaped call as a read the same way (e.g. live sources:
  // streams have no envelope story and flight hooks are mutation policy).
  const flightSources = getFlightDataSourceIds();
  if (
    flightSources.length > 0 &&
    !options.read &&
    (!options.method || options.method.toUpperCase() !== "GET")
  ) {
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
    init = (await config.prepareRequest(init, { id, meta })) || init;
  }
  const send = config.fetch || fetch;
  if (CALL_OBSERVERS.size === 0) return send(base, init);

  // The send keeps the `(address, init)` shape it has on the path without
  // observers — whether devtools are attached is not something a configured
  // `fetch` should have to branch on — so what observers receive is a
  // reconstruction of the dispatched request, not the object itself — built
  // without a streaming body, which reconstructing would consume before the
  // send could use it.
  const request = new Request(new URL(base, globalThis.location?.href || "http://localhost"), {
    ...init,
    body: init.body instanceof ReadableStream ? undefined : init.body
  });
  notifyCallObservers("request", id, instance, request, meta);
  const response = await send(base, init);
  notifyCallObservers("response", id, instance, response, meta);
  return response;
}

async function initializeResponse(base, id, instance, options, args, meta) {
  // No args, skip serialization
  if (args.length === 0) {
    return createRequest(base, id, instance, options, meta);
  }
  // A single argument with a natural HTTP encoding goes as-is
  if (args.length === 1) {
    const result = getHeadersAndBody(args[0]);
    if (result) {
      return createRequest(
        base,
        id,
        instance,
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
        instance,
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
  // null exactly as it does in a rendered action url (JSON has none).
  if (args.length > 1) {
    try {
      const trailing = getHeadersAndBody(args[args.length - 1]);
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
          instance,
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
    instance,
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
async function fetchServerFunction(base, id, options, args, meta, callArgs = args) {
  const instance = `server-function:${INSTANCE++}`;
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

  const response = await initializeResponse(base, id, instance, options, args, meta);

  // The integration seam sees the response first: a handler that claims it
  // (returns non-undefined) owns the call's result.
  if (handler) {
    const handled = handler.handle(response, { id, meta, args: callArgs, context });
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

  // Single-flight responses: with a registered consumer the transport owns
  // the unwrap — the standardized `{ value, data }` body is decoded, the
  // data is delivered (with the response as envelope context: redirect
  // location, revalidation keys, status), and `value` returns to the
  // caller as if the call were plain. The response header names the folded
  // sources; `data` is the keyed envelope and each slice goes to its
  // source's consumer (the unnamed one subscribes under the reserved id
  // "true"). Error semantics mirror the passthrough path below: responses
  // carrying integration metadata (the redirect carrier/X-Revalidate) are
  // control flow for the consumer to interpret, bare error-tagged ones
  // throw the value.
  if (response.headers.has(SINGLE_FLIGHT_HEADER)) {
    const folded = response.headers.get(SINGLE_FLIGHT_HEADER).split(",");
    const consumers = folded
      .map(source => [source, getFlightDataConsumer(source)])
      .filter(([, consumer]) => consumer);
    if (consumers.length > 0) {
      const payload = await decodeResponse(response);
      // Sequential, awaited delivery: caches are seeded before the caller
      // sees the value, whichever source they subscribe through.
      for (const [source, consumer] of consumers) {
        await consumer(payload.data[source], { response });
      }
      if (
        failed &&
        !response.headers.has(REDIRECT_HEADER) &&
        !response.headers.has(REVALIDATE_HEADER)
      ) {
        throw serverFunctionFailure(response, payload.value);
      }
      return payload.value;
    }
  }

  // Responses the caller's integration needs to see whole (redirects,
  // revalidation, single-flight payloads without a registered consumer)
  // pass through untouched — the integration decodes the body itself with
  // `decodeResponse`. The runtime's redirects ride REDIRECT_HEADER (#3102;
  // an authored `Location` on a forwarding status like 201 is data, not
  // control flow, and decodes normally). A real 3xx status is a peer's
  // control flow: fetch follows the followable set before the transport
  // sees it, so one only arrives where something opted out of following —
  // except 304, which is the answer to a conditional read, not navigation.
  if (
    response.headers.has(REDIRECT_HEADER) ||
    response.headers.has(REVALIDATE_HEADER) ||
    response.headers.has(SINGLE_FLIGHT_HEADER) ||
    (response.status >= 300 && response.status < 400 && response.status !== 304)
  ) {
    return response;
  }

  const result = await decodeResponse(response.clone());
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
    const handler = config.responseHandler;
    if (handler && handler.intercept) {
      const hit = handler.intercept({ id, meta: metadata, args });
      if (hit !== undefined) return hit;
    }
    return fetchServerFunction(
      base ? dataAddressFor(base) : serverFunctionDataAddress(config.endpoint, id),
      id,
      invokeOptions ? { ...invokeOptions } : {},
      args,
      metadata
    );
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
    if (handler && handler.intercept) {
      const hit = handler.intercept({ id, meta: metadata, args });
      if (hit !== undefined) return hit;
    }
    const opts = invokeOptions || {};
    const address = serverFunctionDataAddress(config.endpoint, id);
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
} /**
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
export function live(fn) {
  if (!isServerFunction(fn)) {
    throw new Error("live expects a server function reference");
  }
  const id = fn.id;
  const metadata = { ...getServerFunctionMetadata(fn), live: true };
  const makeIterable = (args, invokeOptions) => {
    const iterable = {
      [LIVE_SOURCE]: true,
      [Symbol.asyncIterator]() {
        let it; // current underlying iterator (undefined between connections)
        let connected = false; // a connect succeeded once — later deaths reconnect
        let attempts = 0;
        let stopped = false;
        let ended = false; // "closed" fires exactly once per iteration
        let timer, wake; // interruptible backoff sleep
        const DONE = { done: true, value: undefined };
        // The iteration owns a controller so ending consumption (`break`)
        // severs the wire; a caller-supplied signal (invoke) rides alongside
        // through AbortSignal.any — either ends the iteration, and because
        // the combined signal reaches every (re)connect's fetch, an abort
        // cancels the CURRENT connection whichever attempt it is.
        const invokeSignal = invokeOptions && invokeOptions.signal;
        const controller = new AbortController();
        const wireOptions = {
          ...invokeOptions,
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
        const emitClosed = error => {
          if (ended) return;
          ended = true;
          emit("closed", error);
        };
        const closeIt = value => {
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
          // channel so the wire options (the combined signal included) reach
          // its fetch. Otherwise call the transport directly so the POST is
          // marked a read: live responses are streams, which have no
          // single-flight envelope story (and flight collection is mutation
          // policy).
          if (metadata.method === "GET") return fn[SERVER_FUNCTION_INVOKE](args, wireOptions);
          const handler = config.responseHandler;
          if (handler && handler.intercept) {
            const hit = handler.intercept({ id, meta: metadata, args });
            if (hit !== undefined) return hit;
          }
          return fetchServerFunction(
            fn.url,
            id,
            { ...wireOptions, read: true },
            args,
            metadata,
            args
          );
        };
        const pull = async () => {
          while (!stopped) {
            try {
              if (!it) {
                const result = await callOnce();
                connected = true;
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
                emit("connected");
              }
              const r = await it.next();
              if (r.done) {
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
              it = undefined;
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
