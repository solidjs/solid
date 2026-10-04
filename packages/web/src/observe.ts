// This runtime's records on `OBSERVE.records` (see `Records` in
// @solidjs/signals): the TYPES of every record `@solidjs/web` emits, on
// either platform, and the emitters for the client's — the `"request"` and
// `"call"` records (a server-function call made from the browser: the
// request left; the call settled) and the client half of the `"frame"`
// record (a frame stream applied). The server's emitters — the
// `"invocation"` and `"render"` records and the frame's server half — are
// in server-observe.ts, which needs the server runtime; this module needs
// nothing of either platform's runtime, so every entry bundles it.
//
// The channel is reached by its REGISTERED SYMBOL, not by importing
// `solid-js`: the server-function client is the wire layer, bundled without
// a framework import (a router or a non-Solid caller can use it), and the
// core registers the channel on `globalThis` for exactly this — a reach
// with no import, and the same object from every copy of the core. The
// object is `OBSERVE.records` itself; `undefined` wherever the core is not
// an observing tier.
//
// Everything here folds out of the prod artifacts behind the
// `"_SOLID_OBSERVE_"` literal (replaced per build, like the `_SOLID_DEV_`
// gates): prod never reaches for the channel.
import type { ChangeOrigin, Records } from "solid-js";
import type { RequestEvent } from "./server.js";
import type { TraceContext } from "./trace.js";

// Replaced per build; a module const (not an inline literal) so the typed
// gates below read as booleans (cookies.ts uses the same shape).
const IS_OBSERVE = "_SOLID_OBSERVE_" as unknown as boolean;

const RECORDS = Symbol.for("@solidjs/signals/observe/records");
const ATTRIBUTION = Symbol.for("@solidjs/signals/observe/attribution");

/**
 * The one method this runtime calls on the engine registered under
 * `ATTRIBUTION` — the same `currentOrigin` `OBSERVE.attribution` exposes.
 * Typed structurally: the engine's hook table is the core's internal
 * contract, and the registered name is the contract here.
 */
interface OriginSource {
  currentOrigin(): ChangeOrigin | undefined;
}

/**
 * The records channel — `OBSERVE.records` — or `undefined` outside observe
 * builds and where no observing core has loaded. An emitter's first check.
 */
export function records(): Records | undefined {
  if (!IS_OBSERVE) return undefined;
  return (globalThis as { [RECORDS]?: Records })[RECORDS];
}

/**
 * The provenance to stamp a record made right now with — the interaction
 * whose handler is running, the navigation whose data is loading — as the
 * installed attribution engine sees it (`OBSERVE.attribution.currentOrigin`,
 * reached by the engine's registered symbol for the same reason the channel
 * is); `undefined` with no engine, or when nothing is in effect.
 */
function currentOrigin(): ChangeOrigin | undefined {
  // Gated like `records()`: the literal folds the reach (and the registered
  // name with it) out of prod, where the emitter that calls this is dead.
  if (!IS_OBSERVE) return undefined;
  const hooks = (globalThis as { [ATTRIBUTION]?: OriginSource })[ATTRIBUTION];
  return hooks === undefined ? undefined : hooks.currentOrigin();
}

// --- "invocation": a server-function execution, on the server ----------------

/**
 * One server function execution, delivered on
 * `OBSERVE.records.subscribe("invocation", …)` once it settled.
 * Serializable — the live handles (`event`, `args`, the thrown error)
 * travel beside it in `InvocationLive`, not on it.
 */
export interface InvocationEvent {
  /** The function id — the name a span or a log line carries. */
  id: string;
  /** `true` for an in-process call during SSR, `false` for HTTP dispatch. */
  direct: boolean;
  /** `performance.now()` when the execution started. */
  at: number;
  /**
   * Start → settle of the execution, in milliseconds. The execution is the
   * `wrapInvocation`-wrapped run: what the request spent on the call,
   * policy included (auth guards, per-function middleware). A generator or
   * stream body settles at handoff — see `deferred`.
   */
  durationMs: number;
  outcome: "ok" | "error";
  /**
   * The settled value is a body the caller drives — a generator, a
   * `ReadableStream` — so `durationMs` covers the call that produced it,
   * not its consumption.
   */
  deferred?: true;
  /**
   * Direct calls only: the hydration id of the `<Loading>` boundary whose
   * render pass made the call — the `id` of that boundary's `"boundary"`
   * record — so a boundary's wait can be read as the server-function calls
   * it consisted of. Absent for a call outside any boundary's pass (the
   * shell, or HTTP dispatch).
   */
  boundary?: string;
}

/**
 * The live half of an invocation, for in-process consumers. Not part of the
 * record: `args` and `result` are application data (name/PII policy belongs
 * to the consumer), `error` is the value AS THROWN — before the HTTP
 * handler's production sanitization replaces it on the wire — and `event`
 * is the request event the call ran under (the per-call derived event for
 * direct calls).
 */
export interface InvocationLive {
  event: RequestEvent;
  /** HTTP dispatch only; absent for direct calls. */
  request?: Request;
  args: unknown[];
  /** The settled value, when `outcome` is `"ok"`. */
  result?: unknown;
  /** The thrown value, when `outcome` is `"error"`. */
  error?: unknown;
}

export type InvocationListener = (event: InvocationEvent, live: InvocationLive) => void;

// --- "render": a server render, on the server ----------------------------------

/**
 * One server render — a `renderToString` or a `renderToStream` (a document,
 * or a frame stream over the same core) — delivered on
 * `OBSERVE.records.subscribe("render", …)` once it ended: the document
 * returned, the stream's last fragment written, or the render torn down.
 * The server-side account of the head's timing: what the shell cost, and
 * how many `<Loading>` boundaries it waited on (each also a `"boundary"`
 * record) — the facts the response's `Server-Timing` `solid-shell` metric
 * is projected from. Serializable; the request the render served and its
 * trace ride beside it in `RenderLive`.
 */
export interface RenderEvent {
  /** `"string"` for `renderToString`, `"stream"` for `renderToStream`. */
  mode: "string" | "stream";
  /** `performance.now()` when the render began. */
  at: number;
  /**
   * Render start → the shell complete, in milliseconds: for a stream, the
   * head and shell handed to the sink (the head is frozen from here — a
   * fragment can no longer add to it); for a string, the document assembled
   * (the whole render). What `solid-shell` carries. Absent when the render
   * ended before its shell — torn down or failed pre-shell.
   */
  shellMs?: number;
  /**
   * Render start → the render's end, in milliseconds: the document
   * returned (`"string"`, equal to `shellMs`), the stream complete (every
   * fragment written), or the teardown for the other outcomes.
   */
  durationMs: number;
  /**
   * `<Loading>` boundaries the shell waited on — discovered with pending
   * async and settled before the shell completed, each a `"boundary"`
   * record with `streamed: false` and a `solid-boundary` metric. A boundary
   * that settled after the shell streamed as a fragment and is not counted
   * here (its own record says `streamed: true`). Counted from the
   * `"boundary"` records the render filed, under that record's gate: in an
   * observe build with a `"render"` listener but no `"boundary"` listener
   * the boundaries are not measured and this is `0`.
   */
  boundaries: number;
  /**
   * `"complete"` — the render ran to its end; `"abandoned"` — the consumer
   * left mid-stream (the sink threw, the readable was cancelled — the
   * `SSR_STREAM_ABANDONED` finding is that request's account) and the
   * render was torn down, or `createSSRResponse` discarded the page for a
   * pre-flush redirect (no finding); `"error"` — the render failed: a
   * string render threw, a stream's uncontained failure wound it down
   * through `onError`.
   */
  outcome: "complete" | "abandoned" | "error";
  /**
   * The route the render resolved to, as the router declared it while
   * building its context under this render (`OBSERVE.attribution.withOrigin`
   * with an `initial` ref — the same declaration the client's first
   * `"navigation"` record comes from): `name` the matched pattern
   * (`/users/:id`), `to` the concrete path, `params` what the pattern
   * bound. Read from the router's ref when the render settles, so a match
   * refined during the render is what lands. Absent when no router declared
   * one — a render without a router, or a router that does not yet. What a
   * consumer names the request by (`http.route`), where the URL would
   * scatter one page across as many names as it has parameters.
   */
  route?: RenderRoute;
}

/** `RenderEvent.route` — the route a render resolved to, as the router matched it. */
export interface RenderRoute {
  /** The matched route pattern — `/users/:id`. */
  name?: string;
  /** The concrete path. */
  to?: string;
  /** The params the pattern bound (optional params unbound: `undefined`). */
  params?: Readonly<Record<string, string | undefined>>;
}

/** The live half of a render record. */
export interface RenderLive {
  /** The request event the render ran under; absent for a render outside a request scope. */
  event?: RequestEvent;
  /** The trace the render belongs to — `getTraceContext()`'s answer for it. */
  trace: TraceContext;
}

export type RenderListener = (event: RenderEvent, live: RenderLive) => void;

// --- "call": a server-function call, from the client -------------------------

/**
 * One server-function call made from the browser — the fetch and its
 * decode, as the caller awaited it — delivered on
 * `OBSERVE.records.subscribe("call", …)` once it settled. The client twin
 * of the server's `"invocation"` record: the two join by `id` (this is the
 * call; that is the execution it caused), and the difference between their
 * durations is the wire. A call an integration answered locally (a
 * handler's `intercept`, at t = 0) made no request and emits nothing.
 */
export interface CallEvent {
  /** The function id — the same `id` the server's `"invocation"` record carries. */
  id: string;
  /**
   * The function's source name, from the reference's metadata
   * (`ServerFunctionMetadata.name`): the compiled function's name, which
   * the compiler seeds in development builds only, or an explicit label
   * (`withMeta`, the `name` argument to `createServerReference`), which
   * survives to production. A label, not an identity: not unique, and
   * absent when the metadata carries none.
   */
  name?: string;
  /** `performance.now()` when the call was made. */
  at: number;
  /**
   * Call → settle, in milliseconds: the request built and sent, the
   * response received and decoded (or claimed by the configured
   * `responseHandler`) — the whole await the caller saw. A streaming
   * result settles at handoff — see `deferred`.
   */
  durationMs: number;
  /** `GET` for a GET-encoded read (`GET(fn)`), `POST` otherwise. */
  method: "GET" | "POST";
  outcome: "ok" | "error";
  /**
   * The response's HTTP status, once one arrived. Absent when the call
   * failed before a response (the fetch itself rejected).
   */
  status?: number;
  /**
   * What the call ran for, when the attribution engine
   * (`solid-js/attribution`) is enabled and knows: the interaction whose
   * handler made it (`kind: "interaction"`), the navigation whose data
   * needed it (`kind: "navigation"`, its `interaction` the click), the
   * effect or action step, the async landing whose recompute called again —
   * the engine's own origin object, so it IS `InteractionEvent.origin` /
   * `NavigationEvent.origin` / `HoldEvent.origin` by identity: an observer
   * puts the call under the interaction's record without a time join. Read
   * at dispatch, so a call made after an `await` in a handler stamps
   * nothing (the same escape a write there has). Absent without an engine.
   */
  origin?: ChangeOrigin;
  /**
   * The settled value is a body the caller drives — an async iterable
   * (a `live()` source, a generator result) — so `durationMs` covers the
   * call that produced it, not its consumption.
   */
  deferred?: true;
}

/**
 * The live half of a call, for in-process consumers — ONE object across
 * the call's records: the same `CallLive` is handed to the `"request"`
 * listener at the send and to the `"call"` listener at settle, filled in
 * as the call proceeds (`args` from the start, `request` at the send,
 * `response` and `result`/`error` at settle — filled on every settle,
 * whether or not a `"call"` record goes out, so a `"request"` listener
 * holding it reads the outcome off it too), so an in-process consumer
 * joins a call's request to its settle by identity — the way `origin`
 * joins a record to the interaction's — with no id-plus-time join and no
 * sequence number. One MUTABLE object shared by both records' listeners:
 * treat it as read-only — a write shows up on the other record's
 * listener. `error` is the value as thrown to the caller — a
 * decoded server error, or the transport's own failure. The bodies —
 * `request`, and `response` as an unread clone — are a body viewer's
 * (devtools' network panel), and are taken only while a listener asked for
 * them (`OBSERVE.records.subscribe("call", fn, { bodies: true })`, or the
 * same on `"request"` for the request alone): each costs the call a
 * reconstruction and a transient double-buffer of the payload, which a
 * consumer that reads ids, statuses and timings never pays. With no such
 * listener `request` is absent and `response` is the transport's own
 * object, consumed by its decode. Whether bodies are taken is read once,
 * as the call starts.
 */
export interface CallLive {
  args: unknown[];
  /**
   * Bodies opted in — by a `"call"` listener or a `"request"` listener
   * (`observed("call", "bodies") || observed("request", "bodies")`): the
   * request as dispatched — the final url and `RequestInit` (the
   * transport's headers, the `prepareRequest` hook applied), built into a
   * `Request` of the listener's own at the send, so its headers and body
   * are readable in full and reading them touches nothing the transport
   * sent. Set before the `"request"` record is delivered, so that listener
   * reads it too — and it is ONE `Request`, shared by the call's
   * `"request"` and `"call"` records: a body reads once, so a listener that
   * wants it reads through `request.clone()` (`live.request.clone().text()`)
   * and the other record's listener can still read it; a direct
   * `live.request.text()` leaves `bodyUsed` true for whoever reads next.
   * Built WITH the body only when the body has a shape a
   * second `Request` can hold without a competing consumer — `string`,
   * `URLSearchParams`, `FormData`, `Blob`, `ArrayBuffer` or a view of one
   * — and WITHOUT it otherwise (a `ReadableStream` or an async iterable,
   * the transport's streaming-upload contract: reconstructing one would
   * consume it ahead of the send), so the request then reads as bodyless.
   * Absent without the opt-in; when the call failed before the request was
   * built (argument serialization threw); when the address is relative and
   * there is no `location` to resolve it against (absent beats a URL that
   * was never sent); and when the reconstruction itself failed (an init
   * the `Request` constructor rejects but the configured `fetch`
   * tolerates) — a reconstruction never fails the call.
   */
  request?: Request;
  /**
   * The response: with bodies opted in, one with an UNREAD body — a
   * `clone()` taken as the response arrived, before the transport's
   * decode, so the listener reads status, headers and body while the
   * caller still gets its result from the original. The transport's own
   * object instead — status and headers readable, body consumed by the
   * transport's decode — without the opt-in, and, with it, for a response
   * whose clone would be a branch nobody drains: an event-stream response
   * (a `live()` source, `text/event-stream`, a connection open for the
   * page's life), a deferred result (a generator's stream, `deferred:
   * true`, served for the stream's life — its clone, taken before the
   * result's shape was known, is cancelled at settle), and a response the
   * `clone()` refused (one a configured `fetch` handed over already read).
   * A response a `responseHandler` claimed whose result is not a deferred
   * body — a non-live `application/x-frame-stream` frame render the frames
   * transport claims, say — keeps its clone, so under the opt-in the
   * clone's branch buffers that render until the listener reads it or
   * drops the record; live frames are `text/event-stream` and are never
   * cloned. Absent when the fetch itself rejected.
   */
  response?: Response;
  /** The settled value, when `outcome` is `"ok"`. */
  result?: unknown;
  /** The thrown value, when `outcome` is `"error"`. */
  error?: unknown;
}

export type CallListener = (event: CallEvent, live: CallLive) => void;

// --- "request": a server-function request left, from the client ---------------

/**
 * One server-function request LEFT the browser — delivered on
 * `OBSERVE.records.subscribe("request", …)` at the send: after the
 * arguments were serialized and `prepareRequest` had its say, immediately
 * before the transport's `fetch` is handed the request. "Left" means
 * HANDED TO `fetch`, not that it reached the network: a `fetch` that
 * throws synchronously still has its `"request"` (and a `"call"` with
 * `outcome: "error"`). The `"call"` record of the same call follows at
 * settle; this one exists because that one cannot show a call that is
 * still in flight, or one that never settles (a hung fetch) — a network
 * panel's pending row. The two records share their `CallLive` by identity
 * (see `CallLive`): the object handed here is the object handed to the
 * `"call"` listener, so an in-process consumer joins them with no
 * id-plus-time join and no sequence number.
 *
 * Emitted only for a request that was handed over: a call that failed
 * before its request was built (argument serialization threw, or
 * `prepareRequest` did) emits no `"request"` — only its `"call"` settle; a
 * call an integration answered locally (a handler's `intercept`) made no
 * request and emits neither. A deferred or streaming result emits
 * `"request"` at the send and `"call"` at handoff, as today. Serializable;
 * `live.request` (under `bodies`) rides beside it.
 *
 * Listeners run synchronously, on the call's path, BEFORE the send: a slow
 * listener delays the fetch and the time it spends is inside the call's
 * `durationMs`. Read what is needed and hand the work off to a microtask
 * (the same guidance the engine's records give).
 */
export interface CallRequestEvent {
  /**
   * Which end recorded it. Only `"client"` exists today — the request left
   * the browser. The server half (the request arrived, ahead of its
   * `"invocation"`) is `"server"`, additive later, the way the `"frame"`
   * record has two halves.
   */
  side: "client";
  /** The function id — the same `id` the call's `"call"` and the server's `"invocation"` carry. */
  id: string;
  /** The function's source name, by the same rule as `CallEvent.name`. */
  name?: string;
  /**
   * `performance.now()` at the send — when the request was handed to
   * `fetch`, after serialization and `prepareRequest`. NOT the call's
   * `CallEvent.at`, which is when the call was made: the gap between them
   * is what building the request cost (an async `prepareRequest`
   * included), and `CallEvent.at + durationMs` is never before this.
   */
  at: number;
  /** `GET` for a GET-encoded read (`GET(fn)`), `POST` otherwise — as on `CallEvent`. */
  method: "GET" | "POST";
  /**
   * What the call ran for — the same object `CallEvent.origin` carries,
   * read at dispatch (see `CallEvent.origin` for the rule).
   */
  origin?: ChangeOrigin;
}

export type CallRequestListener = (event: CallRequestEvent, live: CallLive) => void;

// --- "frame": a frame stream, produced (server) or applied (client) ------------

interface FrameEventBase {
  /**
   * The frame id on the wire: the server function's id when the stream is a
   * server-function response (the same `id` that call's `"invocation"` and
   * `"call"` records carry), or what the producer named it; `""` for a bare
   * `renderToFrameStream` with no `frame` option.
   */
  id: string;
  /**
   * The stream version: as the producer stamped it on the server; as the
   * client restamped it on the client (the consumer owns versions — one
   * per stream a boundary consumed — so this is the number the frame's
   * stale-guard saw).
   */
  version: number;
  /** `performance.now()` at the stream's `start` chunk — written, or read. */
  at: number;
  /**
   * Start → `complete`, in milliseconds: the whole stream, fragments
   * included. On the client this is the body's read and apply — the
   * request that produced the response is the `"call"` record's time.
   */
  durationMs: number;
  /**
   * Start → the shell (`html`) chunk, in milliseconds: the time to first
   * content. Absent when the stream carried no shell (the server's
   * synchronous failure path).
   */
  shellMs?: number;
  /** Chunks between `start` and `complete` (exclusive), all types. */
  chunks: number;
  /** `fragment` chunks: `<Loading>` content that settled after the shell. */
  fragments: number;
  /** `slot` chunks: render-prop invocations the client fills. */
  slots: number;
  /**
   * Nested server-content regions (a server JSX slot argument): `html`
   * chunks addressed to a child frame id rather than the stream's own.
   */
  regions: number;
  /** `error` chunks: fragments that failed (their fallback still revealed), plus a sync failure. */
  errors: number;
}

/**
 * The server half of a `"frame"` record: one frame stream produced — a
 * server component rendered to the frame transport
 * (`renderServerComponent` / `renderToFrameStream`), from its `start`
 * chunk to its `complete` — delivered once it completed.
 */
export interface FrameProducedEvent extends FrameEventBase {
  side: "server";
  /**
   * `complete` — the render ran to the end (fragment failures, if any, are
   * in `errors`); `error` — the render threw synchronously, the stream
   * carried the failure as its only content and completed.
   */
  outcome: "complete" | "error";
}

/**
 * The client half of a `"frame"` record: one frame stream applied — a
 * frame-stream response read chunk by chunk into the frame host
 * (`applyFrameResponse`), from its `start` to its `complete` — delivered
 * once the stream ended. A single-flight response carries one stream per
 * frame it refreshed; each is its own record, as on the server.
 */
export interface FrameAppliedEvent extends FrameEventBase {
  side: "client";
  /**
   * The local id the chunks were applied under, when the consumer remapped
   * the producer's root id onto its own boundary (`applyFrameResponse`'s
   * `as` — the call's address, for the server-component transport).
   * Absent when applied under the wire id.
   */
  address?: string;
  /**
   * `complete` — the `complete` chunk arrived; `truncated` — the body ended
   * before it (the connection dropped, the producer abandoned the stream);
   * `error` — the read failed (a malformed chunk, a body error), with the
   * failure in `live.error`.
   */
  outcome: "complete" | "truncated" | "error";
}

/**
 * One frame stream, from whichever end observed it — delivered on
 * `OBSERVE.records.subscribe("frame", …)`; `side` says which. The two
 * halves share their shape (the same census, the same timings measured
 * where each stands), so a consumer joins them by `id` and `version` and
 * the difference is the wire.
 */
export type FrameEvent = FrameProducedEvent | FrameAppliedEvent;

/** The live half of a frame record. */
export interface FrameLive {
  /** The value thrown: the server's sync failure, or the client's read failure. */
  error?: unknown;
  /** Client only: the response the stream was read from. */
  response?: Response;
}

export type FrameListener = (event: FrameEvent, live: FrameLive) => void;

// The catalogue: this runtime's records, onto the core's `HostRecordTypes`
// through `solid-js` — the peer every consumer of this package resolves,
// which re-exports the interface (the merge follows the alias to the core's
// declaration; pinned by the type tests). Not through `@solidjs/signals`:
// that is a transitive dependency a strict package layout does not expose
// from here — and the core's `RecordTypes` has exactly one augmenter
// (solid-js) for a reason it documents.
declare module "solid-js" {
  interface HostRecordTypes {
    /** Server-function executions, on the server — see `InvocationEvent`. */
    invocation: { event: InvocationEvent; live: InvocationLive };
    /** Server renders — a document or a frame stream — see `RenderEvent`. */
    render: { event: RenderEvent; live: RenderLive };
    /** Server-function calls, from the client — see `CallEvent`. */
    call: { event: CallEvent; live: CallLive };
    /**
     * Server-function requests left, from the client — see
     * `CallRequestEvent`; the `live` is the call's own, shared with its
     * `"call"` record.
     */
    request: { event: CallRequestEvent; live: CallLive };
    /** Frame streams, produced or applied — see `FrameEvent`. */
    frame: { event: FrameEvent; live: FrameLive };
  }
}

// --- Shared helpers ----------------------------------------------------------

// `instanceof` is realm-local; the intrinsic brand accepts a genuine Promise
// from another realm without adopting arbitrary thenables — the same rule
// the server-functions runtime settles results by.
export function settledPromise(value: unknown): Promise<unknown> | undefined {
  if (value instanceof Promise) return value;
  try {
    if (Object.prototype.toString.call(value) === "[object Promise]")
      return Promise.prototype.then.call(value, (v: unknown) => v) as Promise<unknown>;
  } catch {}
  return undefined;
}

// A body the CALLER drives, per the runtime's own deferred-result rules
// (`bindDeferredBody`): the call handed it back, its work happens later.
export function isDeferredBody(value: unknown): boolean {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return false;
  if (typeof ReadableStream !== "undefined" && value instanceof ReadableStream) return true;
  const v = value as any;
  if (typeof v[Symbol.asyncIterator] === "function") return true;
  return (
    typeof v[Symbol.iterator] === "function" &&
    !Array.isArray(value) &&
    !(value instanceof Map) &&
    !(value instanceof Set) &&
    !ArrayBuffer.isView(value)
  );
}

/**
 * The census one frame stream's chunks add up to, kept by either half: one
 * chunk of `type`, addressed to the stream's own frame (`own`) or to a
 * nested region's.
 */
export function frameCensus(event: FrameEventBase, type: string, own: boolean): void {
  event.chunks++;
  switch (type) {
    case "html":
      if (!own) event.regions++;
      else if (event.shellMs === undefined) event.shellMs = performance.now() - event.at;
      break;
    case "fragment":
      event.fragments++;
      break;
    case "slot":
      event.slots++;
      break;
    case "error":
      event.errors++;
      break;
  }
}

// --- Client emitters ---------------------------------------------------------

/** What the client runtime hands a call observation as the call proceeds. */
export interface CallObservation {
  /**
   * The request is about to be sent: the address and the final
   * `RequestInit` — what the transport's `fetch` receives, hook applied.
   * The `"request"` record is delivered from here.
   */
  request(url: string, init: RequestInit): void;
  /** The response arrived (before decode); its status goes on the record. */
  response(response: Response): void;
  /** The call settled as the caller sees it: the value returned, or the error thrown. */
  settle(outcome: "ok" | "error", value: unknown): void;
}

/**
 * Opens the observation of one server-function call from the client, as
 * the request is about to be built; the runtime reports the request as it
 * is sent (the `"request"` record), the response when it arrives and the
 * settle when the caller gets its answer (the `"call"` record). `undefined`
 * with no listener for either record or outside observe builds — the
 * runtime then does nothing extra, not even read the clock.
 */
export function observeCall(
  id: string,
  method: "GET" | "POST",
  args: unknown[],
  name?: string
): CallObservation | undefined {
  if (!IS_OBSERVE) return undefined;
  const channel = records();
  if (channel === undefined) return undefined;
  // The observation is opened PER CALL: every gate is read ONCE, here, as
  // the call starts — which records it builds and whether bodies are taken
  // for them — so a subscription that arrives or leaves mid-call cannot
  // change what this call takes (a clone with no listener to read it, a
  // reconstruction nobody asked for). DELIVERY is per emission: each record
  // goes to the listeners installed the moment it fires (the channel's
  // rule). So a listener subscribing mid-call can hear this call's
  // `"call"` and not its `"request"` (it subscribed after the send, while
  // a `"call"` listener was there at the start), or its `"request"` and
  // never its `"call"` (it subscribed before the send, while a `"request"`
  // listener and no `"call"` listener was there at the start — the row
  // looks like a hung fetch). A `"call"` listener alone, a `"request"`
  // listener alone, or both: the observation exists for either.
  const observedCall = channel.observed("call");
  const observedRequest = channel.observed("request");
  if (!observedCall && !observedRequest) return undefined;
  const at = performance.now();
  // Bodies are taken only for a listener that asked (see `CallLive`). The
  // request is reconstructed for a `"request"` listener's opt-in as much as
  // a `"call"` listener's — it is the `"request"` record's own live handle
  // — while the response clone is the `"call"` record's alone.
  const bodies = channel.observed("call", "bodies");
  const requestBodies = bodies || channel.observed("request", "bodies");
  // Provenance is read NOW, at the call site, where the handler's or the
  // recompute's frame is still open; by the send it is gone (an async
  // `prepareRequest` intervenes), by settle long gone.
  const origin = currentOrigin();
  // ONE live object for the call's records (see `CallLive`): handed to the
  // `"request"` listener at the send and to the `"call"` listener at
  // settle, filled in between — the identity IS the join.
  const live: CallLive = { args };
  let response: Response | undefined;
  let clone: Response | undefined;
  let settled = false;
  return {
    request(url, init) {
      // The send's clock, read FIRST — before the reconstruction below, so
      // the record's `at` is the send and not the send plus what rebuilding
      // the request cost (a cost that varies with whether some other tool
      // asked for bodies): the gap `at - CallEvent.at` is what the docs
      // attribute to serialization and `prepareRequest`, nothing of ours.
      // Not read when nothing is subscribed to the record.
      const at = observedRequest ? performance.now() : 0;
      // The send keeps its `(address, init)` shape — a configured `fetch`
      // does not branch on whether devtools are attached — so what the
      // listener gets is a reconstruction of the dispatched request, the
      // listener's own to read. Built BEFORE the record is delivered, so
      // the `"request"` listener finds it on `live`; a reconstruction that
      // failed leaves `live.request` absent and the record still goes out
      // — the request was handed to `fetch` either way.
      if (requestBodies) {
        const request = reconstructRequest(url, init);
        if (request !== undefined) live.request = request;
      }
      // Delivery goes to the listeners installed NOW; the gate is the
      // call's start's (see above).
      if (!observedRequest) return;
      const event: CallRequestEvent = { side: "client", id, at, method };
      if (name !== undefined) event.name = name;
      if (origin !== undefined) event.origin = origin;
      channel.emit("request", event, live);
    },
    response(r) {
      response = r;
      if (!bodies) return;
      // Cloned NOW, before the transport's decode, so the listener's body is
      // whole and unread — except an event stream: `live()` holds its
      // connection open for the page's life, and a tee'd branch nobody
      // drains would hold every event it ever carried (see `CallLive`). The
      // framing test is the transport's `isEventStream`, inlined: this
      // module imports nothing of either platform's runtime. A `clone()`
      // that throws — a response a configured `fetch` handed over already
      // read — leaves the listener the transport's object: nothing taken
      // for the record may fail the call.
      const type = r.headers.get("content-type");
      if (type !== null && type.startsWith("text/event-stream")) return;
      try {
        clone = r.clone();
      } catch {}
    },
    settle(outcome, value) {
      if (settled) return;
      settled = true;
      // The live is filled on EVERY settle, whether or not a `"call"` record
      // goes out: it is the `"request"` listener's object too (see
      // `CallLive`), and a panel holding the pending row by it reads the
      // outcome off it when the row settles. Without a `"call"` listener
      // at the call's start no clone was taken (`bodies` was false), so
      // `response` is the transport's own object — nothing is taken here
      // that the gates did not allow. Assigned once, here: a `"request"`
      // listener never sees `response` swapped.
      const deferred = outcome === "ok" && isDeferredBody(value);
      if (outcome === "ok") live.result = value;
      else live.error = value;
      // A deferred result is a body the caller drives for the stream's life
      // — the same open connection an event stream is, known only now that
      // the decode handed the shape back — so the clone taken at arrival is
      // released: its branch stops buffering what the caller reads, and the
      // listener gets the transport's object.
      if (deferred && clone !== undefined) {
        cancelBody(clone);
        clone = undefined;
      }
      if (clone !== undefined) live.response = clone;
      else if (response !== undefined) live.response = response;
      // The `"call"` EMISSION is gated by the call's start: with a
      // `"request"` listener alone the observation exists for that record
      // and no `"call"` record is built. Under the gate, delivery goes to
      // the `"call"` listeners installed NOW — one that subscribed mid-call
      // beside one that was there at the start hears this settle.
      if (!observedCall) return;
      const event: CallEvent = { id, at, durationMs: performance.now() - at, method, outcome };
      if (name !== undefined) event.name = name;
      if (response !== undefined) event.status = response.status;
      if (origin !== undefined) event.origin = origin;
      if (deferred) event.deferred = true;
      channel.emit("call", event, live);
    }
  };
}

/**
 * The dispatched request, rebuilt for a listener to read — or `undefined`,
 * never a throw: what is taken for the record cannot fail the call. Absent
 * for a relative address with no `location` to resolve it against (a URL
 * the transport never sent is worse than none), and when the `Request`
 * constructor rejects what the configured `fetch` accepts (a header name
 * it refuses, say).
 */
function reconstructRequest(url: string, init: RequestInit): Request | undefined {
  try {
    // `new URL(relative, undefined)` throws: exactly the absence wanted.
    return new Request(new URL(url, globalThis.location?.href), {
      ...init,
      body: reconstructableBody(init.body)
    });
  } catch {
    return undefined;
  }
}

/**
 * The body a second `Request` can hold without competing with the send
 * for it — the buffered shapes, positively: `undefined`/`null`, a string,
 * `URLSearchParams`, `FormData`, a `Blob`, an `ArrayBuffer` or a view of
 * one. Anything else — a `ReadableStream`, an async iterable (the
 * transport's streaming-upload contract) — reconstructs without a body:
 * a `Request` over one would consume it ahead of the send.
 */
function reconstructableBody(body: BodyInit | null | undefined): BodyInit | null | undefined {
  if (body == null || typeof body === "string") return body;
  if (
    body instanceof URLSearchParams ||
    (typeof FormData !== "undefined" && body instanceof FormData) ||
    (typeof Blob !== "undefined" && body instanceof Blob) ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body)
  )
    return body;
  return undefined;
}

/** Releases a clone's unread body; a body already closed or errored is nothing to release. */
function cancelBody(response: Response): void {
  try {
    const body = response.body;
    if (body !== null) body.cancel().catch(() => {});
  } catch {}
}

/** What the client's stream reader hands a frame observation. */
export interface FrameApplyObservation {
  /**
   * Every chunk read, after the consumer's remapping (`as`, `version`) —
   * `wireId` is the id the chunk carried before it.
   */
  chunk(chunk: { type: string; id: string; version: number }, wireId: string): void;
  /**
   * The apply ended — cleanly, or with the failure it threw (a read that
   * failed, a chunk that would not parse, a host that rejected a chunk).
   */
  end(error?: unknown): void;
}

/**
 * Opens the observation of one frame-stream response on the client: every
 * `start` chunk opens a stream record (a single-flight response carries
 * several, in sequence), every chunk until its `complete` is counted to
 * it, and the record is delivered at `complete` — or at the body's end as
 * `truncated`, or at a read failure as `error`. `undefined` with no
 * listener or outside observe builds.
 */
export function observeFrameApply(response: Response): FrameApplyObservation | undefined {
  if (!IS_OBSERVE) return undefined;
  const channel = records();
  if (channel === undefined || !channel.observed("frame")) return undefined;
  // The stream open now: streams in one response are sequential (the
  // producer awaits each frame's render before the next), so a chunk
  // belongs to the last `start` not yet completed. `applied` is the id its
  // chunks carry after the consumer's remap — what `complete` and the
  // shell's `html` are matched by.
  let current: { event: FrameAppliedEvent; applied: string } | undefined;
  const close = (outcome: FrameAppliedEvent["outcome"], error?: unknown) => {
    const open = current!;
    current = undefined;
    open.event.durationMs = performance.now() - open.event.at;
    open.event.outcome = outcome;
    const live: FrameLive = { response };
    if (error !== undefined) live.error = error;
    channel.emit("frame", open.event, live);
  };
  return {
    chunk(chunk, wireId) {
      if (chunk.type === "start") {
        if (current !== undefined) close("truncated");
        const event: FrameAppliedEvent = {
          side: "client",
          id: wireId,
          version: chunk.version,
          at: performance.now(),
          durationMs: 0,
          outcome: "complete",
          chunks: 0,
          fragments: 0,
          slots: 0,
          regions: 0,
          errors: 0
        };
        if (chunk.id !== wireId) event.address = chunk.id;
        current = { event, applied: chunk.id };
        return;
      }
      if (current === undefined) return;
      if (chunk.type === "complete") {
        if (chunk.id === current.applied) close("complete");
        return;
      }
      frameCensus(current.event, chunk.type, chunk.id === current.applied);
    },
    end(error) {
      if (current !== undefined) close(error !== undefined ? "error" : "truncated", error);
    }
  };
}
