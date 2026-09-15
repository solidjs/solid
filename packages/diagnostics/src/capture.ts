import { OBSERVE, flush } from "@solidjs/signals";
import { attribution as engine } from "@solidjs/signals/attribution";
import { ARTIFACT_FORMAT_VERSION } from "./artifact.js";
import type {
  ArtifactServer,
  AttributionOptions,
  DiagnosticsArtifact,
  RerunEvent,
  RerunRecord,
  ServerBoundaryRecord,
  ServerInvocationRecord
} from "./types.js";

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

function toRerunRecord(event: RerunEvent): RerunRecord {
  const { node: _node, ...record } = event;
  return record;
}

// The server runtime's records channel, by the contract every record type
// shares — `subscribe(type, listener)` — read structurally: the members of
// `OBSERVE.server` are declared by `solid-js` and `@solidjs/web`, which this
// package does not depend on, and the slot is empty in a client process.
interface ServerRecordsChannel {
  subscribe(type: string, listener: (event: unknown) => void): () => void;
}

function serverRecords(): ServerRecordsChannel | undefined {
  const server = OBSERVE!.server as { records?: ServerRecordsChannel } | undefined;
  const records = server?.records;
  return records && typeof records.subscribe === "function" ? records : undefined;
}

interface ServerCapture {
  stop(): ArtifactServer;
}

/**
 * Opens the server tables. Records are delivered on settle already
 * serializable (the live handles travel in a second argument this ignores),
 * so the capture is a copy and an append — the record object is shared
 * with every other listener — and the artifact keeps settle order.
 */
function captureServer(channel: ServerRecordsChannel): ServerCapture {
  const boundaries: ServerBoundaryRecord[] = [];
  const invocations: ServerInvocationRecord[] = [];
  const unsubscribe = [
    channel.subscribe("boundary", event => {
      boundaries.push({ ...(event as ServerBoundaryRecord) });
    }),
    channel.subscribe("invocation", event => {
      invocations.push({ ...(event as ServerInvocationRecord) });
    })
  ];
  return {
    stop() {
      for (const off of unsubscribe) off();
      return { boundaries, invocations };
    }
  };
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
  if (useAttribution) {
    // Default log:false — the artifact is the output, not the console.
    const opts: AttributionOptions =
      typeof attributionOption === "object" ? { log: false, ...attributionOption } : { log: false };
    engine.enable(opts);
  }
  // The server tables open whenever the server runtime installed its
  // surface; in a client process there is nothing to subscribe to.
  const channel = serverRecords();
  const server = channel && captureServer(channel);

  const startedAt = new Date();
  const start = performance.now();
  let attribution: DiagnosticsArtifact["attribution"] = null;
  let events: DiagnosticsArtifact["diagnostics"];
  let serverTables: DiagnosticsArtifact["server"] = null;
  let result: T;
  try {
    result = await scenario();
    if (options.autoFlush !== false) flush();
  } finally {
    // Read every table before disable(): aggregates reset on disable.
    if (useAttribution) {
      attribution = {
        reruns: engine.history().map(toRerunRecord),
        costs: engine.costs(),
        holds: [...engine.holds()],
        feedback: engine.feedback()
      };
      engine.disable();
    }
    events = capture.stop();
    if (server) serverTables = server.stop();
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
      attribution,
      server: serverTables
    }
  };
}
