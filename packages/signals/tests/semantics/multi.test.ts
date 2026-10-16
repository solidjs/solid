import { generate } from "./generate.js";
import { runScenario } from "./runner.js";
import { checkFrame } from "./rules.js";
import { queuedSteps, validate, type Scenario } from "./scenario.js";

function independent(): Scenario {
  return {
    version: 2,
    sources: [-1, -2],
    show: true,
    nodes: [
      { id: 0, deps: [-1], factor: 1, offset: 0, delivery: "manual" },
      { id: 1, deps: [-2], factor: 1, offset: 0, delivery: "manual" }
    ],
    readers: [
      { id: 0, refs: [-1, 0], gated: false, boundary: "none" },
      { id: 1, refs: [-2, 1], gated: false, boundary: "none" }
    ],
    turns: [
      { steps: [{ op: "write", source: -1, value: 1 }] },
      { steps: [{ op: "write", source: -2, value: 2 }] },
      { steps: [{ op: "resolve", node: 1, which: "newest" }] }
    ]
  };
}

test.each([0, 1])(
  "disjoint branches can publish independently, resolving node %i first",
  async node => {
    const s = independent();
    s.turns[2] = { steps: [{ op: "resolve", node, which: "newest" }] };
    const r = await runScenario(s);
    expect(r.status, JSON.stringify(r)).toBe("pass");
    const frame = r.frames.filter(f => f.at === "turn 2").at(-1)!;
    expect(frame.inputs).toEqual(node === 0 ? { [-1]: 1, [-2]: 0 } : { [-1]: 0, [-2]: 2 });
    expect(r.frames.at(-1)?.inputs).toEqual({ [-1]: 1, [-2]: 2 });
  }
);

test("dependency checks allow mixed independent generations but reject a wrong dependent value", () => {
  const s = independent();
  const frame = {
    at: "published",
    input: 0,
    inputs: { [-1]: 0, [-2]: 2 },
    show: true,
    outputs: { 0: [0, 0], 1: [2, 2] }
  };
  expect(checkFrame(s, frame)).toBeUndefined();
  expect(checkFrame(s, { ...frame, outputs: { ...frame.outputs, 1: [2, 0] } })?.rule).toBe("S1");
});

test("a joining memo is checked against both published sources", async () => {
  const s = independent();
  s.nodes.push({ id: 2, deps: [0, 1], factor: 1, offset: 0, delivery: "sync" });
  s.readers = [{ id: 2, refs: [2], gated: false, boundary: "none" }];
  const r = await runScenario(s);
  expect(r.status, JSON.stringify(r)).toBe("pass");
  expect(r.frames.at(-1)?.outputs[2]).toEqual([3]);
});

test.each(["microtask", "promise", "await", "task"] as const)(
  "a %s continuation executes its writes in one call stack",
  async via => {
    const s = independent();
    s.nodes.forEach(n => (n.delivery = "sync"));
    s.turns = [
      {
        steps: [
          {
            op: "queue",
            id: 0,
            via,
            steps: [
              { op: "write", source: -1, value: 1 },
              { op: "write", source: -2, value: 2 }
            ]
          }
        ]
      }
    ];
    const r = await runScenario(s);
    expect(r.status, JSON.stringify(r)).toBe("pass");
    expect(
      r.frames.every(
        f =>
          (f.inputs?.[-1] === 0 && f.inputs?.[-2] === 0) ||
          (f.inputs?.[-1] === 1 && f.inputs?.[-2] === 2)
      )
    ).toBe(true);
  }
);

test("multi-source generation is valid, exercises both sources and continuation blocks, and replays", async () => {
  const scenarios = generate(3337, 100, "multi");
  expect(generate(3337, 100, "multi")).toEqual(scenarios);
  const writes = new Set<number>();
  let blocks = 0;
  for (const s of scenarios) {
    expect(validate(s)).toBeUndefined();
    for (const t of s.turns)
      if ("steps" in t)
        for (const step of t.steps) {
          if (step.op === "write") writes.add(step.source!);
          if (step.op === "queue" && queuedSteps(step).length > 1) blocks++;
        }
  }
  expect(writes).toEqual(new Set([-1, -2]));
  expect(blocks).toBeGreaterThan(0);
  for (const s of scenarios.slice(0, 20)) {
    const a = await runScenario(s);
    const b = await runScenario(a.scenario);
    expect(["pass", "fail", "policy"]).toContain(a.status);
    expect(b.status).toBe(a.status);
    expect(b.frames).toEqual(a.frames);
  }
});

test("source IDs cannot be mistaken for resolvable memo requests", () => {
  const s = independent();
  s.turns = [{ steps: [{ op: "resolve", node: -2, which: "newest" }] }];
  expect(validate(s)).toBeDefined();
});
