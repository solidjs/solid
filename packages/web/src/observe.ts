// This runtime's records on `OBSERVE.records` (see `Records` in
// @solidjs/signals): the TYPES of every record `@solidjs/web` emits, on
// either platform, and the emitters for the client's — the `"call"` record
// (a server-function call made from the browser) and the client half of the
// `"frame"` record (a frame stream applied). The server's emitters — the
// `"invocation"` record and the frame's server half — are in
// server-observe.ts, which needs the server runtime; this module needs
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
import type { AttributionHooks, ChangeOrigin, Records } from "solid-js";
import type { RequestEvent } from "./server.js";

// Replaced per build; a module const (not an inline literal) so the typed
// gates below read as booleans (cookies.ts uses the same shape).
const IS_OBSERVE = "_SOLID_OBSERVE_" as unknown as boolean;

const RECORDS = Symbol.for("@solidjs/signals/observe/records");
const ATTRIBUTION = Symbol.for("@solidjs/signals/observe/attribution");

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
  const hooks = (globalThis as { [ATTRIBUTION]?: AttributionHooks })[ATTRIBUTION];
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
 * The live half of a call, for in-process consumers. `response` is the
 * transport's own object, not a clone: its status and headers are
 * readable, its body is the decode's (already consumed, or being consumed
 * by the caller for a streaming result). `error` is the value as thrown to
 * the caller — a decoded server error, or the transport's own failure.
 */
export interface CallLive {
  args: unknown[];
  response?: Response;
  /** The settled value, when `outcome` is `"ok"`. */
  result?: unknown;
  /** The thrown value, when `outcome` is `"error"`. */
  error?: unknown;
}

export type CallListener = (event: CallEvent, live: CallLive) => void;

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
    /** Server-function calls, from the client — see `CallEvent`. */
    call: { event: CallEvent; live: CallLive };
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
  /** The response arrived (before decode); its status goes on the record. */
  response(response: Response): void;
  /** The call settled as the caller sees it: the value returned, or the error thrown. */
  settle(outcome: "ok" | "error", value: unknown): void;
}

/**
 * Opens the observation of one server-function call from the client, as
 * the request is about to be built; the runtime reports the response when
 * it arrives and the settle when the caller gets its answer. `undefined`
 * with no listener or outside observe builds — the runtime then does
 * nothing extra, not even read the clock.
 */
export function observeCall(
  id: string,
  method: "GET" | "POST",
  args: unknown[]
): CallObservation | undefined {
  if (!IS_OBSERVE) return undefined;
  const channel = records();
  if (channel === undefined || !channel.observed("call")) return undefined;
  const at = performance.now();
  // Provenance is read NOW, at the call site, where the handler's or the
  // recompute's frame is still open; by settle it is long gone.
  const origin = currentOrigin();
  let response: Response | undefined;
  let settled = false;
  return {
    response(r) {
      response = r;
    },
    settle(outcome, value) {
      if (settled) return;
      settled = true;
      const event: CallEvent = { id, at, durationMs: performance.now() - at, method, outcome };
      if (response !== undefined) event.status = response.status;
      if (origin !== undefined) event.origin = origin;
      const live: CallLive = { args };
      if (response !== undefined) live.response = response;
      if (outcome === "ok") {
        live.result = value;
        if (isDeferredBody(value)) event.deferred = true;
      } else live.error = value;
      channel.emit("call", event, live);
    }
  };
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
