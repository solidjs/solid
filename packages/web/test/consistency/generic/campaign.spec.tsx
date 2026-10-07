/**
 * @vitest-environment jsdom
 *
 * The opt-in property campaign of the GENERIC (frames-free) hydration
 * harness. Off by default; run with
 *
 *   CONSISTENCY_FUZZ=1 [CONSISTENCY_SEED=3289] [CONSISTENCY_CASES=100]
 *   [CONSISTENCY_IGNORE=C19] [CONSISTENCY_MODE=survey|shrink]
 *   npx vitest run --config vite.config.hydrate.mjs test/consistency/generic
 *
 * Same knobs and modes as test/consistency/harness (survey tallies findings
 * by invariant and law; shrink stops on the first finding outside
 * CONSISTENCY_IGNORE and prints the reduced scenario as JSON for
 * replay.spec.tsx).
 */
import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { runScenario } from "./run.js";
import { describeScenario, scenarioArb, type Scenario } from "./scenario.js";
import { loadArtifact } from "./support.js";

const FUZZ = !!process.env.CONSISTENCY_FUZZ;
const SEED = Number(process.env.CONSISTENCY_SEED ?? 3289);
const CASES = Number(process.env.CONSISTENCY_CASES ?? 100);
const IGNORE = new Set((process.env.CONSISTENCY_IGNORE ?? "").split(",").filter(Boolean));
const MODE = process.env.CONSISTENCY_MODE ?? "survey";

const out = (s: string) => process.stdout.write(s + "\n");
const arb = scenarioArb(order => loadArtifact(order).chunks.length);

describe("generic hydration harness", () => {
  test("smoke: the canonical schedule (hydrate, then the chunks) has no finding", async () => {
    const art = loadArtifact("ab");
    const result = await runScenario({
      order: "ab",
      chunks: art.chunks.length,
      events: [
        { t: "hydrate" },
        ...art.chunks.map((_, i) => ({ t: "chunk" as const, i })),
        { t: "tick" }
      ]
    });
    expect(result.findings).toEqual([]);
  });
});

describe.skipIf(!FUZZ)("generic hydration harness campaign", () => {
  test(
    `seed ${SEED}, ${CASES} cases, mode ${MODE}, ignoring [${[...IGNORE].join(",")}]`,
    { timeout: 0 },
    async () => {
      if (MODE === "shrink") {
        try {
          await fc.assert(
            fc.asyncProperty(arb, async scenario => {
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
      const scenarios = fc.sample(arb, { seed: SEED, numRuns: CASES });
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
