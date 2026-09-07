import type { Dev, DiagnosticEvent } from "@solidjs/signals";

/**
 * The attribution surface and its record types are not exported from the
 * signals index (only `Dev` is), so we derive them structurally. This keeps
 * the harness zero-footprint on the signals export surface while staying
 * type-locked to it: if attribution's shape changes, these break at compile
 * time here rather than silently at runtime.
 */
export type Attribution = Dev["attribution"];
export type AttributionOptions = NonNullable<Parameters<Attribution["enable"]>[0]>;
export type RerunEvent = ReturnType<Attribution["history"]>[number];
export type AttributionCosts = ReturnType<Attribution["costs"]>;
export type ScopeCost = AttributionCosts["scopes"][number];
export type WriteCost = AttributionCosts["writes"][number];
export type ChangeRecord = RerunEvent["causes"][number];
export type ChangeOrigin = NonNullable<ChangeRecord["origin"]>;
/** A settled transition hold that staged a root write — already serializable (no live nodes). */
export type HoldEvent = ReturnType<Attribution["holds"]>[number];
export type AttributionFeedback = ReturnType<Attribution["feedback"]>;
export type FeedbackSource = AttributionFeedback["sources"][number];
export type FeedbackInteraction = AttributionFeedback["interactions"][number];

/**
 * A serializable projection of RerunEvent: everything except the live `node`
 * reference, which is a cyclic graph object that cannot leave the process.
 */
export type RerunRecord = Omit<RerunEvent, "node">;

export interface ArtifactAttribution {
  reruns: RerunRecord[];
  costs: AttributionCosts;
  /** Every transition hold that staged a root write — what the user waited on. */
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
  formatVersion: 2;
  /** Human/agent-readable label for the captured scenario. */
  scenario?: string;
  capturedAt: string;
  durationMs: number;
  diagnostics: DiagnosticEvent[];
  /** Null when attribution was disabled for the capture. */
  attribution: ArtifactAttribution | null;
}

export type { DiagnosticEvent, DiagnosticCode, DiagnosticSeverity } from "@solidjs/signals";
