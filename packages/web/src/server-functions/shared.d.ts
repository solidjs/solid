import { JSONCodecOptions } from "../serializer-decode.js";

export type { JSONCodecOptions };

/**
 * Configures the codec options for the server function wire format (extra
 * Seroval plugins, feature policy, depth limit). Both peers must configure
 * identical options or payloads will not round-trip. Usually called
 * indirectly through `configureServerFunctionsClient` /
 * `configureServerFunctionsServer` (their `codec` option writes through to
 * here); call it directly only from universal code configuring both sides
 * at once.
 */
export function configureServerFunctionsCodec(codec: JSONCodecOptions | undefined): void;

/**
 * The currently configured codec options (set through
 * `configureServerFunctionsCodec` or the client/server `codec` option), or
 * undefined when running on the defaults. Integrations pass this to
 * lower-level codec helpers so custom plugins configured by the app apply.
 *
 * Integration plumbing; not meant for hand-written application code.
 * @internal
 */
export function getServerFunctionsCodec(): JSONCodecOptions | undefined;

/**
 * Request header carrying the server function id (`"X-Server-Function-Id"`).
 * Integrations can read it to identify which function a request targets;
 * the id also arrives as the `id` query parameter for GET calls and no-JS
 * form posts.
 */
export const FUNCTION_HEADER: string;

/**
 * Request header carrying a per-call instance id
 * (`"X-Server-Function-Instance"`). Its presence tells the server the call
 * came through the client runtime — its absence marks a no-JS form post or
 * direct HTTP call, which receive plain responses instead of codec-encoded
 * ones.
 */
export const INSTANCE_HEADER: string;

/**
 * Response header marking a thrown server-function error
 * (`"X-Server-Function-Error"`). The client transport rejects with the
 * decoded body when it is present (unless redirect/revalidation metadata
 * marks the response as control flow). The value carries the error's
 * message — `"true"` for thrown control-flow responses and non-Error
 * values — encoded with `encodeErrorHeaderValue`, so integrations reading
 * it must pass it through `decodeErrorHeaderValue`.
 */
export const ERROR_HEADER: string;

/**
 * Encodes an error message for the `ERROR_HEADER` value. HTTP header values
 * are latin1 ByteStrings — `Headers.set` throws on code points above U+00FF
 * — so plain printable-latin1 messages ride verbatim (ASCII stays
 * byte-identical on the wire) and everything else (CJK, emoji, controls)
 * travels percent-encoded behind a marker. `decodeErrorHeaderValue`
 * round-trips the message exactly, astral-plane characters included (lone
 * surrogates are replaced with U+FFFD — they cannot survive UTF-8 anyway).
 *
 * Transport wire detail; not meant for hand-written code.
 * @internal
 */
export function encodeErrorHeaderValue(value: string): string;

/**
 * Decodes an `ERROR_HEADER` value produced by `encodeErrorHeaderValue`:
 * marked values are percent-decoded, everything else (including values from
 * peers that never encode) passes through untouched.
 *
 * Integration plumbing for readers of `ERROR_HEADER`; not meant for
 * hand-written application code.
 * @internal
 */
export function decodeErrorHeaderValue(value: string): string;

/**
 * Header driving the single-flight protocol on both legs
 * (`"X-Single-Flight"`). On the request it opts the call into data
 * collection — the transport sends it automatically on non-GET calls while
 * a flight-data consumer is subscribed (subscribing IS the opt-in). On the
 * response it marks a body carrying the standardized `SingleFlightPayload`.
 * How the data is produced (a data-only render, running route preloads,
 * anything else) and what it means is entirely the integration's business —
 * the protocol only standardizes the wire shape and the delivery.
 */
export const SINGLE_FLIGHT_HEADER: string;

/**
 * The standardized body of a single-flight response (a response tagged with
 * `SINGLE_FLIGHT_HEADER`): the function's return `value` plus the
 * integration-produced `data` payload, folded into one round trip by the
 * HTTP handler. Integrations decoding passthrough responses themselves (no
 * registered consumer) see this shape from `decodeResponse`. The top level
 * is reserved for the protocol — integration payload lives entirely under
 * `data`, which can be any codec-serializable value.
 */
export interface SingleFlightPayload<T = unknown, D = unknown> {
  /** The server function's return (or thrown) value. */
  value: T;
  /** The integration-produced data payload. */
  data: D;
}

/**
 * Envelope context delivered alongside single-flight data: the transport
 * response, whose headers carry the integration metadata (`Location` for
 * redirect-with-data, `X-Revalidate` keys) and status. The body is already
 * consumed — read `data` and `value` from the delivery, not from here.
 */
export interface FlightDataContext {
  /** The HTTP response the data arrived on (metadata only). */
  response: Response;
}

/**
 * Consumer receiving single-flight data on the client: `data` is the
 * integration-produced payload (opaque to the protocol), `context` carries
 * the envelope metadata. Async consumers are awaited before the function
 * value is returned to the caller, so caches are seeded first.
 */
export type FlightDataConsumer<D = unknown> = (
  data: D,
  context: FlightDataContext
) => void | Promise<void>;

/**
 * Registers the consumer the client transport delivers single-flight data
 * to. Subscribing is the single-flight opt-in: while a consumer is
 * registered the transport sends the request-leg `SINGLE_FLIGHT_HEADER` on
 * non-GET calls (GET reads stay plain and cacheable), asking the server's
 * collection hook to fold data into the response. When a single-flight
 * response arrives, the transport decodes the standardized
 * `{ value, data }` payload, delivers `data` (with the response as
 * envelope context — redirect location, revalidation keys), and returns
 * `value` to the caller as if the call were plain. What to do with the
 * data (seed caches, navigate, ...) is entirely the consumer's business.
 * One active consumer at a time — a later registration replaces the
 * current one; returns an unsubscribe function. With no consumer
 * registered, no header is sent and the server does no collection work;
 * responses an integration opted in manually still pass through to the
 * caller whole, exactly like other integration responses.
 */
export function subscribeFlightData<D = unknown>(consumer: FlightDataConsumer<D>): () => void;

/**
 * Name of the cookie carrying the outcome of a call made without the client
 * runtime (`"flash"`). A no-JS form post has no way to receive a value —
 * the browser follows the redirect and renders the next page — so the
 * handler stashes the outcome here for the render after it to pick up,
 * which is how a form submitted without JavaScript still shows its result.
 *
 * The name, detection and clearing are isomorphic (integrations read the
 * cookie from code that also ships to the browser); the codec that fills it
 * is server-only and lives behind the server entry.
 */
export const FLASH_COOKIE: string;

/**
 * Whether a Cookie header carries a flash cookie, readable or not. Cheap
 * enough to call on every render so the clear can be queued before the
 * response headers flush.
 */
export function hasFlashCookie(cookieHeader: string | null): boolean;

/**
 * The `Set-Cookie` value clearing the flash cookie. The outcome is
 * one-shot: append this as soon as the cookie is detected, whether or not
 * it decodes, so a stale outcome cannot resurface on a later request.
 */
export function clearFlashCookie(): string;

/**
 * The raw encoded flash payload out of a Cookie header, if present — the
 * codec's own accessor.
 *
 * @internal
 */
export function matchFlashCookie(cookieHeader: string | null): string | undefined;

/**
 * The currently registered single-flight consumer.
 *
 * Transport building block; not meant for hand-written code.
 * @internal
 */
export function getFlightDataConsumer(): FlightDataConsumer | undefined;

/**
 * The public contract of a server function reference — what a `"use
 * server"` import is at runtime on either side: an async callable plus its
 * build-stable identity.
 */
export interface ServerFunction<A extends readonly any[] = any[], T = any> {
  (...args: A): Promise<T>;
  /** The build-stable function id (stable across the client and server builds). */
  readonly id: string;
  /** URL invoking this function directly over HTTP (form `action`s, raw fetches). */
  readonly url: string;
}

/**
 * Declaration-static metadata attached to a server function reference
 * through declaration wrappers (`GET`, `withMeta`). Read it with
 * `getServerFunctionMetadata`; routers and integrations detect capability
 * from here instead of property sniffing, and `prepareRequest` receives it
 * as `context.meta`. Write through `withMeta` — later writes shallow-merge
 * over earlier ones.
 */
export interface ServerFunctionMetadata {
  /** The declared HTTP method. Undeclared references call over POST. */
  readonly method?: "GET" | "POST";
  /**
   * A human-readable label for the function, seeded by development builds
   * from the compiled function's source name (dev tooling — inspectors,
   * logs). Dev-only: production builds emit no name. Not unique and not an
   * identity key — use `id` for identity. Seeded as a default: an explicit
   * `withMeta` write wins.
   */
  readonly name?: string;
  /** User-declared transport metadata attached with `withMeta`. */
  readonly [key: string]: unknown;
}

/**
 * Reads a server function reference's declaration metadata — e.g.
 * `getServerFunctionMetadata(fn)?.method === "GET"` detects a `GET(fn)`
 * declaration. Returns undefined when `fn` is not a server function
 * reference; plain references carry an empty metadata object. Works on
 * client proxies and server-side references alike, across duplicated
 * module instances (registered-symbol brand).
 */
export function getServerFunctionMetadata(fn: unknown): ServerFunctionMetadata | undefined;

/**
 * Whether `fn` is a server function reference (a client proxy or a
 * server-side registered callable). Detection is structural — a
 * registered-symbol metadata brand — so it holds across duplicated module
 * instances and both sides of the directive boundary.
 */
export function isServerFunction(fn: unknown): fn is ServerFunction;

/**
 * Attaches user-declared transport metadata to a server function reference
 * (client proxy or server-registered callable) and returns the reference.
 * Writes ride the same channel `GET` uses: later writes shallow-merge over
 * earlier ones, and `getServerFunctionMetadata(fn)` reads the merged bag —
 * so `withMeta` composes with `GET` in either order
 * (`GET(withMeta(fn, meta))` ≡ `withMeta(GET(fn), meta)`).
 *
 * The pattern is declare-on-function, react-in-hook: metadata declared
 * here reaches `prepareRequest` as `context.meta`, letting session-dynamic
 * transport policy key on declarations instead of comparing function ids:
 *
 * ```ts
 * export const chargeCard = withMeta(async (amount: number) => {
 *   "use server";
 *   // ...
 * }, { requiresAuth: true });
 *
 * configureServerFunctionsClient({
 *   prepareRequest(init, { meta }) {
 *     if (meta?.requiresAuth) {
 *       return {
 *         ...init,
 *         headers: { ...init.headers, Authorization: `Bearer ${session.token()}` }
 *       };
 *     }
 *     return init;
 *   }
 * });
 * ```
 */
export function withMeta<F extends (...args: any[]) => any>(fn: F, meta: ServerFunctionMetadata): F;

/**
 * The registered symbol branding server function references with their
 * declaration metadata. Use the typed accessors instead.
 * @internal
 */
export const SERVER_FUNCTION_METADATA: unique symbol;

/**
 * The transport surface integrations consume through the late-bound RPC
 * seam (server-functions/registry.js) — filled by the transport halves when
 * the first server function reference is created (code that only exists in
 * a bundle when a `"use server"` function was actually compiled in), read
 * by routers so they never import the transport/codec statically.
 */
export interface ServerFunctionRPC {
  /**
   * The build's `GET` declaration wrapper (client fetch transport or
   * server in-process dispatch — see the respective entries).
   */
  GET<A extends readonly any[], R>(fn: (...args: A) => R): ServerFunction<A, Awaited<R>>;
  /**
   * `decodeResponse` bound to the configured codec: decodes a server
   * function response body the transport handed over whole (redirects,
   * revalidation). Resolves undefined for empty bodies and bodies without
   * a recognized encoding (e.g. a raw user Response).
   */
  decodeResponse<T = unknown>(response: Response): Promise<T | undefined>;
}

/**
 * Fills the RPC seam. Called by the transport halves when the first server
 * function reference is created; first write wins.
 * @internal
 */
export function provideServerFunctionRPC(rpc: ServerFunctionRPC): void;

/**
 * The registered RPC surface, or undefined when no server function exists
 * in this build's graph. Integration plumbing (routers): gate every use of
 * the transport/codec behind this read instead of importing it — an app
 * with no server functions then ships none of it, while a reference in the
 * bundle guarantees the seam is filled before integration code can hold
 * that reference (compiled output creates references at module scope).
 * @internal
 */
export function getServerFunctionRPC(): ServerFunctionRPC | undefined;

/**
 * Header carrying the body format tag (a `BodyFormat` value) —
 * `"X-Server-Function-Format"`.
 *
 * Transport wire detail; not meant for hand-written code.
 * @internal
 */
export const BODY_FORMAT_HEADER: string;

/**
 * FormData key used when a lone File is sent as the argument.
 *
 * Transport wire detail; not meant for hand-written code.
 * @internal
 */
export const FILE_FORM_KEY: string;

/**
 * Wire tags naming how a request/response body was encoded, carried in
 * `BODY_FORMAT_HEADER`.
 *
 * Transport wire detail; not meant for hand-written code.
 * @internal
 */
export const BodyFormat: {
  readonly Serialized: "0";
  readonly String: "1";
  readonly FormData: "2";
  readonly URLSearchParams: "3";
  readonly Blob: "4";
  readonly File: "5";
  readonly ArrayBuffer: "6";
  readonly Uint8Array: "7";
  /**
   * Plain `JSON.stringify` — the fast path for JSON-safe payloads on both
   * legs: argument lists on the request, results on the response.
   */
  readonly Json: "8";
};

/**
 * Transport wire detail; not meant for hand-written code.
 * @internal
 */
export type BodyFormatValue = (typeof BodyFormat)[keyof typeof BodyFormat];

/**
 * Whether a value survives a `JSON.stringify` round trip faithfully: JSON
 * primitives (finite numbers only), arrays, and plain objects. Anything
 * else — Dates, Maps, typed arrays, undefined (bare or as a property),
 * NaN, class instances, cyclic structures — needs the codec. Never throws:
 * cycles and pathological depth answer `false`. Both peers negotiate the
 * wire format with this guard: the client for argument lists, the server
 * for results.
 */
export function isJSONSafe(value: unknown): boolean;

/**
 * Picks a direct HTTP encoding (headers + BodyInit) for values that have
 * one — strings, FormData, URLSearchParams, File, Blob, ArrayBuffer,
 * Uint8Array. Returns undefined when the value needs the serializer.
 *
 * Transport building block used by the fetch transport and the HTTP
 * handler; not meant for hand-written code.
 * @internal
 */
export function getHeadersAndBody(
  body: unknown
): { headers?: Record<string, string>; body: BodyInit } | undefined;

/**
 * Decodes a Request/Response body according to its `BODY_FORMAT_HEADER`
 * tag (falling back to content-type sniffing for form posts that never saw
 * the client runtime). The inverse of `getHeadersAndBody` + the serialized
 * stream. Resolves undefined for bodies without a recognized encoding.
 *
 * Transport building block; use `decodeResponse` from integration code.
 * @internal
 */
export function extractBody(
  source: Request | Response,
  codecOptions?: JSONCodecOptions
): Promise<unknown>;

/**
 * Serializes a value as a stream of length-prefixed SerovalNode chunks.
 * Async values (promises, streams) keep the stream open until they settle,
 * so one connection carries incremental results. Codec options must match
 * the deserializing peer.
 *
 * Transport building block; not meant for hand-written code.
 * @internal
 */
export function serializeStream(
  value: unknown,
  codecOptions?: JSONCodecOptions
): ReadableStream<Uint8Array>;

/**
 * `serializeStream` drained to a string (async values fully awaited).
 *
 * Transport building block; not meant for hand-written code.
 * @internal
 */
export function serializeString(value: unknown, codecOptions?: JSONCodecOptions): Promise<string>;

/**
 * Decodes a framed chunk stream from a Request/Response body. Resolves with
 * the first chunk's value (the source value); later chunks settle the async
 * values referenced inside it as they arrive.
 *
 * Transport building block; use `decodeResponse` from integration code.
 * @internal
 */
export function deserializeStream<T = unknown>(
  source: Request | Response,
  codecOptions?: JSONCodecOptions
): Promise<T>;

/**
 * `deserializeStream` for an already-buffered string.
 *
 * Transport building block; not meant for hand-written code.
 * @internal
 */
export function deserializeString<T = unknown>(
  text: string,
  codecOptions?: JSONCodecOptions
): Promise<T>;

/**
 * Decodes a server function response body using the configured codec. This
 * is the integration-facing decoder: routers call it on responses the
 * transport hands over whole — redirects, revalidation, single-flight
 * payloads — to recover the structured value inside. Resolves undefined for
 * empty bodies and bodies without a recognized encoding (e.g. a raw user
 * Response). Renderer- and platform-neutral: safe to use from universal
 * code.
 *
 * @param response the transport response; its body is read from a clone,
 * so the original stays readable
 * @param codecOptions overrides the configured codec for this call
 */
export function decodeResponse<T = unknown>(
  response: Response,
  codecOptions?: JSONCodecOptions
): Promise<T | undefined>;

/**
 * `decodeResponse` plus the single-flight envelope split: when the response
 * carries the single-flight header the decoded `{ value, data }` payload is
 * unwrapped into `{ value, flightData }`; otherwise the decoded body (or
 * undefined for body-less responses) rides as `{ value }`. Integrations
 * that apply response metadata themselves use this so the payload shape
 * stays core's own.
 *
 * Integration plumbing; not meant for hand-written application code.
 * @internal
 */
export function decodeResponsePayload<T = unknown, D = unknown>(
  response: Response,
  codecOptions?: JSONCodecOptions
): Promise<{ value: T | undefined; flightData?: D }>;

/**
 * Frame one payload for the server-function wire: a `;0x<len32>;` length
 * prefix followed by the utf-8 data. Both transports (server-function
 * responses and frame streams) share this framing.
 *
 * Transport wire detail; not meant for hand-written code.
 * @internal
 */
export function createChunk(data: string): Uint8Array;

/**
 * Incremental decoder for `createChunk` framing over a byte stream: `next()`
 * yields one complete payload string per call (async-iterator result shape),
 * buffering partial frames internally until their length prefix is satisfied.
 *
 * Transport wire detail; not meant for hand-written code.
 * @internal
 */
export class ChunkReader {
  constructor(stream: ReadableStream<Uint8Array>);
  next(): Promise<{ done: boolean; value: string | undefined }>;
}

/**
 * The intrinsic wire address of a server-component call: the function id,
 * suffixed with a realm-stable hash of the arguments when there are any.
 * Both peers derive it independently — the server names flight regions with
 * it, the client routes them by it — so it must stay deterministic across
 * realms and releases.
 *
 * Transport wire detail; not meant for hand-written code.
 * @internal
 */
export function frameAddress(id: string, args?: readonly unknown[]): string;
