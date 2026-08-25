/**
 * Client-side bridge: runs inside the app page (dev build) and exposes
 * capture control on a well-known global so an out-of-process driver
 * (Playwright adapter, and later the vite-plugin WS collector) can operate
 * the same channels `captureArtifact` uses in-process.
 *
 * This module must be bundled WITH the app — it needs the app's own
 * `@solidjs/signals` instance. Import it from your dev entry (or let the
 * vite plugin inject it) and call `installDiagnosticsBridge()`.
 */
import { DEV, flush } from "@solidjs/signals";
import type {
  AttributionCosts,
  AttributionOptions,
  DiagnosticsArtifact,
  RerunEvent,
  RerunRecord
} from "./types.js";

export const BRIDGE_GLOBAL = "__SOLID_DIAGNOSTICS__";

export interface BridgeBeginOptions {
  attribution?: boolean | AttributionOptions;
}

/** The serializable half of an artifact — assembled into a full one Node-side. */
export interface BridgePayload {
  capturedAt: string;
  durationMs: number;
  diagnostics: DiagnosticsArtifact["diagnostics"];
  attribution: DiagnosticsArtifact["attribution"];
}

export interface DiagnosticsBridge {
  begin(options?: BridgeBeginOptions): void;
  end(): BridgePayload;
  active(): boolean;
  /** Re-runs of one scope (by name) recorded by the open session. */
  whyDidRun(name: string): RerunRecord[];
  /** Cost tables of the open session so far, without closing it. */
  costs(): AttributionCosts;
}

/**
 * Force a value through the same constraints as a page boundary: drops
 * functions, cycles, and host objects so `page.evaluate` transfer can never
 * fail after a capture succeeded.
 */
function toSerializable<T>(value: T): T {
  const seen = new WeakSet<object>();
  return JSON.parse(
    JSON.stringify(value, (_key, entry) => {
      if (typeof entry === "function" || typeof entry === "symbol") return undefined;
      if (typeof entry === "bigint") return String(entry);
      if (typeof entry === "object" && entry !== null) {
        if (seen.has(entry)) return undefined;
        seen.add(entry);
      }
      return entry;
    })
  );
}

export function installDiagnosticsBridge(
  target: Record<string, unknown> = globalThis as unknown as Record<string, unknown>
): DiagnosticsBridge {
  if (!DEV) {
    throw new Error(
      "@solidjs/diagnostics/browser requires a development build of @solidjs/signals: " +
        "the DEV export is undefined in production builds."
    );
  }

  interface Session {
    capture: ReturnType<NonNullable<typeof DEV>["diagnostics"]["capture"]>;
    useAttribution: boolean;
    startedAt: Date;
    start: number;
  }
  let session: Session | null = null;

  const bridge: DiagnosticsBridge = {
    begin(options = {}) {
      if (session) {
        throw new Error("Diagnostics bridge capture already active; call end() first.");
      }
      const attributionOption = options.attribution ?? true;
      const useAttribution = attributionOption !== false;
      const capture = DEV!.diagnostics.capture();
      if (useAttribution) {
        const opts: AttributionOptions =
          typeof attributionOption === "object"
            ? { log: false, ...attributionOption }
            : { log: false };
        DEV!.attribution.enable(opts);
      }
      session = { capture, useAttribution, startedAt: new Date(), start: performance.now() };
    },
    end() {
      if (!session) {
        throw new Error("Diagnostics bridge capture not active; call begin() first.");
      }
      const active = session;
      session = null;
      // Drain scheduled work so trailing writes are attributed to the capture.
      flush();
      let attribution: DiagnosticsArtifact["attribution"] = null;
      if (active.useAttribution) {
        attribution = {
          reruns: DEV!.attribution
            .history()
            .map(({ node: _node, ...record }: RerunEvent) => record),
          costs: DEV!.attribution.costs()
        };
        DEV!.attribution.disable();
      }
      const events = active.capture.stop();
      return toSerializable({
        capturedAt: active.startedAt.toISOString(),
        durationMs: performance.now() - active.start,
        diagnostics: events,
        attribution
      });
    },
    active() {
      return session !== null;
    },
    whyDidRun(name) {
      requireAttributionSession("whyDidRun");
      return toSerializable(
        DEV!.attribution
          .history()
          .filter(event => event.nodeName === name)
          .map(({ node: _node, ...record }: RerunEvent) => record)
      );
    },
    costs() {
      requireAttributionSession("costs");
      return toSerializable(DEV!.attribution.costs());
    }
  };

  function requireAttributionSession(caller: string): void {
    if (!session) {
      throw new Error(
        `Diagnostics bridge ${caller}() requires an open session; call begin() first.`
      );
    }
    if (!session.useAttribution) {
      throw new Error(
        `Diagnostics bridge ${caller}() requires attribution; the open session was begun with attribution disabled.`
      );
    }
  }

  target[BRIDGE_GLOBAL] = bridge;
  return bridge;
}
