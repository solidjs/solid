import { generate } from "./generate.js";
import { runScenario } from "./runner.js";
import { ancestors, evaluate, validate, type Scenario } from "./scenario.js";
import { reductions } from "./shrink.js";

function branching(): Scenario {
  return {
    version: 2,
    sources: [-1, -2],
    show: true,
    nodes: [
      { id: 0, deps: [-1], factor: 2, offset: 0, delivery: "sync" },
      { id: 1, deps: [-2], factor: 1, offset: 10, delivery: "sync" },
      {
        id: 2,
        deps: [0],
        branch: { condition: -2, otherwise: [1] },
        factor: 1,
        offset: 0,
        delivery: "sync"
      }
    ],
    readers: [{ id: 0, refs: [-1, -2, 2], gated: false, boundary: "none" }],
    turns: [
      { steps: [{ op: "write", source: -1, value: 2 }] },
      { steps: [{ op: "write", source: -2, value: 1 }] },
      { steps: [{ op: "write", source: -2, value: 0 }] }
    ]
  };
}

test("pure branch requirements include the selector and only the chosen path", () => {
  const s = branching();
  const off = evaluate(s, 2, { [-1]: 2, [-2]: 0 });
  const on = evaluate(s, 2, { [-1]: 2, [-2]: 1 });
  expect(off.get(2)).toBe(10);
  expect(on.get(2)).toBe(4);
  expect(ancestors(s, [2], off)).toEqual(new Set([2, -2, 1]));
  expect(ancestors(s, [2], on)).toEqual(new Set([2, -2, 0, -1]));
});

test("the runtime follows both branches and can switch back", async () => {
  const r = await runScenario(branching());
  expect(r.status, JSON.stringify(r)).toBe("pass");
  expect(r.frames.findLast(f => f.at === "turn 0")?.outputs[0]).toEqual([2, 0, 10]);
  expect(r.frames.findLast(f => f.at === "turn 1")?.outputs[0]).toEqual([2, 1, 4]);
  expect(r.frames.at(-1)?.outputs[0]).toEqual([2, 0, 10]);
  expect(r.coverage).toEqual(expect.arrayContaining(["branch-true", "branch-false"]));
});

test("branch reductions preserve valid references or remove the branch explicitly", () => {
  const s = branching();
  const valid = [...reductions(s)].filter(c => !validate(c));
  expect(valid.some(c => c.nodes.find(n => n.id === 2)?.branch === undefined)).toBe(true);
  expect(
    valid.every(
      c => !c.nodes.some(n => n.branch?.otherwise.includes(1)) || c.nodes.some(n => n.id === 1)
    )
  ).toBe(true);
});

test("generated branch selection and async completion replay deterministically", async () => {
  for (const s of generate(3350, 40, "branches")) {
    expect(validate(s)).toBeUndefined();
    const a = await runScenario(s);
    const b = await runScenario(a.scenario);
    expect(["pass", "fail", "policy", "error"], JSON.stringify(a)).toContain(a.status);
    expect(b.status).toBe(a.status);
    expect(b.frames).toEqual(a.frames);
    expect(b.requirements).toEqual(a.requirements);
  }
});
