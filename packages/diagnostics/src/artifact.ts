import type { DiagnosticsArtifact } from "./types.js";

export const ARTIFACT_FORMAT_VERSION = 1 as const;

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
      durationMs: artifact.durationMs,
      diagnosticCount: artifact.diagnostics.length,
      rerunCount: artifact.attribution?.reruns.length ?? null
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
  }
  return lines.join("\n") + "\n";
}
