/**
 * Wire protocol between the in-page bridge and out-of-process consumers
 * (the vite plugin's collector/endpoint, MCP tools, test drivers).
 *
 * The vite plugin depends on these types at build time only — the runtime
 * bridge always comes from the app's own copy of this package, so there is
 * no version coupling between the plugin release and the diagnostics
 * release. Shape changes here are contract changes.
 */
import type { BridgeBeginOptions, BridgePayload } from "./browser.js";
import type { AttributionCosts, RerunRecord } from "./types.js";

/** Vite custom-event names carrying requests into the page and back. */
export const DIAGNOSTICS_REQUEST_EVENT = "solid:diagnostics:request";
export const DIAGNOSTICS_RESPONSE_EVENT = "solid:diagnostics:response";

/** Dev-server HTTP endpoint fronting the WS round-trip. */
export const DIAGNOSTICS_ENDPOINT = "/__solid/diagnostics";

export interface DiagnosticsMethods {
  /** Open a capture session (diagnostics + attribution). */
  begin: { params: BridgeBeginOptions; result: true };
  /** Close the session and return the captured payload. */
  end: { params: undefined; result: BridgePayload };
  /** Whether a session is currently open. */
  active: { params: undefined; result: boolean };
  /** Re-runs of one scope (by name) recorded by the open session. */
  whyDidRun: { params: { name: string }; result: RerunRecord[] };
  /** Cost tables of the open session so far, without closing it. */
  costs: { params: undefined; result: AttributionCosts };
}

export type DiagnosticsMethod = keyof DiagnosticsMethods;

export interface DiagnosticsRequest<M extends DiagnosticsMethod = DiagnosticsMethod> {
  id: number;
  method: M;
  params?: DiagnosticsMethods[M]["params"];
}

export type DiagnosticsResponse<M extends DiagnosticsMethod = DiagnosticsMethod> =
  | { id: number; result: DiagnosticsMethods[M]["result"]; error?: undefined }
  | { id: number; error: string; result?: undefined };
