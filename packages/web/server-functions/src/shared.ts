// @ts-nocheck
// Shared half of the server function transport: the pieces both peers must
// agree on byte-for-byte. Hoisted from SolidStart's fns/shared.ts and
// fns/serialization.ts with neutral header names.
//
// Two layers live here:
// - body negotiation: single arguments with a natural HTTP encoding (string,
//   FormData, Blob, ...) skip the serializer entirely, and JSON-safe values
//   ride plain JSON; everything else goes through the JSON codec from
//   ../serializer.js.
// - chunk framing: length-prefixed chunks so the receiver knows how much to
//   buffer before parsing, which lets async values (promises, streams)
//   arrive incrementally on one connection.

// The codec loads on demand, the moment a Serialized body actually has to
// be encoded or decoded — never at module scope. This module is in the
// eager graph of every bundle containing a server function reference (the
// transport imports it for headers and framing), and a static serializer
// import made every such bundle ship seroval + the web plugin set
// (~5.5 KB gz) even when all its calls carry JSON-safe data and the peer
// answers in kind (the server's JSON fast path in server.js). Plain-data
// apps never resolve the import; the first rich value — a Date result, a
// stream, a typed error — pulls the codec in one fetch and it stays
// (import() is cached per specifier, so there is deliberately no memo
// variable here — and the bare `await import` + immediate destructure at
// each use site is what lets the consumer's bundler tree-shake the lazy
// chunk down to the codec halves actually reached, instead of retaining
// the whole serializer surface behind an opaque namespace). Bundlers split
// the import into its own chunk; solid-web's packaging resolves it to the
// public `@solidjs/web/serialization` entry, the same instance custom
// codec plugins are authored against.

// The codec-free universal pieces moved out to their own layers so a
// router's eager graph can read them without this module (whose serializer
// import IS the codec): the declaration-metadata channel and the late-bound
// RPC seam live in registry.js, the flash cookie's isomorphic half beside
// the cookie codec in ../cookies.js. Re-exported here so every existing
// import site of the shared wire layer keeps working.
export {
  LIVE_SOURCE,
  SERVER_FUNCTION_METADATA,
  getServerFunctionMetadata,
  getServerFunctionRPC,
  isServerFunction,
  provideServerFunctionRPC,
  withMeta
} from "./registry.js";
export {
  FLASH_COOKIE,
  clearFlashCookie,
  hasFlashCookie,
  matchFlashCookie
} from "../../src/cookies.js";

import { JSONCodecOptions } from "../../serialization/src/serializer-decode.js";

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
 * Transport wire detail; not meant for hand-written code.
 * @internal
 */
export type BodyFormatValue = (typeof BodyFormat)[keyof typeof BodyFormat];

// Codec options must match across peers, and decoding happens in more
// places than the fetch transport (routers decode integration responses
// themselves), so the config lives here in the universal layer — the
// client/server modules write through to it.
const codecConfig = { codec: undefined }; /**
 * Configures the codec options for the server function wire format (extra
 * Seroval plugins, feature policy, depth limit). Both peers must configure
 * identical options or payloads will not round-trip. Usually called
 * indirectly through `configureServerFunctionsClient` /
 * `configureServerFunctionsServer` (their `codec` option writes through to
 * here); call it directly only from universal code configuring both sides
 * at once.
 */
export function configureServerFunctionsCodec(codec: JSONCodecOptions | undefined): void;

/** Configures the codec options (extra plugins etc. — must match the peer). */
export function configureServerFunctionsCodec(codec) {
  codecConfig.codec = codec;
} /**
 * The currently configured codec options (set through
 * `configureServerFunctionsCodec` or the client/server `codec` option), or
 * undefined when running on the defaults. Integrations pass this to
 * lower-level codec helpers so custom plugins configured by the app apply.
 *
 * Integration plumbing; not meant for hand-written application code.
 * @internal
 */
export function getServerFunctionsCodec(): JSONCodecOptions | undefined;

/** The currently configured codec options. */
export function getServerFunctionsCodec() {
  return codecConfig.codec;
}

// The single-flight consumer also lives in the universal layer: routers are
// universal code, so the registration must be importable from any build
// (the server side simply never delivers to it).
const flightConfig = { consumer: undefined }; /**
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
 * Registers the consumer the client transport delivers single-flight data
 * to: `consumer(data, { response })` — the integration-produced payload
 * plus the response as envelope context (redirect location, revalidation
 * keys, status). What the data means and what to do with it (seed caches,
 * navigate, ...) is entirely the consumer's business. One active consumer
 * at a time (a later registration replaces the current one); returns an
 * unsubscribe function. With no consumer registered, single-flight
 * responses pass through to the caller whole, exactly like other
 * integration responses.
 */
export function subscribeFlightData(consumer) {
  flightConfig.consumer = consumer;
  return () => {
    if (flightConfig.consumer === consumer) flightConfig.consumer = undefined;
  };
} /**
 * The currently registered single-flight consumer.
 *
 * Transport building block; not meant for hand-written code.
 * @internal
 */
export function getFlightDataConsumer(): FlightDataConsumer | undefined;

/** The currently registered single-flight consumer. */
export function getFlightDataConsumer() {
  return flightConfig.consumer;
} /**
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

/**
 * The wire address of a server-component call: its function id and the
 * arguments it was called with.
 *
 * A mutation answering with fresh markup for something it invalidated has to
 * name the region it is replacing, and both peers have to arrive at the same
 * name independently — the client never told the server which boundaries it
 * is showing. A call's identity is the one thing they always share: the
 * client dispatched `(id, args)` and the server's collection pass calls
 * `(id, args)` again. So the protocol derives the address itself rather than
 * asking an integration to declare one, and a cache-backed router gets this
 * without writing anything.
 *
 * This is an ADDRESS, not a boundary identity: which DOM boundary is
 * currently showing a given call is a client-side lookup (see
 * `createServerComponentHandler`), so a call site whose arguments change
 * still morphs in place instead of remounting.
 */
export function frameAddress(id, args) {
  return args && args.length ? id + ":" + hashArguments(args) : id;
}

// A structural digest, stable across peers: key order is normalized so two
// equal argument lists always agree, and anything the codec would have to
// think about (class instances, cycles) degrades to its shape rather than
// throwing. Collisions cost a mis-routed region, not correctness — an
// unaddressed region simply finds no boundary.
function hashArguments(args) {
  let hash = 0;
  const text = stableString(args);
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return (hash >>> 0).toString(36);
}

function stableString(value, seen) {
  if (value === null || typeof value !== "object") {
    return typeof value === "bigint" ? value + "n" : String(value);
  }
  // Realm-stable forms for the codec's rich argument types: `String(value)`
  // for these is implementation-defined (a Date stringifies with the local
  // timezone, differently in Node and a browser) and the two peers hash
  // INDEPENDENTLY — the client from the args it dispatched, the server from
  // the args its collection pass calls with. A digest that diverges routes
  // the region nowhere, which degrades to a refetch invisibly.
  if (value instanceof Date) return "Date:" + value.getTime();
  seen || (seen = new Set());
  if (seen.has(value)) return "~";
  seen.add(value);
  if (value instanceof Map) {
    const entries = [];
    for (const [k, v] of value) {
      entries.push(stableString(k, seen) + "=>" + stableString(v, seen));
    }
    return "Map{" + entries.sort().join(",") + "}";
  }
  if (value instanceof Set) {
    const members = [];
    for (const v of value) members.push(stableString(v, seen));
    return "Set{" + members.sort().join(",") + "}";
  }
  if (Array.isArray(value)) {
    let out = "[";
    for (let i = 0; i < value.length; i++) out += (i ? "," : "") + stableString(value[i], seen);
    return out + "]";
  }
  const keys = Object.keys(value).sort();
  let out = "{";
  for (let i = 0; i < keys.length; i++) {
    out += (i ? "," : "") + keys[i] + ":" + stableString(value[keys[i]], seen);
  }
  return out + "}";
}

/** Header carrying the server function id. */
export const FUNCTION_HEADER = "X-Server-Function-Id";

/**
 * Response header marking a thrown server-function error. The value is the
 * error's message (the structured error itself travels in the body); `"true"`
 * for thrown control-flow responses and non-Error values.
 */
export const ERROR_HEADER = "X-Server-Function-Error";

// HTTP header values are ByteStrings (latin1): Headers.set throws on code
// points above U+00FF (or corrupts them, per platform), which used to turn a
// thrown error with a CJK/emoji message into a bare 500 with nothing for the
// client to decode (solidjs/solid-start#1874). Messages that cannot ride a
// header verbatim travel percent-encoded behind this marker; verbatim
// messages that happen to start with the marker are encoded too, so
// `decodeErrorHeaderValue(encodeErrorHeaderValue(x)) === x` exactly —
// astral-plane characters included.
const ERROR_HEADER_MARKER = "=?1?";
// Anything outside printable latin1 (controls, DEL, > U+00FF) forces the
// encoded form; CR/LF never survive (header injection) and are stripped
// before the check, matching SolidStart's original `toHeaderValue` guard.
const NEEDS_ENCODING = /[^\x20-\x7e\xa0-\xff]/; /**
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
 * Encodes an error message for the `ERROR_HEADER` value: plain printable
 * latin1 rides verbatim (the fast path — ASCII messages are byte-identical
 * on the wire), everything else is percent-encoded behind a marker.
 */
export function encodeErrorHeaderValue(value) {
  let stripped = String(value).replace(/[\r\n]+/g, "");
  // leading/trailing whitespace would be trimmed by Headers.set
  if (
    !NEEDS_ENCODING.test(stripped) &&
    !stripped.startsWith(ERROR_HEADER_MARKER) &&
    stripped === stripped.trim()
  ) {
    return stripped;
  }
  // encodeURIComponent throws on lone surrogates; well-form first (they
  // cannot round-trip through UTF-8 anywhere in the protocol anyway)
  if (typeof stripped.toWellFormed === "function") {
    stripped = stripped.toWellFormed();
  } else {
    stripped = stripped.replace(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
      "\uFFFD"
    );
  }
  return ERROR_HEADER_MARKER + encodeURIComponent(stripped);
} /**
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
 * Decodes an `ERROR_HEADER` value produced by `encodeErrorHeaderValue`:
 * marked values are percent-decoded, everything else passes through
 * (including values from peers that never encode).
 */
export function decodeErrorHeaderValue(value) {
  if (typeof value !== "string" || !value.startsWith(ERROR_HEADER_MARKER)) {
    return value;
  }
  try {
    return decodeURIComponent(value.slice(ERROR_HEADER_MARKER.length));
  } catch {
    // not produced by our encoder after all — hand it over untouched
    return value;
  }
}

/**
 * Header carrying a per-call instance id. Its presence tells the server a
 * scripted client is on the other end (vs. a no-JS form post).
 */
export const INSTANCE_HEADER = "X-Server-Function-Instance";

/** Header carrying the body format tag (a `BodyFormat` value). */
export const BODY_FORMAT_HEADER = "X-Server-Function-Format";

/**
 * Header driving the single-flight protocol on both legs: on the request it
 * opts the call into flight-data collection (the integration sends it on
 * calls whose response should fold in data), on the response it marks a
 * body carrying the standardized `{ value, data }` payload. How the data
 * is produced (and what it means) is entirely the integration's business —
 * core only owns the wire shape and the delivery.
 */
export const SINGLE_FLIGHT_HEADER = "X-Single-Flight";

/** FormData key used when a lone File is sent as the argument. */
export const FILE_FORM_KEY = "__server_function_file__";

export const BodyFormat = {
  Serialized: "0",
  String: "1",
  FormData: "2",
  URLSearchParams: "3",
  Blob: "4",
  File: "5",
  ArrayBuffer: "6",
  Uint8Array: "7",
  /**
   * Plain `JSON.stringify` — the fast path for JSON-safe payloads on both
   * legs: argument lists on the request, results (single-flight envelopes
   * included) on the response.
   */
  Json: "8"
};

// Nesting deeper than this is not JSON-safe. The guard itself walks an
// explicit stack so any depth is CHECKABLE, but claiming safety means
// JSON.stringify must then deliver. Stringify is recursive and the cliff
// is engine-dependent: Node 24.19 (CI) overflows around 5900 nested
// objects on the default V8 stack; Node 26 still clears 10k. The ceiling
// sits below the Node 24 cliff with headroom for heavier frames / linux
// x64 CI. Past it the value goes to the codec, whose own depth limit
// produces a structured error instead of a RangeError that dispatch
// would misread as the function failing.
const JSON_SAFE_DEPTH_LIMIT = 4096;

// Sentinel frame on the traversal stack: "all children of the entry below
// are done — pop it from the ancestor path". Module-private, so it can
// never collide with user data.
const EXIT = {}; /**
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
 * Whether a value survives a `JSON.stringify` round trip faithfully: JSON
 * primitives (finite numbers only), arrays, and plain objects. Anything
 * else — Dates, Maps, typed arrays, undefined (bare or as a property),
 * NaN, class instances, cyclic structures — needs the codec. Both peers
 * negotiate with this same guard: the client for argument lists (see
 * client.js), the server for results (see server.js encodeResult) — so
 * the codec rides the wire exactly when a value actually needs it.
 *
 * Traversal is iterative on an explicit stack with an ancestor set: the
 * old recursive walk overflowed on cycles (forever) and on deep nesting
 * stringify itself handles on a given engine, and that RangeError escaped
 * into dispatch's catch as a phantom function error. Cycle detection is
 * ancestor-based on purpose: a value referenced twice WITHOUT a cycle is
 * still JSON-safe (stringify duplicates it, as the fast path always has)
 * — a seen-forever set would start waking the codec for plain data that
 * merely aliases.
 */
export function isJSONSafe(value) {
  const stack = [value];
  const ancestors = new Set();
  while (stack.length) {
    const v = stack.pop();
    if (v === EXIT) {
      ancestors.delete(stack.pop());
      continue;
    }
    if (v === null) continue;
    const t = typeof v;
    if (t === "string" || t === "boolean") continue;
    if (t === "number") {
      if (!Number.isFinite(v)) return false;
      continue;
    }
    if (t !== "object") return false;
    // a value on its own ancestor path is a cycle — JSON.stringify throws
    if (ancestors.has(v) || ancestors.size >= JSON_SAFE_DEPTH_LIMIT) return false;
    ancestors.add(v);
    stack.push(v, EXIT);
    if (Array.isArray(v)) {
      // index iteration on purpose: a sparse array's holes read undefined
      // (unsafe — stringify corrupts them to null), which for-in would skip
      for (let i = 0; i < v.length; i++) stack.push(v[i]);
    } else {
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) return false;
      // A plain object carrying an iteration protocol is NOT its enumerable
      // keys: stringify would drop the symbol-keyed method and ship `{}`,
      // silently losing the stream (async generators dodge this branch only
      // by prototype). Such values must ride the codec.
      if (Symbol.asyncIterator in v || Symbol.iterator in v) return false;
      for (const k in v) stack.push(v[k]);
    }
  }
  return true;
} /**
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
 * Picks a direct HTTP encoding for values that have one. Returns undefined
 * when the value needs the serializer (the caller then uses the codec).
 */
export function getHeadersAndBody(body) {
  switch (true) {
    case typeof body === "string":
      return {
        headers: {
          "Content-Type": "text/plain",
          [BODY_FORMAT_HEADER]: BodyFormat.String
        },
        body
      };
    case body instanceof FormData:
      return {
        headers: {
          [BODY_FORMAT_HEADER]: BodyFormat.FormData
        },
        body
      };
    case body instanceof URLSearchParams:
      return {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          [BODY_FORMAT_HEADER]: BodyFormat.URLSearchParams
        },
        body
      };
    case typeof File !== "undefined" && body instanceof File: {
      const formData = new FormData();
      formData.append(FILE_FORM_KEY, body, body.name);
      return {
        headers: {
          [BODY_FORMAT_HEADER]: BodyFormat.File
        },
        body: formData
      };
    }
    case body instanceof Blob:
      return {
        headers: {
          [BODY_FORMAT_HEADER]: BodyFormat.Blob
        },
        body
      };
    case body instanceof ArrayBuffer:
      return {
        headers: {
          [BODY_FORMAT_HEADER]: BodyFormat.ArrayBuffer
        },
        body
      };
    case body instanceof Uint8Array:
      return {
        headers: {
          [BODY_FORMAT_HEADER]: BodyFormat.Uint8Array
        },
        body: new Uint8Array(body)
      };
    default:
      return undefined;
  }
} /**
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
 * Decodes a Request/Response body according to its format tag (falling back
 * to content-type sniffing for form posts that never saw the client
 * runtime). The inverse of `getHeadersAndBody` + the serialized stream.
 */
export async function extractBody(source, codecOptions) {
  const contentType = source.headers.get("content-type");
  const format = source.headers.get(BODY_FORMAT_HEADER);
  const clone = source.clone();

  switch (true) {
    case format === BodyFormat.Serialized:
      return await deserializeStream(clone, codecOptions);
    case format === BodyFormat.Json:
      return JSON.parse(await clone.text());
    case format === BodyFormat.String:
      return await clone.text();
    case format === BodyFormat.File: {
      const formData = await clone.formData();
      return formData.get(FILE_FORM_KEY);
    }
    case format === BodyFormat.FormData:
    case contentType && contentType.startsWith("multipart/form-data"):
      return await clone.formData();
    case format === BodyFormat.URLSearchParams:
    case contentType && contentType.startsWith("application/x-www-form-urlencoded"):
      return new URLSearchParams(await clone.text());
    case format === BodyFormat.Blob:
      return await clone.blob();
    case format === BodyFormat.ArrayBuffer:
      return await clone.arrayBuffer();
    case format === BodyFormat.Uint8Array:
      return new Uint8Array(await clone.arrayBuffer());
  }

  return undefined;
} /**
 * Frame one payload for the server-function wire: a `;0x<len32>;` length
 * prefix followed by the utf-8 data. Both transports (server-function
 * responses and frame streams) share this framing.
 *
 * Transport wire detail; not meant for hand-written code.
 * @internal
 */
export function createChunk(data: string): Uint8Array;

/*
 * Chunk framing (originally by Alexis):
 *
 * A "chunk" is a piece of data emitted by the streaming serializer.
 * Each chunk is a 12-byte header — `;0x` + 32-bit byte length in hex + `;` —
 * followed by the UTF-8 encoded payload. The length prefix tells the reader
 * how much data to buffer before parsing, so multiple chunks (async values
 * resolving over time) can share one connection.
 */
// Exported for other framed transports over the same wire convention (frame
// streams frame their chunks identically — see frame-transport.js) so there
// is exactly one framing implementation.
export function createChunk(data) {
  const encoder = new TextEncoder();
  const encodeData = encoder.encode(data);
  const bytes = encodeData.length;
  const chunk = new Uint8Array(12 + bytes);
  chunk.set(encoder.encode(`;0x${bytes.toString(16).padStart(8, "0")};`)); // 32-bit
  chunk.set(encodeData, 12);
  return chunk;
}

export class ChunkReader {
  constructor(stream) {
    this.reader = stream.getReader();
    this.buffer = new Uint8Array(0);
    this.done = false;
  }

  async readChunk() {
    const chunk = await this.reader.read();
    if (!chunk.done) {
      const newBuffer = new Uint8Array(this.buffer.length + chunk.value.length);
      newBuffer.set(this.buffer);
      newBuffer.set(chunk.value, this.buffer.length);
      this.buffer = newBuffer;
    } else {
      this.done = true;
    }
  }

  async next() {
    // A network read boundary can land anywhere — inside the 12-byte header
    // just as easily as inside a payload — so buffer until the whole header
    // is present before parsing it. Parsing a truncated header used to
    // mis-read the length (or throw) whenever a proxy/TLS record split a
    // frame, which no localhost test ever produces.
    while (this.buffer.length < 12) {
      if (this.done) {
        if (this.buffer.length === 0) return { done: true, value: undefined };
        throw new Error("Malformed server function stream.");
      }
      await this.readChunk();
    }
    // `;0x00000000;` — the hex length names how many payload bytes to wait for
    const decoder = new TextDecoder();
    const bytes = Number.parseInt(decoder.decode(this.buffer.subarray(1, 11)), 16);
    if (Number.isNaN(bytes)) {
      throw new Error("Malformed server function stream.");
    }
    while (bytes > this.buffer.length - 12) {
      if (this.done) {
        throw new Error("Malformed server function stream.");
      }
      await this.readChunk();
    }
    const partial = decoder.decode(this.buffer.subarray(12, 12 + bytes));
    this.buffer = this.buffer.subarray(12 + bytes);
    return { done: false, value: partial };
  }

  async drain(interpret) {
    while (true) {
      const result = await this.next();
      if (result.done) {
        break;
      }
      interpret(result.value);
    }
  }
} /**
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
 * Serializes a value as a stream of framed SerovalNode chunks. Async values
 * keep the stream open until they settle. Codec options (plugins, feature
 * policy, depth limit) must match the deserializing peer.
 *
 * Deliberately teardown-free: this half is re-exported into CLIENT bundles
 * (rich-args upload, serializeString), where request-lifetime plumbing is
 * dead weight. The server response path — the only place a consumer can
 * disconnect from a still-producing stream — uses the hardened variant in
 * server.js.
 */
export function serializeStream(value, codecOptions) {
  return new ReadableStream({
    // async on purpose: the codec is late-loaded (see the loading notes at
    // the top of this module), and a ReadableStream start may return a
    // promise — reads wait for it, so the stream's contract is unchanged
    async start(controller) {
      const { serializeJSON } = await import("../../serialization/src/serializer.js");
      serializeJSON(value, {
        ...codecOptions,
        onParse(node) {
          controller.enqueue(createChunk(JSON.stringify(node)));
        },
        onDone() {
          controller.close();
        },
        onError(error) {
          controller.error(error);
        }
      });
    }
  });
} /**
 * `serializeStream` drained to a string (async values fully awaited).
 *
 * Transport building block; not meant for hand-written code.
 * @internal
 */
export function serializeString(value: unknown, codecOptions?: JSONCodecOptions): Promise<string>;

/** `serializeStream` drained to a string (async values fully awaited). */
export async function serializeString(value, codecOptions) {
  const response = new Response(serializeStream(value, codecOptions));
  return await response.text();
} /**
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
 * Decodes a framed stream from a Request/Response body. Resolves with the
 * first chunk's value (the source value); later chunks settle the async
 * values referenced inside it.
 */
export async function deserializeStream(source, codecOptions) {
  if (!source.body) {
    throw new Error("missing body");
  }
  const reader = new ChunkReader(source.body);
  const result = await reader.next();
  if (!result.done) {
    // The codec's decode half loads here — when a Serialized body has
    // actually arrived — so a client whose responses all ride the JSON fast
    // path never pays for it (see the loading notes at the top). The
    // decode-only module: reading a payload never needs the encode half
    // (that loads separately, when rich arguments serialize).
    const { createJSONDeserializer } = await import("../../serialization/src/serializer-decode.js");
    // Cross-references between chunks resolve through state inside the
    // deserializer, so one instance handles the whole stream.
    const deserializeChunk = createJSONDeserializer(codecOptions);

    function interpretChunk(chunk) {
      return deserializeChunk(JSON.parse(chunk));
    }

    // Failure wiring for the drain: a network drop or malformed frame must
    // fail every value still waiting on later chunks — otherwise their
    // promises hang forever and open streams never terminate (and the drain
    // rejection itself goes unhandled). Normal completion runs the same
    // sweep: on a well-formed stream every value has already settled and the
    // sweep no-ops, while a truncation that lands exactly on a frame
    // boundary — indistinguishable from completion — leaves stranded values
    // that can never settle once the body is done.
    reader.drain(interpretChunk).then(
      () => deserializeChunk.abort(new Error("Server function stream ended unexpectedly.")),
      error => deserializeChunk.abort(error)
    );

    return interpretChunk(result.value);
  }
  return undefined;
} /**
 * `deserializeStream` for an already-buffered string.
 *
 * Transport building block; not meant for hand-written code.
 * @internal
 */
export function deserializeString<T = unknown>(
  text: string,
  codecOptions?: JSONCodecOptions
): Promise<T>;

/** `deserializeStream` for an already-buffered string. */
export async function deserializeString(text, codecOptions) {
  return await deserializeStream(new Response(text), codecOptions);
} /**
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
 * Decodes a server function response body using the configured codec.
 * Integrations (routers) call this on responses the transport hands over
 * whole — redirects, revalidation, single-flight payloads. Renderer- and
 * platform-neutral: safe to use from universal code.
 */
export async function decodeResponse(response, codecOptions) {
  if (!response.body) return undefined;
  return await extractBody(response, codecOptions === undefined ? codecConfig.codec : codecOptions);
} /**
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
 * `decodeResponse` plus the single-flight envelope split: when the response
 * carries the single-flight header the decoded `{ value, data }` payload is
 * unwrapped into `{ value, flightData }`; otherwise the decoded body (or
 * undefined for body-less responses) rides as `{ value }`. Integrations
 * that apply response metadata themselves use this so the payload shape
 * stays core's own.
 */
export async function decodeResponsePayload(response, codecOptions) {
  const decoded = await decodeResponse(response, codecOptions);
  if (decoded !== undefined && response.headers.has(SINGLE_FLIGHT_HEADER)) {
    return { value: decoded.value, flightData: decoded.data };
  }
  return { value: decoded };
}
