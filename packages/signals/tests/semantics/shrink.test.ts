import { chain } from "./fixtures.js";
import { shrink } from "./shrink.js";
import { runScenario } from "./runner.js";

test("a rejected candidate at the attempt budget does not count an unexecuted attempt", async () => {
  const baseline = await runScenario(chain("sync"));
  const original = {
    ...baseline,
    status: "fail" as const,
    failure: { rule: "test", message: "synthetic reducer target" }
  };
  const run = vi.fn(async () => ({ ...baseline, status: "invalid" as const }));
  const reduced = await shrink(original, run, 1);
  expect(run).toHaveBeenCalledTimes(1);
  expect(reduced.attempts).toBe(1);
  expect(reduced.accepted).toBe(0);
});

test("a shrink search never executes the same candidate twice", async () => {
  const s = chain("sync");
  s.readers.push({ id: 1, refs: [-1], gated: false, boundary: "none" });
  const baseline = await runScenario(s);
  const failure = { rule: "test", message: "duplicate search" };
  const original = { ...baseline, status: "fail" as const, failure };
  const inputs = new Set<string>();
  const run = async (scenario: typeof s) => {
    const key = JSON.stringify(scenario);
    expect(inputs.has(key)).toBe(false);
    inputs.add(key);
    return {
      ...baseline,
      scenario,
      status: scenario.readers.length ? ("fail" as const) : ("pass" as const),
      failure: scenario.readers.length ? failure : undefined
    };
  };
  const reduced = await shrink(original, run, 100);
  expect(reduced.accepted).toBeGreaterThan(1);
  expect(reduced.duplicates).toBeGreaterThan(0);
  expect(reduced.attempts).toBe(inputs.size);
});

test("a passing control prevents a reduction from losing the distinguishing behavior", async () => {
  const s = chain("sync");
  s.readers[0].boundary = "retain";
  const baseline = await runScenario(s);
  const failure = { rule: "test", message: "same symptom with a different cause" };
  const original = { ...baseline, status: "fail" as const, failure };
  let calls = 0;
  const run = async (scenario: typeof s) => {
    calls++;
    return { ...original, scenario };
  };
  const control = async (scenario: typeof s) => {
    calls++;
    const pass = scenario.readers.some(r => r.boundary === "retain");
    return {
      ...baseline,
      scenario,
      status: pass ? ("pass" as const) : ("fail" as const),
      failure: pass ? undefined : failure
    };
  };
  const reduced = await shrink(original, run, 60, { control });
  expect(reduced.result.scenario.readers.some(r => r.boundary === "retain")).toBe(true);
  expect(reduced.controlAttempts).toBeGreaterThan(1);
  expect(reduced.attempts).toBe(calls);
  expect(calls).toBeLessThanOrEqual(60);
});

test("control checks share the budget and reject an invalid baseline comparison", async () => {
  const baseline = await runScenario(chain("sync"));
  const original = {
    ...baseline,
    status: "fail" as const,
    failure: { rule: "test", message: "held" }
  };
  const run = vi.fn(async () => original);
  const control = vi.fn(async () => baseline);
  const reduced = await shrink(original, run, 1, { control });
  expect(run).not.toHaveBeenCalled();
  expect(control).toHaveBeenCalledTimes(1);
  expect(reduced.attempts).toBe(1);
  expect(reduced.accepted).toBe(0);
  await expect(shrink(original, run, 1, { control: async () => original })).rejects.toThrow(
    "clean pass"
  );
});

test("a matching trial is not accepted when the budget cannot verify its control", async () => {
  const baseline = await runScenario(chain("sync"));
  const original = {
    ...baseline,
    status: "fail" as const,
    failure: { rule: "test", message: "held" }
  };
  const run = vi.fn(async (scenario: typeof baseline.scenario) => ({ ...original, scenario }));
  const control = vi.fn(async () => baseline);
  const reduced = await shrink(original, run, 2, { control });
  expect(run).toHaveBeenCalledTimes(1);
  expect(control).toHaveBeenCalledTimes(1);
  expect(reduced.attempts).toBe(2);
  expect(reduced.accepted).toBe(0);
  expect(reduced.result).toBe(original);
});

test("repro keys join alpha-renamed failures without merging different schedules", async () => {
  const s = chain("sync");
  const baseline = await runScenario(s);
  const original = {
    ...baseline,
    status: "fail" as const,
    failure: { rule: "test", message: "same execution" }
  };
  const renamed = structuredClone(baseline.scenario);
  renamed.nodes[0].id = 10;
  renamed.nodes[1].id = 20;
  renamed.nodes[1].deps = [10];
  renamed.readers[0].id = 30;
  renamed.readers[0].refs = [-1, 20];
  const run = vi.fn(async () => original);
  const a = await shrink(original, run, 0);
  const b = await shrink({ ...original, scenario: renamed }, run, 0);
  expect(a.reproKey).toBe(b.reproKey);
  renamed.turns.push({ steps: [] });
  const c = await shrink({ ...original, scenario: renamed }, run, 0);
  expect(c.reproKey).not.toBe(a.reproKey);
  expect(run).not.toHaveBeenCalled();
});
