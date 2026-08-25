import {
  DiagnosticsAssertionError,
  expectNoDiagnostics,
  expectNoWaste,
  expectRerunBudget
} from "./assertions.js";
import type { DiagnosticCode, DiagnosticsArtifact } from "./types.js";

/**
 * The machine-checkable definition of done for one scenario. Every field is
 * optional; only stated bounds are enforced.
 */
export interface ScenarioBudget {
  /** Diagnostic codes tolerated for this scenario. */
  allow?: DiagnosticCode[];
  /** Max total re-runs the scenario may cause. */
  maxReruns?: number;
  /** Max unchanged (plain, non-held) recomputes. Default 0 when waste checked. */
  maxWastedRuns?: number;
  /** Max wasted wall time in ms. */
  maxWastedMs?: number;
  /**
   * Per-scope re-run caps. Keys are exact scope names, or regex patterns
   * when written as "/pattern/" (e.g. "/TodoRow/": 1).
   */
  scopes?: Record<string, number>;
}

/** Checked-in budget file: scenario name → budget. CI owns regressions. */
export interface BudgetFile {
  formatVersion: 1;
  scenarios: Record<string, ScenarioBudget>;
}

function scopeMatcher(key: string): string | RegExp {
  if (key.length > 2 && key.startsWith("/") && key.endsWith("/")) {
    return new RegExp(key.slice(1, -1));
  }
  return key;
}

/** Enforce every bound a budget states against a captured artifact. */
export function assertBudget(artifact: DiagnosticsArtifact, budget: ScenarioBudget): void {
  expectNoDiagnostics(artifact, { allow: budget.allow });
  if (budget.maxReruns !== undefined) {
    expectRerunBudget(artifact, budget.maxReruns);
  }
  if (budget.maxWastedRuns !== undefined || budget.maxWastedMs !== undefined) {
    expectNoWaste(artifact, {
      maxWastedRuns: budget.maxWastedRuns,
      maxWastedMs: budget.maxWastedMs
    });
  }
  if (budget.scopes) {
    for (const [key, max] of Object.entries(budget.scopes)) {
      expectRerunBudget(artifact, max, { scope: scopeMatcher(key) });
    }
  }
}

/**
 * Look the artifact's scenario up in a budget file and enforce it. Missing
 * entries fail loudly: an unbudgeted scenario is an unchecked claim.
 */
export function assertBudgetFile(artifact: DiagnosticsArtifact, file: BudgetFile): void {
  const scenario = artifact.scenario;
  if (!scenario) {
    throw new DiagnosticsAssertionError(
      "assertBudgetFile requires the artifact to carry a scenario name " +
        "(pass { scenario } to captureArtifact).",
      []
    );
  }
  const budget = file.scenarios[scenario];
  if (!budget) {
    throw new DiagnosticsAssertionError(
      `No budget defined for scenario "${scenario}". Known scenarios: [${Object.keys(
        file.scenarios
      ).join(", ")}]`,
      []
    );
  }
  assertBudget(artifact, budget);
}

/**
 * Parse and validate budget-file JSON text. Filesystem access is left to the
 * caller so this module stays runtime-agnostic.
 */
export function parseBudgetFile(json: string): BudgetFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(`Budget file is not valid JSON: ${(error as Error).message}`);
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { formatVersion?: unknown }).formatVersion !== 1 ||
    typeof (parsed as { scenarios?: unknown }).scenarios !== "object" ||
    (parsed as { scenarios?: unknown }).scenarios === null
  ) {
    throw new Error(
      'Budget file must be an object of shape { "formatVersion": 1, "scenarios": { ... } }.'
    );
  }
  return parsed as BudgetFile;
}
