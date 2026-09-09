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
 * The unit of exchange between a captured run and everything downstream:
 * assertions, budget files, JSONL egress, agent consumption.
 *
 * Format history: v1 carried `attribution.{reruns, costs}`; v2 adds
 * `attribution.{holds, feedback}` (responsiveness evidence).
 */
export interface DiagnosticsArtifact {
  formatVersion: 3;
  /** Human/agent-readable label for the captured scenario. */
  scenario?: string;
  capturedAt: string;
  durationMs: number;
  diagnostics: DiagnosticEvent[];
  /** Null when attribution was disabled for the capture. */
  attribution: ArtifactAttribution | null;
}

export type { DiagnosticEvent, DiagnosticCode, DiagnosticSeverity } from "@solidjs/signals";
