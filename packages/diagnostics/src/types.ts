import type { DiagnosticEvent, RecordEvent } from "solid-js";
// Type-only: `@solidjs/web` declares the `invocation`, `call` and `frame`
// records onto the channel's catalogue (`HostRecordTypes`, through
// `solid-js`); importing its types is what puts that declaration in this
// program, so `RecordEvent<"call">` resolves. Nothing of the web runtime is
// loaded — the harness runs on `@solidjs/signals` alone.
import type {} from "@solidjs/web";
import type {
  AttributionCostTables,
  AttributionFeedbackTables,
  HoldEvent,
  RerunEvent
} from "@solidjs/signals/attribution";

/**
 * The engine's types, by the names the engine exports them under — the
 * artifact stores records verbatim, so its vocabulary is the runtimes'.
 */
export type {
  Attribution,
  AttributionOptions,
  AttributionCostTables,
  AttributionFeedbackTables,
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

export interface ArtifactAttribution {
  /**
   * Every re-run, as the engine emitted it: it names its scope by `nodeId`
   * and never carries the live node (in-process consumers get it as `live`
   * beside the record on `OBSERVE.records`), so the artifact copies records
   * verbatim.
   */
  reruns: RerunEvent[];
  /** The fold tables as `costs()` returns them. */
  costs: AttributionCostTables;
  /** Every hold that staged a root write — what the user waited on. */
  holds: HoldEvent[];
  /** The ranked feedback tables folded from `holds` and the re-runs' interactions. */
  feedback: AttributionFeedbackTables;
}

/**
 * The record types the artifact tables — the runtimes' records on
 * `OBSERVE.records`, by the runtime that declares each: `solid-js`'s
 * `boundary` (a `<Loading>` that waited during a server render) and
 * `recovery` (the client's re-render of a boundary the server handed
 * over); `@solidjs/web`'s `invocation` (a server-function execution),
 * `call` (a server-function call from the browser) and `frame` (a frame
 * stream produced or applied). The engine's own records (`rerun`, `hold`,
 * …) live under `attribution`, not here.
 */
export type ArtifactRecordType = "boundary" | "recovery" | "invocation" | "frame" | "call";

/**
 * What the runtimes recorded on `OBSERVE.records` during the scenario, one
 * table per record type, each in delivery (settle) order and typed as the
 * runtime that emits it types the record (`RecordEvent<K>` — `BoundaryEvent`
 * from `solid-js`, `InvocationEvent`/`CallEvent`/`FrameEvent` from
 * `@solidjs/web`), so a shape change there is a shape change here with no
 * mirror to keep in step. On the server the evidence is waits and calls
 * (`boundary`, `invocation`, the frame's server half); in the browser it is
 * the calls made, the streams applied and the boundaries recovered (`call`,
 * the frame's client half, `recovery`). Joins: `invocation.boundary` →
 * `boundary.id` reads a boundary's wait as the calls it consisted of;
 * `call.id` = `invocation.id` and `frame.id` across `side`s pair the two
 * ends of one request; `recovery.id` = `boundary.id` pairs a handed-over
 * boundary with its client render.
 */
export type ArtifactRecords = {
  [K in ArtifactRecordType]: RecordEvent<K>[];
};

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
 * v8 adds the `recovery` table (the client's `"recovery"` record) and
 * types every table as the emitting runtime types the record.
 */
export interface DiagnosticsArtifact {
  formatVersion: 8;
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
