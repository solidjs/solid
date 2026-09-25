import { OBSERVE, flush } from "@solidjs/signals";
// The folds are named exports: importing them is what turns their accounting on.
import { attribution as engine, costs, feedback } from "@solidjs/signals/attribution";
import { ARTIFACT_FORMAT_VERSION } from "./artifact.js";
import { captureRecords } from "./records.js";
import type { AttributionOptions, DiagnosticsArtifact } from "./types.js";

export interface CaptureOptions {
  /** Label stamped into the artifact meta. */
  scenario?: string;
  /**
   * Attribution posture for this capture. `true` (default) enables it with
   * console logging off; `false` captures diagnostics only; an options
   * object is passed through to the engine's `enable()`
   * (`@solidjs/signals/attribution`).
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

/**
 * Run a scenario with the dev channels open — diagnostics, attribution, the
 * records — and fold what they saw into a single serializable artifact. This is the fixture everything else in this
 * package consumes: assertions take the artifact, egress serializes it,
 * budgets compare against it.
 */
export async function captureArtifact<T>(
  scenario: () => T | Promise<T>,
  options: CaptureOptions = {}
): Promise<CaptureResult<T>> {
  if (!OBSERVE) {
    throw new Error(
      "@solidjs/diagnostics requires a development or observe build of @solidjs/signals: " +
        "the OBSERVE export is undefined in production builds, so there are no " +
        "diagnostic or attribution channels to capture."
    );
  }

  const attributionOption = options.attribution ?? true;
  const useAttribution = attributionOption !== false;

  const capture = OBSERVE.diagnostics.capture();
  // The capture's own hold on the shared engine; releasing it leaves any
  // other consumer's hold (a profiler track, an APM adapter) in place.
  let release: (() => void) | undefined;
  if (useAttribution) {
    // Default log:false — the artifact is the output, not the console.
    const opts: AttributionOptions =
      typeof attributionOption === "object" ? { log: false, ...attributionOption } : { log: false };
    release = engine.enable(opts);
  }
  const records = captureRecords();

  const startedAt = new Date();
  const start = performance.now();
  let attribution: DiagnosticsArtifact["attribution"] = null;
  let events: DiagnosticsArtifact["diagnostics"];
  let tables: DiagnosticsArtifact["records"];
  let result: T;
  try {
    result = await scenario();
    if (options.autoFlush !== false) flush();
  } finally {
    // Read every table before releasing: the last release resets the aggregates.
    if (release) {
      attribution = {
        reruns: [...engine.history("rerun")],
        costs: costs(),
        holds: [...engine.history("hold")],
        feedback: feedback()
      };
      release();
    }
    events = capture.stop();
    tables = records.stop();
  }
  const durationMs = performance.now() - start;

  return {
    result,
    artifact: {
      formatVersion: ARTIFACT_FORMAT_VERSION,
      scenario: options.scenario,
      capturedAt: startedAt.toISOString(),
      timeOrigin: performance.timeOrigin,
      durationMs,
      diagnostics: events,
      attribution,
      records: tables
    }
  };
}
