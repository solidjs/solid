// The server runtime's emitters on `OBSERVE.records`: the `"invocation"`
// record (a server-function execution, either dispatch leg), the `"render"`
// record (a `renderToString`/`renderToStream` render) and the server half
// of the `"frame"` record (a frame stream produced). The record types and the channel
// accessor are observe.ts's, shared with the client's emitters; this module
// is the half that needs the server runtime (the render's hydration
// context, for the boundary a direct call ran under; the request's trace
// record, which the `Server-Timing` metrics are projected from).
//
// Everything here folds out of the prod server artifacts behind the
// `"_SOLID_OBSERVE_"` literal in `records()`: prod never reaches for the
// channel. No state is kept in this module — the server runtime is bundled
// once per entry (dist/server.*, server-functions/dist/server.*,
// frames/dist/server.* each carry their own copy of this file) and a
// subscriber must be reached by an invocation observed in any of them; the
// channel is the core's, process-wide.
import { sharedConfig } from "solid-js";
import {
  frameCensus,
  isDeferredBody,
  records,
  settledPromise,
  type FrameLive,
  type FrameProducedEvent,
  type InvocationEvent,
  type InvocationLive,
  type RenderEvent,
  type RenderLive
} from "./observe.js";
import { traceForEvent, type TraceRecord } from "./trace.js";
import type { RequestEvent } from "./server.js";

// Replaced per build; a module const so the gates below read as booleans.
const IS_DEV = "_SOLID_DEV_" as unknown as boolean;

/**
 * The one gate for a server record and the `Server-Timing` metric projected
 * from it (`TimedWork` in trace.ts): whether the runtime builds the record
 * of `type` — `"invocation"` (→ `solid-invocation`), `"render"` (→
 * `solid-shell`), `"boundary"` (→ `solid-boundary`, gated in the reactive
 * library's boundary with this same rule). Dev builds always: dev is the
 * panel's home, and the boundary already measures for its dev checks.
 * Observe builds while a listener is on the type (`observed`), so an app
 * with no observer sees no wire change; the record is then delivered AND
 * the metric written from it — one clock, one object. `false` in prod,
 * where `records()` is `undefined`.
 */
export function timesServerWork(type: "invocation" | "render" | "boundary"): boolean {
  const channel = records();
  if (channel === undefined) return false;
  return IS_DEV || channel.observed(type);
}

/** What the renderer holds while a render is being recorded. */
export interface RenderObservation {
  /**
   * The shell is complete — for a stream, handed to the sink; for a string,
   * the document assembled: stamps `shellMs`, the `solid-shell` metric's
   * duration. Once; a later call is ignored.
   */
  shell(): void;
  /** A `<Loading>` boundary the shell waited on settled: counts it (`boundaries`). */
  boundary(): void;
  /** The render ended; delivers the record. Once. */
  settle(outcome: RenderEvent["outcome"]): void;
}

/**
 * Opens the `"render"` record for a render of `mode` — on the request's
 * trace record, where the head commit reads it (`TraceRecord.render`) —
 * when `timesServerWork("render")`; `undefined` otherwise, and the renderer
 * then does nothing extra, not even read the clock. The record is built as
 * the render proceeds and delivered at `settle`, to a listener if there is
 * one; `event` is the request the render serves, the record's live half.
 */
export function observeRender(
  trace: TraceRecord,
  mode: RenderEvent["mode"],
  event: RequestEvent | undefined
): RenderObservation | undefined {
  if (!timesServerWork("render")) return undefined;
  const record: RenderEvent = {
    mode,
    at: performance.now(),
    durationMs: 0,
    boundaries: 0,
    outcome: "complete"
  };
  trace.render = record;
  let settled = false;
  return {
    shell() {
      // Once, and never on a delivered record (a render wound down as its
      // shell was being handed over settled without one).
      if (!settled && record.shellMs === undefined) record.shellMs = performance.now() - record.at;
    },
    boundary() {
      if (!settled) record.boundaries++;
    },
    settle(outcome) {
      if (settled) return;
      settled = true;
      record.durationMs = performance.now() - record.at;
      record.outcome = outcome;
      const channel = records()!;
      if (!channel.observed("render")) return;
      const live: RenderLive = { trace: trace.context };
      if (event !== undefined) live.event = event;
      channel.emit("render", record, live);
    }
  };
}

/** What the runtime passes an observation from either dispatch leg. */
export interface InvocationContext {
  id: string;
  direct: boolean;
  event: RequestEvent;
  request?: Request;
  args: unknown[];
}

// The server entry's `sharedConfig`: its `context` is the render's hydration
// context, on which `ssrLoadingBoundary` sets the id of the boundary whose
// pass is running (`runWithBoundaryErrorContext`).
type ServerSharedConfig = { context?: { _currentBoundaryId?: string | null } };

/** What the frame producer hands an observation: the stream's identity. */
export interface FrameObservation {
  /** Counts the chunk — call for every chunk written after `start`. */
  chunk(chunk: { type: string; id: string }): void;
  /** Delivers the record. `error` is the value thrown on the synchronous failure path. */
  settle(outcome: FrameProducedEvent["outcome"], error?: unknown): void;
}

/**
 * Opens the observation of one frame stream, at its `start`; the producer
 * feeds it every chunk and settles it at `complete`. `undefined` with no
 * listener or outside observe builds — the producer then does nothing
 * extra, not even read the clock.
 */
export function observeFrame(frame: { id: string; version: number }): FrameObservation | undefined {
  const channel = records();
  if (channel === undefined || !channel.observed("frame")) return undefined;
  const event: FrameProducedEvent = {
    side: "server",
    id: frame.id,
    version: frame.version,
    at: performance.now(),
    durationMs: 0,
    outcome: "complete",
    chunks: 0,
    fragments: 0,
    slots: 0,
    regions: 0,
    errors: 0
  };
  let settled = false;
  return {
    chunk(chunk) {
      if (chunk.type === "complete") return;
      frameCensus(event, chunk.type, chunk.id === frame.id);
    },
    settle(outcome, error) {
      if (settled) return;
      settled = true;
      event.durationMs = performance.now() - event.at;
      event.outcome = outcome;
      const live: FrameLive = {};
      if (outcome === "error") live.error = error;
      channel.emit("frame", event, live);
    }
  };
}

function deliver(
  context: InvocationContext,
  at: number,
  boundary: string | undefined,
  outcome: "ok" | "error",
  value: unknown
): void {
  const record: InvocationEvent = {
    id: context.id,
    direct: context.direct,
    at,
    durationMs: performance.now() - at,
    outcome
  };
  if (boundary !== undefined) record.boundary = boundary;
  if (outcome === "ok" && isDeferredBody(value)) record.deferred = true;
  // The request's `Server-Timing` (trace.ts) projects the record — on the
  // response the execution produces, or on the document for a direct call
  // made during its render. Filed before the record is delivered, so a
  // listener that commits the response from its callback still ships it.
  traceForEvent(context.event).timing.push({ type: "invocation", event: record });
  const channel = records()!;
  if (!channel.observed("invocation")) return;
  const live: InvocationLive = { event: context.event, args: context.args };
  if (context.request !== undefined) live.request = context.request;
  if (outcome === "ok") live.result = value;
  else live.error = value;
  channel.emit("invocation", record, live);
}

/**
 * Runs `execute` — the wrapped server-function execution — and reports it
 * as an `"invocation"` record once it settles: synchronously for a sync
 * return or throw, at resolution/rejection for a promise. Returns
 * `execute`'s value (a promise is re-wrapped, still a native Promise);
 * throws what it throws. Timed while `timesServerWork("invocation")` — the
 * duration also rides the response's `Server-Timing` — and, with no
 * listener in an observe build or outside observe builds altogether, it is
 * `execute()` and nothing else.
 */
export function observeInvocation<T>(context: InvocationContext, execute: () => T): T {
  if (!timesServerWork("invocation")) return execute();
  const at = performance.now();
  // The boundary whose pass is running NOW — a direct call is synchronous
  // up to its first await, so this is the boundary that made it; read here,
  // at the start, since by settle another boundary may be rendering. (The
  // published `sharedConfig` type is the client's; the server's context
  // carries the id the boundary set for its pass.)
  const boundary = context.direct
    ? ((sharedConfig as ServerSharedConfig).context?._currentBoundaryId ?? undefined)
    : undefined;
  let result: T;
  try {
    result = execute();
  } catch (error) {
    deliver(context, at, boundary, "error", error);
    throw error;
  }
  const promised = settledPromise(result);
  if (promised !== undefined) {
    return promised.then(
      value => {
        deliver(context, at, boundary, "ok", value);
        return value;
      },
      error => {
        deliver(context, at, boundary, "error", error);
        throw error;
      }
    ) as T;
  }
  deliver(context, at, boundary, "ok", result);
  return result;
}
