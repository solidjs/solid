import type { DiagnosticEvent } from "@solidjs/signals";
import type { Attribution, HoldEvent, RerunEvent } from "@solidjs/signals/attribution";

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
export type AttributionCosts = ReturnType<Attribution["costs"]>;
export type AttributionFeedback = ReturnType<Attribution["feedback"]>;

/**
 * A serializable projection of RerunEvent: everything except the live `node`
 * reference, which is a cyclic graph object that cannot leave the process.
 */
export type RerunRecord = Omit<RerunEvent, "node">;

export interface ArtifactAttribution {
  reruns: RerunRecord[];
  costs: AttributionCosts;
  /** Every hold that staged a root write — what the user waited on. */
  holds: HoldEvent[];
  /** The ranked feedback tables folded from `holds` and the re-runs' interactions. */
  feedback: AttributionFeedback;
}

/**
 * A `<Loading>` boundary that waited during a server render — the server
 * runtime's `"boundary"` record (`solid-js`'s `BoundaryEvent`), as
 * delivered on `OBSERVE.server.records`. Mirrored here rather than
 * imported: this package depends on `@solidjs/signals` alone, and the
 * server surface is `solid-js`'s. The web server suite pins the two shapes
 * to each other at compile time.
 */
export interface ServerBoundaryRecord {
  /** The boundary's hydration id — pairs with `SSR_*` findings and with `ServerInvocationRecord.boundary`. */
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
 * One server function execution — `@solidjs/web`'s `"invocation"` record
 * (`InvocationEvent`), mirrored on the same terms as `ServerBoundaryRecord`.
 */
export interface ServerInvocationRecord {
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
  /** Direct calls: the `<Loading>` boundary whose render pass made the call — a `ServerBoundaryRecord.id`. */
  boundary?: string;
}

/**
 * What the server runtime recorded during the scenario: the two record
 * types on `OBSERVE.server.records`, joined by `invocation.boundary` →
 * `boundary.id`, so a boundary's wait reads as the calls it consisted of.
 */
export interface ArtifactServer {
  /** Every `<Loading>` boundary that waited, in settle (or reveal) order. */
  boundaries: ServerBoundaryRecord[];
  /** Every server function execution, in settle order. */
  invocations: ServerInvocationRecord[];
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
 * `server` (the server runtime's boundary and invocation records).
 */
export interface DiagnosticsArtifact {
  formatVersion: 5;
  /** Human/agent-readable label for the captured scenario. */
  scenario?: string;
  capturedAt: string;
  durationMs: number;
  diagnostics: DiagnosticEvent[];
  /** Null when attribution was disabled for the capture. */
  attribution: ArtifactAttribution | null;
  /**
   * Null when the scenario ran without the server runtime's observe surface
   * (a client or bare-signals capture; the browser bridge). Present — tables
   * possibly empty — whenever `solid-js`'s server entry was loaded.
   */
  server: ArtifactServer | null;
}

export type { DiagnosticEvent, DiagnosticCode, DiagnosticSeverity } from "@solidjs/signals";
