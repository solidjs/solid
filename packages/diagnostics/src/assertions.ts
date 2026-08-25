import type { DiagnosticCode, DiagnosticsArtifact, RerunRecord } from "./types.js";

/**
 * Assertion failures carry the offending records so a test reporter (or an
 * agent reading the failure) sees the evidence, not just the verdict.
 */
export class DiagnosticsAssertionError extends Error {
  constructor(
    message: string,
    readonly evidence: unknown[]
  ) {
    const detail = evidence
      .slice(0, 10)
      .map(record => "  " + JSON.stringify(record))
      .join("\n");
    super(evidence.length > 0 ? `${message}\n${detail}` : message);
    this.name = "DiagnosticsAssertionError";
  }
}

export interface NoDiagnosticsOptions {
  /** Codes to tolerate (known/accepted warnings). */
  allow?: DiagnosticCode[];
}

/** The correctness gate: the capture produced no (unallowed) diagnostics. */
export function expectNoDiagnostics(
  artifact: DiagnosticsArtifact,
  options: NoDiagnosticsOptions = {}
): void {
  const allow = new Set(options.allow ?? []);
  const offending = artifact.diagnostics.filter(event => !allow.has(event.code));
  if (offending.length > 0) {
    throw new DiagnosticsAssertionError(
      `Expected no diagnostics but captured ${offending.length}:`,
      offending
    );
  }
}

/** Positive form: the scenario should trip a specific rule. */
export function expectDiagnostic(
  artifact: DiagnosticsArtifact,
  code: DiagnosticCode,
  options: { count?: number } = {}
): void {
  const matches = artifact.diagnostics.filter(event => event.code === code);
  if (matches.length === 0) {
    throw new DiagnosticsAssertionError(
      `Expected diagnostic ${code} but none was captured. Captured codes: [${artifact.diagnostics
        .map(event => event.code)
        .join(", ")}]`,
      []
    );
  }
  if (options.count !== undefined && matches.length !== options.count) {
    throw new DiagnosticsAssertionError(
      `Expected diagnostic ${code} exactly ${options.count} time(s) but captured ${matches.length}:`,
      matches
    );
  }
}

function requireAttribution(artifact: DiagnosticsArtifact, caller: string): RerunRecord[] {
  if (!artifact.attribution) {
    throw new DiagnosticsAssertionError(
      `${caller} requires attribution data, but the artifact was captured with attribution disabled.`,
      []
    );
  }
  return artifact.attribution.reruns;
}

export interface RerunBudgetOptions {
  /** Only count re-runs of scopes whose name matches. */
  scope?: string | RegExp;
}

/**
 * The efficiency gate: the scenario caused at most `max` re-runs. This is
 * the assertion that turns "the port works" into "the port is granular" —
 * an agent asserts the exact update cardinality instead of eyeballing it.
 */
export function expectRerunBudget(
  artifact: DiagnosticsArtifact,
  max: number,
  options: RerunBudgetOptions = {}
): void {
  let reruns = requireAttribution(artifact, "expectRerunBudget");
  if (options.scope !== undefined) {
    const scope = options.scope;
    reruns =
      typeof scope === "string"
        ? reruns.filter(rerun => rerun.nodeName === scope)
        : reruns.filter(rerun => scope.test(rerun.nodeName));
  }
  if (reruns.length > max) {
    throw new DiagnosticsAssertionError(
      `Expected at most ${max} re-run(s)${
        options.scope !== undefined ? ` for scope ${String(options.scope)}` : ""
      } but attribution recorded ${reruns.length}:`,
      reruns.map(rerun => ({
        run: rerun.run,
        nodeName: rerun.nodeName,
        nodeKind: rerun.nodeKind,
        changed: rerun.changed,
        causes: rerun.causes.map(cause => cause.name)
      }))
    );
  }
}

export interface WasteBudgetOptions {
  /** Tolerated wasted wall time in ms (default: unbounded — count gates). */
  maxWastedMs?: number;
  /** Tolerated count of wasted runs (default 0). */
  maxWastedRuns?: number;
}

/**
 * No-waste gate: no plain, non-held run recomputed to an unchanged value.
 * Overlay (optimistic/transition) and held runs are excluded by the same
 * rules attribution itself uses for `wastedMs`.
 */
export function expectNoWaste(
  artifact: DiagnosticsArtifact,
  options: WasteBudgetOptions = {}
): void {
  const reruns = requireAttribution(artifact, "expectNoWaste");
  const wasted = reruns.filter(rerun => !rerun.changed && rerun.phase === "plain" && !rerun.held);
  const wastedMs = wasted.reduce((total, rerun) => total + rerun.selfMs, 0);
  const maxRuns = options.maxWastedRuns ?? 0;
  const maxMs = options.maxWastedMs ?? Infinity;
  if (wasted.length > maxRuns || wastedMs > maxMs) {
    throw new DiagnosticsAssertionError(
      `Expected no wasted re-runs but attribution recorded ${wasted.length} ` +
        `(${wastedMs.toFixed(3)}ms of unchanged recomputes):`,
      wasted.map(rerun => ({
        run: rerun.run,
        nodeName: rerun.nodeName,
        nodeKind: rerun.nodeKind,
        selfMs: rerun.selfMs,
        causes: rerun.causes.map(cause => cause.name)
      }))
    );
  }
}
