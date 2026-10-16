import { generate } from "./generate.js";
import { runScenario } from "./runner.js";
import { validate, type Scenario } from "./scenario.js";

function optimistic(delivery: "sync" | "manual" = "sync"): Scenario {
  return {
    version: 2,
    sources: [-1, -2],
    optimistic: { proposals: [1], authoritative: 0 },
    show: true,
    nodes: [{ id: 0, deps: [-2], factor: 2, offset: 0, delivery }],
    readers: [{ id: 0, refs: [-2, 0], gated: false, boundary: "none" }],
    turns: [{ steps: [{ op: "start-action" }] }]
  };
}

test("an open action allows a synchronous optimistic publication then reverts", async () => {
  const r = await runScenario(optimistic());
  expect(r.status, JSON.stringify(r)).toBe("pass");
  expect(r.frames.some(f => f.inputs?.[-2] === 1 && f.outputs[0]?.[1] === 2)).toBe(true);
  expect(r.frames.at(-1)?.inputs).toEqual({ [-1]: 0, [-2]: 0 });
  expect(r.action).toEqual({
    started: true,
    bodyCompleted: true,
    gates: [{ step: 0, state: "resolved" }]
  });
  expect(r.coverage).toContain("optimistic-ready-with-parent-open");
});

test("an observed async optimistic answer may remain pending while its parent is held", async () => {
  const s = optimistic("manual");
  s.turns.push({ steps: [{ op: "resolve", node: 0, which: "newest" }] });
  // The completion callback's scope during corrective async is a separate
  // contract question. This control isolates publication and action lifetime.
  const r = await runScenario(s, { completionProbes: false });
  expect(r.status, JSON.stringify(r)).toBe("pass");
  expect(r.frames.some(f => f.inputs?.[-2] === 1)).toBe(true);
  expect(r.coverage).toContain("optimistic-ready-with-parent-open");
});

test("finite action scripts finish on cleanup even if a work limit stops their first proposal", async () => {
  const s = optimistic("manual");
  s.optimistic!.proposals = [1, 2, 3];
  const r = await runScenario(s, { maxWork: 1 });
  expect(r.status).toBe("limit");
  expect(r.action?.bodyCompleted).toBe(false);
  expect((await runScenario(optimistic())).status).toBe("pass");
});

test("optimistic generation uses valid bounded actions and deterministic replay", async () => {
  for (const s of generate(3330, 30, "optimistic")) {
    expect(validate(s)).toBeUndefined();
    const a = await runScenario(s);
    expect(["pass", "fail", "policy"], JSON.stringify(a)).toContain(a.status);
    const b = await runScenario(a.scenario);
    expect(b.status).toBe(a.status);
    expect(b.failure).toEqual(a.failure);
    expect(b.frames).toEqual(a.frames);
    expect(b.action).toEqual(a.action);
  }
});
