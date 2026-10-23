import { chain } from "./fixtures.js";
import { search, ordinaryKey, SearchBudget } from "./search.js";
import { runScenario } from "./runner.js";
import { shrink } from "./shrink.js";

test("a productive deletion pass does not restart earlier passes on every deletion", async () => {
  const s = chain("sync");
  s.version = 2;
  s.sources = [-1];
  s.anchors = [-1];
  s.anchorShow = false;
  for (let i = 1; i < 8; i++) s.readers.push({ id: i, refs: [-1], gated: false, boundary: "none" });
  const baseline = await runScenario(s);
  const failure = { rule: "test", message: "synthetic persistent reader" };
  const original = { ...baseline, status: "fail" as const, failure };
  const results: {
    reduced: Awaited<ReturnType<typeof shrink>>;
    stats: Record<string, { attempts: number; accepted: number; elapsedMs: number }>;
  }[] = [];
  for (const schedule of ["restart", "sweep"] as const) {
    const stats: Record<string, { attempts: number; accepted: number; elapsedMs: number }> = {};
    const reduced = await shrink(
      original,
      async scenario => ({
        ...baseline,
        scenario,
        status: scenario.readers.length && scenario.anchors?.includes(-1) ? "fail" : "pass",
        failure: scenario.readers.length && scenario.anchors?.includes(-1) ? failure : undefined
      }),
      500,
      { schedule, order: ["anchors", "readers"], stats }
    );
    expect(reduced.result.scenario.readers).toHaveLength(1);
    results.push({ reduced, stats });
  }
  expect(results[1].reduced.attempts).toBeLessThan(results[0].reduced.attempts);
});

test("search counts statically invalid candidates separately and shares execution accounting", async () => {
  const s = chain("sync"),
    limit = new SearchBudget(2);
  const r = await search(
    { scenario: s },
    limit,
    async () => {
      await limit.run(async () => undefined);
      return undefined;
    },
    ordinaryKey,
    { order: ["nodes"] }
  );
  expect(limit.executions).toBeLessThanOrEqual(2);
  expect(r.candidates).toBeGreaterThanOrEqual(limit.executions);
  expect(r.accepted).toBe(0);
});

test("a delivery escape is rolled back unless cleanup removes machinery", async () => {
  const scenario = chain("promise");
  scenario.version = 2;
  scenario.sources = [-1, -2];
  scenario.optimistic = { proposals: [1], authoritative: 0, hold: false };
  scenario.turns = [{ steps: [{ op: "start-action" }] }, { steps: [{ op: "resume-action" }] }];
  const budget = new SearchBudget(20);
  const result = await search(
    { scenario },
    budget,
    async scenario => budget.run(async () => ({ scenario })),
    ordinaryKey,
    { order: ["deliveryEscape"] }
  );
  expect(budget.executions).toBeGreaterThan(0);
  expect(result.accepted).toBe(0);
  expect(result.result.scenario).toBe(scenario);
});
