/**
 * @vitest-environment jsdom
 *
 * The async-gen regression gate: a fixed sample of generated scenarios runs
 * with every suite, and each case's safety and liveness laws are compared to
 * `baseline.json`, the laws that case broke when the baseline was recorded.
 *
 * - A case breaking a law it did not break before fails the suite: a change
 *   broke a neighbouring shape (the fix-on-fix pattern).
 * - A case that no longer breaks a recorded law is reported, not failed; run
 *   with ASYNC_GEN_UPDATE=1 to record the improvement.
 *
 *   ASYNC_GEN_UPDATE=1 npx vitest run test/async-gen/regression.spec.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import fc from "fast-check";
import { runScenario } from "./run.js";
import { describeScenario, scenarioArb } from "./scenario.js";

const SEED = 3289;
const CASES = 1500;
// vitest runs from the package root (jsdom gives import.meta.url no file scheme).
const BASELINE = resolve(process.cwd(), "test/async-gen/baseline.json");

type Baseline = { seed: number; cases: number; failing: Record<string, string[]> };

test(
  `async-gen regression gate: seed ${SEED}, ${CASES} cases against baseline.json`,
  { timeout: 120_000 },
  async () => {
    let baseline: Baseline = { seed: SEED, cases: CASES, failing: {} };
    try {
      baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
    } catch {}
    const failing: Record<string, string[]> = {};
    const regressions: string[] = [];
    const improvements: string[] = [];
    const scenarios = fc.sample(scenarioArb(), { seed: SEED, numRuns: CASES });
    for (let i = 0; i < scenarios.length; i++) {
      (globalThis as any).__SEAT_SHADOW_CASE__ = `seed ${SEED} #${i}`;
      const r = await runScenario(scenarios[i]);
      const laws = [...new Set(r.findings.map(f => `${f.oracle}/${f.law}`))].sort();
      if (laws.length) failing[i] = laws;
      const was = new Set(baseline.failing[i] ?? []);
      for (const law of laws)
        if (!was.has(law))
          regressions.push(
            `#${i} ${law}\n    ${describeScenario(scenarios[i])}\n    ${r.findings.find(f => `${f.oracle}/${f.law}` === law)!.detail.slice(0, 200)}`
          );
      for (const law of was) if (!laws.includes(law)) improvements.push(`#${i} ${law}`);
    }
    if (process.env.ASYNC_GEN_UPDATE) {
      writeFileSync(
        BASELINE,
        JSON.stringify({ seed: SEED, cases: CASES, failing }, null, 2) + "\n"
      );
      return;
    }
    if (improvements.length)
      process.stdout.write(
        `async-gen: ${improvements.length} recorded failures no longer reproduce (ASYNC_GEN_UPDATE=1 to record):\n  ${improvements.join("\n  ")}\n`
      );
    expect(regressions, "cases that newly break a law (see baseline.json)").toEqual([]);
  }
);
