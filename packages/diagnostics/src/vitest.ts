import { expect } from "vitest";
import {
  DiagnosticsAssertionError,
  expectDiagnostic,
  expectNoDiagnostics,
  expectNoWaste,
  expectRerunBudget
} from "./assertions.js";
import { assertBudget } from "./budgets.js";
import type { ScenarioBudget } from "./budgets.js";
import type { NoDiagnosticsOptions, RerunBudgetOptions, WasteBudgetOptions } from "./assertions.js";
import type { DiagnosticCode, DiagnosticsArtifact } from "./types.js";

interface MatcherResult {
  pass: boolean;
  message: () => string;
}

function runAssertion(check: () => void, negatedMessage: string): MatcherResult {
  try {
    check();
    return { pass: true, message: () => negatedMessage };
  } catch (error) {
    if (error instanceof DiagnosticsAssertionError) {
      const message = error.message;
      return { pass: false, message: () => message };
    }
    throw error;
  }
}

expect.extend({
  toHaveNoDiagnostics(artifact: DiagnosticsArtifact, options?: NoDiagnosticsOptions) {
    return runAssertion(
      () => expectNoDiagnostics(artifact, options),
      "Expected diagnostics to be captured, but there were none (outside the allow list)."
    );
  },
  toHaveDiagnostic(
    artifact: DiagnosticsArtifact,
    code: DiagnosticCode,
    options?: { count?: number }
  ) {
    return runAssertion(
      () => expectDiagnostic(artifact, code, options),
      `Expected diagnostic ${code} not to be captured, but it was.`
    );
  },
  toStayWithinRerunBudget(
    artifact: DiagnosticsArtifact,
    max: number,
    options?: RerunBudgetOptions
  ) {
    return runAssertion(
      () => expectRerunBudget(artifact, max, options),
      `Expected more than ${max} re-run(s), but the budget held.`
    );
  },
  toHaveNoWaste(artifact: DiagnosticsArtifact, options?: WasteBudgetOptions) {
    return runAssertion(
      () => expectNoWaste(artifact, options),
      "Expected wasted re-runs, but there were none."
    );
  },
  toStayWithinBudget(artifact: DiagnosticsArtifact, budget: ScenarioBudget) {
    return runAssertion(
      () => assertBudget(artifact, budget),
      "Expected the budget to be exceeded, but it held."
    );
  }
});

interface DiagnosticsMatchers<R = unknown> {
  toHaveNoDiagnostics(options?: NoDiagnosticsOptions): R;
  toHaveDiagnostic(code: DiagnosticCode, options?: { count?: number }): R;
  toStayWithinRerunBudget(max: number, options?: RerunBudgetOptions): R;
  toHaveNoWaste(options?: WasteBudgetOptions): R;
  toStayWithinBudget(budget: ScenarioBudget): R;
}

declare module "vitest" {
  interface Matchers<T = any> extends DiagnosticsMatchers<T> {}
}
