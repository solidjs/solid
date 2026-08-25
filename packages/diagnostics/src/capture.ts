import { DEV, flush } from "@solidjs/signals";
import { ARTIFACT_FORMAT_VERSION } from "./artifact.js";
import type { AttributionOptions, DiagnosticsArtifact, RerunEvent, RerunRecord } from "./types.js";

export interface CaptureOptions {
  /** Label stamped into the artifact meta. */
  scenario?: string;
  /**
   * Attribution posture for this capture. `true` (default) enables it with
   * console logging off; `false` captures diagnostics only; an options
   * object is passed through to `DEV.attribution.enable()`.
   */
  attribution?: boolean | AttributionOptions;
  /**
   * Flush the reactive queue after the scenario returns (default true), so
   * work scheduled by the scenario's last writes is attributed to it.
   */
  autoFlush?: boolean;
}

export interface CaptureResult<T> {
  result: T;
  artifact: DiagnosticsArtifact;
}

function toRerunRecord(event: RerunEvent): RerunRecord {
  const { node: _node, ...record } = event;
  return record;
}

/**
 * Run a scenario with both dev channels open and fold what they saw into a
 * single serializable artifact. This is the fixture everything else in this
 * package consumes: assertions take the artifact, egress serializes it,
 * budgets compare against it.
 */
export async function captureArtifact<T>(
  scenario: () => T | Promise<T>,
  options: CaptureOptions = {}
): Promise<CaptureResult<T>> {
  if (!DEV) {
    throw new Error(
      "@solidjs/diagnostics requires a development build of @solidjs/signals: " +
        "the DEV export is undefined in production builds, so there are no " +
        "diagnostic or attribution channels to capture."
    );
  }

  const attributionOption = options.attribution ?? true;
  const useAttribution = attributionOption !== false;

  const capture = DEV.diagnostics.capture();
  if (useAttribution) {
    // Default log:false — the artifact is the output, not the console.
    const opts: AttributionOptions =
      typeof attributionOption === "object" ? { log: false, ...attributionOption } : { log: false };
    DEV.attribution.enable(opts);
  }

  const startedAt = new Date();
  const start = performance.now();
  let attribution: DiagnosticsArtifact["attribution"] = null;
  let events: DiagnosticsArtifact["diagnostics"];
  let result: T;
  try {
    result = await scenario();
    if (options.autoFlush !== false) flush();
  } finally {
    // Read history/costs before disable(): aggregates reset on disable.
    if (useAttribution) {
      attribution = {
        reruns: DEV.attribution.history().map(toRerunRecord),
        costs: DEV.attribution.costs()
      };
      DEV.attribution.disable();
    }
    events = capture.stop();
  }
  const durationMs = performance.now() - start;

  return {
    result,
    artifact: {
      formatVersion: ARTIFACT_FORMAT_VERSION,
      scenario: options.scenario,
      capturedAt: startedAt.toISOString(),
      durationMs,
      diagnostics: events,
      attribution
    }
  };
}
