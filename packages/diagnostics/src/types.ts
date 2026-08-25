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

/**
 * A serializable projection of RerunEvent: everything except the live `node`
 * reference, which is a cyclic graph object that cannot leave the process.
 */
export type RerunRecord = Omit<RerunEvent, "node">;

export interface ArtifactAttribution {
  reruns: RerunRecord[];
  costs: AttributionCosts;
}

/**
 * The unit of exchange between a captured run and everything downstream:
 * assertions, budget files, JSONL egress, agent consumption.
 */
export interface DiagnosticsArtifact {
  formatVersion: 1;
  /** Human/agent-readable label for the captured scenario. */
  scenario?: string;
  capturedAt: string;
  durationMs: number;
  diagnostics: DiagnosticEvent[];
  /** Null when attribution was disabled for the capture. */
  attribution: ArtifactAttribution | null;
}

export type { DiagnosticEvent, DiagnosticCode, DiagnosticSeverity } from "@solidjs/signals";
