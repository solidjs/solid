import type { DiagnosticEvent } from "@solidjs/signals";
import type {
  AttributionCostTables,
  AttributionFeedbackTables,
  ChangeOrigin,
  HoldEvent,
  RerunEvent
} from "@solidjs/signals/attribution";

/**
 * The engine's record types, re-exported from `@solidjs/signals/attribution`
 * by name where it exports them and derived structurally where it does not,
 * so the harness stays type-locked to the engine: if a shape changes, these
 * break at compile time here rather than silently at runtime.
 */
export type {
  Attribution,
  AttributionOptions,
  RerunEvent,
  ScopeCost,
  WriteCost,
  ChangeRecord,
  ChangeOrigin,
  /** A settled hold that staged a root write — already serializable (no live nodes). */
  HoldEvent,
  FeedbackSource,
  FeedbackInteraction,
  FlightStats,
  FallbackStats
} from "@solidjs/signals/attribution";
/** The fold tables as `costs()` / `feedback()` return them — named exports of the engine's entry. */
export type AttributionCosts = AttributionCostTables;
export type AttributionFeedback = AttributionFeedbackTables;

/**
 * A re-run as the artifact stores it. The engine's `RerunEvent` is
 * serializable as emitted — it names its scope by `nodeId` and never carries
 * the live node (in-process consumers ask `OBSERVE.subjectOf(event)`) — so
 * the artifact copies records verbatim; the alias is the artifact's
 * vocabulary for the same shape.
 */
export type RerunRecord = RerunEvent;

export interface ArtifactAttribution {
  reruns: RerunRecord[];
  costs: AttributionCosts;
  /** Every hold that staged a root write — what the user waited on. */
  holds: HoldEvent[];
  /** The ranked feedback tables folded from `holds` and the re-runs' interactions. */
  feedback: AttributionFeedback;
}

/**
 * A `<Loading>` boundary that waited during a server render — `solid-js`'s
 * `"boundary"` record (`BoundaryEvent`), as delivered on `OBSERVE.records`.
 * Mirrored here rather than imported: this package depends on
 * `@solidjs/signals` alone, and the record types are the runtimes'
 * (`solid-js`, `@solidjs/web`). The web server suite pins each mirror to
 * its original at compile time.
 */
export interface BoundaryRecord {
  /** The boundary's hydration id — pairs with `SSR_*` findings and with `InvocationRecord.boundary`. */
  id: string;
  /** `performance.now()` when the boundary was discovered (its first pass began). */
  at: number;
  /** Discovery → settle, in milliseconds: how long the boundary held up its content. */
  durationMs: number;
  /** Settle → reveal: how long finished content waited behind `<Reveal>` siblings; 0 when nothing coordinated it. */
  heldMs: number;
  /** Render passes over the content: discovery plus one per wait. `passes - 1` sequential flights. */
  passes: number;
  /**
   * `settled` — content rendered; `fallback` — `renderToString` shipped the
   * fallback; `client` — content handed off to the client (`ssrSource:
   * "client"`); `error` — the content threw and the error boundary took it.
   */
  outcome: "settled" | "fallback" | "client" | "error";
  /** Whether the outcome went out as a streamed fragment (`true`) or inline with the shell. */
  streamed: boolean;
  /** The `<Reveal>` group that coordinated the swap, when one did. */
  revealGroup?: string;
  /** Root-first component labels down to the boundary, when the runtime knows them. */
  ownerPath?: string[];
}

/**
 * One server function execution, on the server — `@solidjs/web`'s
 * `"invocation"` record (`InvocationEvent`), mirrored on the same terms as
 * `BoundaryRecord`.
 */
export interface InvocationRecord {
  /** The function id. */
  id: string;
  /** `true` for an in-process call during SSR, `false` for HTTP dispatch. */
  direct: boolean;
  /** `performance.now()` when the execution started. */
  at: number;
  /** Start → settle, in milliseconds. */
  durationMs: number;
  outcome: "ok" | "error";
  /** The settled value is a body the caller drives; `durationMs` covers the call, not the consumption. */
  deferred?: true;
  /** Direct calls: the `<Loading>` boundary whose render pass made the call — a `BoundaryRecord.id`. */
  boundary?: string;
}

/**
 * One server-function call made from the browser — `@solidjs/web`'s
 * `"call"` record (`CallEvent`), mirrored on the same terms as
 * `BoundaryRecord`. The client twin of `InvocationRecord`: the two join by
 * `id`, and the difference between their durations is the wire.
 */
export interface CallRecord {
  /** The function id — the same `id` the server's `InvocationRecord` carries. */
  id: string;
  /** `performance.now()` when the call was made. */
  at: number;
  /** Call → settle, in milliseconds: request, response and decode, as the caller awaited it. */
  durationMs: number;
  /** `GET` for a GET-encoded read, `POST` otherwise. */
  method: "GET" | "POST";
  outcome: "ok" | "error";
  /** The response's HTTP status, once one arrived; absent when the fetch itself failed. */
  status?: number;
  /**
   * What the call ran for, when the attribution engine knew — the
   * interaction, navigation, effect or action frame: the engine's own origin
   * object, so it is `attribution.holds[].interaction` / `holds[].origin`
   * by identity within one capture (equal by value once serialized). Absent
   * without an engine or outside any frame.
   */
  origin?: ChangeOrigin;
  /** The settled value is a body the caller drives; `durationMs` covers the call, not the consumption. */
  deferred?: true;
}

/**
 * One frame stream — produced on the server (`renderServerComponent`, or a
 * server-function response through `frameTransformResult`) or applied on
 * the client (`applyFrameResponse`) — `@solidjs/web`'s `"frame"` record
 * (`FrameEvent`), mirrored on the same terms as `BoundaryRecord`. `side`
 * says which end observed it; the two halves join by `id` and `version`.
 */
export type FrameRecord = FrameProducedRecord | FrameAppliedRecord;

interface FrameRecordBase {
  /** The frame id on the wire: the server function's id for a server-function response (the `"invocation"`/`"call"` records' `id`); `""` for a bare stream. */
  id: string;
  /** The stream version: as the producer stamped it (server), or as the consumer restamped it (client). */
  version: number;
  /** `performance.now()` at the stream's `start` chunk. */
  at: number;
  /** Start → `complete`, in milliseconds: the whole stream, fragments included. */
  durationMs: number;
  /** Start → the shell (`html`) chunk, in milliseconds: time to first content. Absent when the stream carried no shell. */
  shellMs?: number;
  /** Transport chunks between `start` and `complete`, all types. */
  chunks: number;
  /** `fragment` chunks: `<Loading>` content that settled after the shell. */
  fragments: number;
  /** `slot` chunks: render-prop invocations the client fills. */
  slots: number;
  /** Nested server-content regions: `html` chunks addressed to a child frame id. */
  regions: number;
  /** `error` chunks: fragments that failed, plus a synchronous failure. */
  errors: number;
}

/** The server half of a `FrameRecord`: one frame stream produced. */
export interface FrameProducedRecord extends FrameRecordBase {
  side: "server";
  /** `complete` — the render ran to the end; `error` — it threw synchronously and the stream carried only the failure. */
  outcome: "complete" | "error";
}

/** The client half of a `FrameRecord`: one frame stream applied. */
export interface FrameAppliedRecord extends FrameRecordBase {
  side: "client";
  /** The local id the chunks were applied under, when the consumer remapped the wire id (`applyFrameResponse`'s `as`). */
  address?: string;
  /** `complete` — the `complete` chunk arrived; `truncated` — the body ended before it; `error` — the read failed. */
  outcome: "complete" | "truncated" | "error";
}

/**
 * What the runtimes recorded on `OBSERVE.records` during the scenario, one
 * table per record type, each in delivery (settle) order. On the server the
 * evidence is waits and calls (`boundary`, `invocation`, the frame's server
 * half); in the browser it is the calls made and the streams applied
 * (`call`, the frame's client half). Joins: `invocation.boundary` →
 * `boundary.id` reads a boundary's wait as the calls it consisted of;
 * `call.id` = `invocation.id` and `frame.id` across `side`s pair the two
 * ends of one request.
 */
export interface ArtifactRecords {
  /** Every `<Loading>` boundary that waited, in settle (or reveal) order. */
  boundary: BoundaryRecord[];
  /** Every server function execution, in settle order. */
  invocation: InvocationRecord[];
  /** Every frame stream produced or applied, in completion order. */
  frame: FrameRecord[];
  /** Every server-function call made from the browser, in settle order. */
  call: CallRecord[];
}

/**
 * The unit of exchange between a captured run and everything downstream:
 * assertions, budget files, JSONL egress, agent consumption.
 *
 * Format history: v1 carried `attribution.{reruns, costs}`; v2 adds
 * `attribution.{holds, feedback}` (responsiveness evidence); v3 adds
 * `HoldEvent.tailMs`, the `long`/`longMs` feedback columns and the `held`
 * rerun phase (LONG_HOLD); v4 drops `HoldEvent.acknowledgedBy` (the
 * `"kind:source"` strings) for the structured `acknowledgements`; v5 adds
 * `server` (the server runtime's boundary, invocation and frame records);
 * v6 replaces it with `records` — the same tables keyed by record type, on
 * both platforms, plus the client's `call` and the frame's client half. v7
 * adds `timeOrigin`, the anchor that turns every relative `at` into absolute
 * time, and stores re-runs as the engine emits them (`nodeId`, no `node`).
 */
export interface DiagnosticsArtifact {
  formatVersion: 7;
  /** Human/agent-readable label for the captured scenario. */
  scenario?: string;
  capturedAt: string;
  /**
   * Epoch milliseconds of the capturing process's `performance.now()` zero
   * (`performance.timeOrigin`). Every `at` in the artifact — on re-runs,
   * holds, interactions, navigations, the runtimes' records, and the
   * `data` of a diagnostic — is on that clock, so `timeOrigin + at` is the
   * absolute time of any of them, and two artifacts from one process (a
   * server render and the browser session it served) line up on it.
   */
  timeOrigin: number;
  durationMs: number;
  diagnostics: DiagnosticEvent[];
  /** Null when attribution was disabled for the capture. */
  attribution: ArtifactAttribution | null;
  /**
   * The runtimes' records, by type — always present (the channel is the
   * core's, on every observing build); a table is empty when nothing of its
   * kind happened, or no runtime that emits it was loaded.
   */
  records: ArtifactRecords;
}

export type { DiagnosticEvent, DiagnosticCode, DiagnosticSeverity } from "@solidjs/signals";
