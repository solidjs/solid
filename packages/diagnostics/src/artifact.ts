import { RECORD_TYPES } from "./records.js";
import type { DiagnosticsArtifact } from "./types.js";

export const ARTIFACT_FORMAT_VERSION = 7 as const;

/** Pretty JSON for humans and for checked-in golden files. */
export function serializeArtifact(artifact: DiagnosticsArtifact): string {
  return JSON.stringify(artifact, null, 2);
}

/**
 * JSONL egress for agents: one self-describing record per line so a consumer
 * can grep/stream without parsing the whole artifact. First line is the meta
 * header; every subsequent line carries a `type` discriminator.
 */
export function artifactToJSONL(artifact: DiagnosticsArtifact): string {
  const lines: string[] = [];
  lines.push(
    JSON.stringify({
      type: "meta",
      formatVersion: artifact.formatVersion,
      scenario: artifact.scenario,
      capturedAt: artifact.capturedAt,
      timeOrigin: artifact.timeOrigin,
      durationMs: artifact.durationMs,
      diagnosticCount: artifact.diagnostics.length,
      rerunCount: artifact.attribution?.reruns.length ?? null,
      holdCount: artifact.attribution?.holds.length ?? null,
      recordCounts: Object.fromEntries(
        RECORD_TYPES.map(type => [type, artifact.records[type].length])
      )
    })
  );
  for (const event of artifact.diagnostics) {
    lines.push(JSON.stringify({ type: "diagnostic", ...event }));
  }
  if (artifact.attribution) {
    for (const rerun of artifact.attribution.reruns) {
      lines.push(JSON.stringify({ type: "rerun", ...rerun }));
    }
    lines.push(JSON.stringify({ type: "costs", ...artifact.attribution.costs }));
    for (const hold of artifact.attribution.holds) {
      lines.push(JSON.stringify({ type: "hold", ...hold }));
    }
    lines.push(JSON.stringify({ type: "feedback", ...artifact.attribution.feedback }));
  }
  // One line per record, its table's name as the discriminator — the same
  // name the record rides `OBSERVE.records` under.
  for (const type of RECORD_TYPES) {
    for (const record of artifact.records[type]) {
      lines.push(JSON.stringify({ type, ...record }));
    }
  }
  return lines.join("\n") + "\n";
}
