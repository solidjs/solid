import { chain } from "./fixtures.js";
import { runScenario } from "./runner.js";
import { runEquivalence, shrinkEquivalence } from "./equivalence.js";
import type { Scenario } from "./scenario.js";

test("paired reduction preserves the failing delivery and removes unused graph structure", async () => {
  const s = chain();
  s.nodes.push({ id: 2, deps: [-1], factor: 1, offset: 0, delivery: "sync" });
  // A fake lost publication calibrates the reducer, not Solid. Actual runtime
  // mutation detection is independently covered in calibration.test.ts.
  const run = async (scenario: Scenario) => {
    const r = await runScenario(scenario);
    if (scenario.nodes.some(n => n.id === 0 && n.delivery === "await"))
      r.frames = r.frames.slice(0, 1);
    return r;
  };
  const original = await runEquivalence(s, run);
  expect(original.signature).toContain("sync-await: E3");
  const reduced = await shrinkEquivalence(s, run);
  expect(reduced.signature).toBe(original.signature);
  expect(reduced.accepted).toBeGreaterThan(0);
  expect(reduced.scenario.nodes.some(n => n.id === 2)).toBe(false);
  expect((await runEquivalence(reduced.scenario, run)).signature).toBe(original.signature);
  expect((await runEquivalence(reduced.scenario, runScenario)).result.status).toBe("pass");
});

test("paired reduction budgets interpreter executions and never runs a partial comparison", async () => {
  const s = chain();
  const run = async (scenario: Scenario) => {
    const r = await runScenario(scenario);
    return scenario.nodes[0]?.delivery === "await"
      ? { ...r, status: "fail" as const, failure: { rule: "test", message: "await failure" } }
      : r;
  };
  const reduced = await shrinkEquivalence(s, run, 1);
  expect(reduced.attempts).toBe(0);
  expect(reduced.initialExecutions).toBe(3);
  expect(reduced.signature).toContain("variant-2");
  const complete = await shrinkEquivalence(s, run, 3);
  expect(complete.attempts).toBe(3);
  expect(complete.signature).toContain("variant-2");
});

test("paired comparison retains a waived finding from an otherwise passing variant", async () => {
  const run = async (scenario: Scenario) => {
    const r = await runScenario(scenario);
    if (scenario.nodes[0]?.delivery === "sync")
      r.progress = [
        {
          failure: { rule: "P1", message: "synthetic progress finding" },
          outstanding: [],
          allowance: "legacy-disposal-wait"
        }
      ];
    return r;
  };
  const paired = await runEquivalence(chain(), run);
  expect(paired.result.status).toBe("pass");
  expect(paired.signature).toContain("variant-0: P1");
  expect(paired.result.progress?.[0].allowance).toBe("legacy-disposal-wait");
  const failing = await runEquivalence(chain(), async s => {
    const r = await run(s);
    if (s.nodes[0]?.delivery === "await") {
      r.status = "fail";
      r.failure = { rule: "S1", message: "synthetic inconsistency" };
    }
    return r;
  });
  expect(failing.signature).toContain("variant-2: S1");
});

test("discovery can export a real variant failure as an ordinary reduced scenario", async () => {
  const run = async (s: Scenario) => {
    const result = await runScenario(s);
    return s.nodes.some(n => n.delivery === "await")
      ? {
          ...result,
          status: "fail" as const,
          failure: { rule: "L1", message: "lost final answer" }
        }
      : result;
  };
  const reduced = await shrinkEquivalence(chain(), run, 30);
  expect(reduced.single).toBe(true);
  expect(reduced.signature).toBe("L1: lost final answer");
  expect(reduced.pair).toEqual([]);
  expect((await run(reduced.scenario)).failure?.rule).toBe("L1");
  expect(reduced.attempts).toBeLessThanOrEqual(30);
  const focused = await shrinkEquivalence(chain(), run, 10, "delivery", { mode: "focused" });
  expect(focused.single).toBe(false);
  expect(focused.signature).toContain("variant-2: L1");
});

test("standalone latest failure retains only its side's exact request choices", async () => {
  const s = chain("manual");
  s.turns.push({
    steps: [
      { op: "resolve", node: 0, which: "newest", variantKeys: [null, null] },
      { op: "read", ref: -1, mode: "latest" }
    ]
  });
  const run = async (scenario: Scenario) => {
    const r = await runScenario(scenario);
    return scenario.warmLatest?.length
      ? {
          ...r,
          status: "fail" as const,
          failure: { rule: "L1", message: "synthetic warm failure" }
        }
      : r;
  };
  // Zero budget isolates paired-to-standalone export from later pruning.
  const reduced = await shrinkEquivalence(s, run, 0, "latest");
  expect(reduced.single).toBe(true);
  expect(reduced.scenario.warmLatest).toEqual([-1]);
  expect(JSON.stringify(reduced.scenario)).not.toContain("variantKeys");
  expect(reduced.scenario.turns.at(-1)).toMatchObject({ steps: [{ op: "noop" }, { op: "read" }] });
  expect((await run(reduced.scenario)).failure).toEqual(reduced.result.failure);
});
