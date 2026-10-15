/**
 * @vitest-environment jsdom
 *
 * The opt-in property campaign. Off by default; run with
 *
 *   CONSISTENCY_FUZZ=1 [CONSISTENCY_SEED=3289] [CONSISTENCY_CASES=100]
 *   [CONSISTENCY_IGNORE=C3,C2] [CONSISTENCY_MODE=survey|shrink]
 *   npx vitest run --config vite.config.hydrate.mjs test/consistency/harness
 *
 * `survey` (the default) runs every case and tallies findings by invariant
 * and law without stopping — the campaign table. `shrink` fails on the
 * first case with a finding outside `CONSISTENCY_IGNORE` and lets
 * fast-check reduce it; the minimal scenario prints as JSON for
 * `replay.spec.tsx`.
 */
import { describe, test } from "vitest";
import fc from "fast-check";
import { runScenario } from "./run.js";
import { describeScenario, scenarioArb, type Scenario } from "./scenario.js";

const FUZZ = !!process.env.CONSISTENCY_FUZZ;
const SEED = Number(process.env.CONSISTENCY_SEED ?? 3289);
const CASES = Number(process.env.CONSISTENCY_CASES ?? 100);
const IGNORE = new Set((process.env.CONSISTENCY_IGNORE ?? "").split(",").filter(Boolean));
const MODE = process.env.CONSISTENCY_MODE ?? "survey";

const out = (s: string) => process.stdout.write(s + "\n");

describe.skipIf(!FUZZ)("consistency harness campaign", () => {
  test(
    `seed ${SEED}, ${CASES} cases, mode ${MODE}, ignoring [${[...IGNORE].join(",")}]`,
    { timeout: 0 },
    async () => {
      if (MODE === "shrink") {
        try {
          await fc.assert(
            fc.asyncProperty(scenarioArb, async scenario => {
              const result = await runScenario(scenario);
              const real = result.findings.filter(f => !IGNORE.has(f.id));
              if (real.length) {
                const f = real[0];
                throw new Error(
                  `${f.id} ${f.law} @${f.step}: ${f.detail}\n${result.description}\n${JSON.stringify(scenario)}`
                );
              }
            }),
            { seed: SEED, numRuns: CASES, endOnFailure: true }
          );
          out(`campaign: seed ${SEED}, ${CASES} cases, no finding outside [${[...IGNORE]}]`);
        } catch (e: any) {
          out(String(e && e.message));
          throw e;
        }
        return;
      }
      // survey
      const scenarios = fc.sample(scenarioArb, { seed: SEED, numRuns: CASES });
      const tally = new Map<string, { count: number; first: Scenario; firstDetail: string }>();
      let failing = 0;
      for (const scenario of scenarios) {
        const result = await runScenario(scenario);
        const real = result.findings.filter(f => !IGNORE.has(f.id));
        if (real.length) failing++;
        const seen = new Set<string>();
        for (const f of real) {
          const key = `${f.id} ${f.law}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const t = tally.get(key);
          if (t) t.count++;
          else tally.set(key, { count: 1, first: scenario, firstDetail: f.detail });
        }
      }
      out(`campaign survey: seed ${SEED}, ${CASES} cases, ${failing} with findings`);
      for (const [key, t] of [...tally].sort((a, b) => b[1].count - a[1].count)) {
        out(`  ${key}: ${t.count} cases — e.g. ${t.firstDetail}`);
        out(`    ${describeScenario(t.first)}`);
        out(`    ${JSON.stringify(t.first)}`);
      }
    }
  );
});
