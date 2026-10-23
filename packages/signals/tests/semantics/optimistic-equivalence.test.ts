import { chain } from "./fixtures.js";
import { generate } from "./generate.js";
import { runEquivalence, shrinkEquivalence, variants } from "./equivalence.js";
import { runScenario } from "./runner.js";

test.each(["sync", "manual", "promise", "await"] as const)(
  "a %s derivation has the same publication for a held optimistic proposal",
  async delivery => {
    const pair = await runEquivalence(chain(delivery), runScenario, "optimistic");
    expect(pair.result.status, JSON.stringify(pair)).toBe("pass");
    expect(pair.pair[1].action?.bodyCompleted).toBe(false);
    expect(pair.pair[1].action?.gates).toEqual([{ step: 0, state: "waiting" }]);
    expect(pair.pair[1].frames.at(-1)?.inputs?.[-2]).toBe(1);
    expect(pair.pair[1].coverage).toContain("completion-with-parent-held");
  }
);

test("generated ordinary/optimistic pairs validate, reduce and replay", async () => {
  for (const s of generate(3289, 30)) {
    const a = await runEquivalence(s, runScenario, "optimistic");
    const b = await runEquivalence(a.scenario, runScenario, "optimistic");
    expect(["pass", "fail", "policy"], JSON.stringify(a)).toContain(a.result.status);
    expect(b.signature).toBe(a.signature);
    expect(b.pair.map(r => r.frames)).toEqual(a.pair.map(r => r.frames));
  }
});

test("paired reduction preserves an optimistic-only publication difference", async () => {
  const s = chain("sync");
  const run: typeof runScenario = async s => {
    const r = await runScenario(s);
    // Calibrate the comparison/reducer independently of the runtime assertions.
    if (s.optimistic && r.frames.length) r.frames.at(-1)!.outputs[0] = [99];
    return r;
  };
  const original = await runEquivalence(s, run, "optimistic");
  expect(original.result.failure?.rule).toBe("E5");
  const reduced = await shrinkEquivalence(s, run, 30, "optimistic");
  expect(reduced.accepted).toBeGreaterThan(0);
  expect((await runEquivalence(reduced.scenario, run, "optimistic")).signature).toBe(
    original.signature
  );
  expect((await runEquivalence(reduced.scenario, runScenario, "optimistic")).result.status).toBe(
    "pass"
  );
  expect(variants(reduced.scenario, "optimistic")[1].optimistic?.hold).toBe(true);
});
