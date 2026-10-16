import {
  branchReductions,
  deliveryScheduleReductions,
  lifecycleReductions,
  observationCollapseReductions
} from "./reduce.js";
import { evaluate, validate, type Scenario } from "./scenario.js";
import { runScenario } from "./runner.js";
import { shrink } from "./shrink.js";

function conditional(): Scenario {
  return {
    version: 2,
    sources: [-1],
    anchors: [],
    anchorShow: false,
    show: true,
    nodes: [
      { id: 0, deps: [-1], factor: 1, offset: 2, delivery: "promise" },
      {
        id: 1,
        deps: [-1],
        branch: { condition: -1, otherwise: [0] },
        factor: 1,
        offset: 0,
        delivery: "sync"
      },
      { id: 2, deps: [-1, 1], factor: 2, offset: 3, delivery: "manual" }
    ],
    readers: [{ id: 0, refs: [2], gated: false, boundary: "none" }],
    turns: [{ steps: [{ op: "write", value: 1 }] }],
    strict: true
  };
}

test("conditional folding rewrites both consumer paths and prunes the unused parent", () => {
  const s = conditional(),
    before = JSON.stringify(s);
  const c = [...branchReductions(s)][0];
  expect(c.nodes.map(n => n.id)).toEqual([0, 2]);
  expect(c.nodes[1].deps).toEqual([-1, -1]);
  expect(c.nodes[1].branch).toEqual({ condition: -1, otherwise: [-1, 0] });
  expect(c.nodes[1].delivery).toBe("manual");
  for (const input of [0, 1, 2]) expect(evaluate(c, input).get(2)).toBe(evaluate(s, input).get(2));
  expect(validate(c)).toBeUndefined();
  expect(JSON.stringify(s)).toBe(before);
  s.readers[0].refs.push(1);
  expect([...branchReductions(s)][0].nodes.map(n => n.id)).toEqual([0, 1, 2]);
});

test("folding keeps surviving request identities, while removed owners become noops", () => {
  const s = conditional();
  s.nodes[1].delivery = "manual";
  s.turns.push({
    steps: [
      { op: "resolve", node: 1, which: "newest", key: "1:[1]#1" },
      {
        op: "resolve",
        node: 2,
        which: "newest",
        key: "2:[1,1]#2",
        variantKeys: ["2:[1,1]#2", null]
      }
    ]
  });
  const c = [...branchReductions(s)][0];
  expect(c.turns[1]).toEqual({
    steps: [{ op: "noop" }, (s.turns[1] as { steps: unknown[] }).steps[1]]
  });
});

test("branch paths can be shortened together without changing the input scenario", () => {
  const s = conditional();
  s.nodes[1] = { id: 1, deps: [-1], factor: 1, offset: 0, delivery: "promise" };
  s.nodes[2] = {
    id: 2,
    deps: [0],
    branch: { condition: -1, otherwise: [1] },
    factor: 1,
    offset: 0,
    delivery: "promise"
  };
  const before = JSON.stringify(s),
    c = [...branchReductions(s)][0];
  expect(c.nodes).toEqual([
    { ...s.nodes[2], deps: [-1], branch: { condition: -1, otherwise: [-1] } }
  ]);
  expect(validate(c)).toBeUndefined();
  expect(JSON.stringify(s)).toBe(before);
});

function joined(): Scenario {
  return {
    version: 2,
    sources: [-1, -2],
    show: true,
    nodes: [
      { id: 0, deps: [-1], factor: 1, offset: 0, delivery: "promise" },
      { id: 1, deps: [-2], factor: 1, offset: 0, delivery: "promise" },
      { id: 2, deps: [0, 1], factor: 1, offset: 0, delivery: "sync" }
    ],
    readers: [{ id: 0, refs: [2], gated: false, boundary: "none" }],
    turns: [
      {
        steps: [
          { op: "write", source: -1, value: 1 },
          { op: "flush" },
          { op: "write", source: -2, value: 1 }
        ]
      }
    ]
  };
}

test("delivery and event boundaries change together, keeping node identities and unrelated work", () => {
  const s = joined(),
    before = JSON.stringify(s);
  const c = [...deliveryScheduleReductions(s)].find(
    c => c.nodes[0].delivery === "manual" && c.turns.length === 2
  )!;
  expect(c.nodes.map(n => n.delivery)).toEqual(["manual", "manual", "sync"]);
  expect(c.turns).toEqual([
    { steps: [{ op: "write", source: -1, value: 1 }] },
    { steps: [{ op: "write", source: -2, value: 1 }] }
  ]);
  expect(validate(c)).toBeUndefined();
  expect(JSON.stringify(s)).toBe(before);
});

test("coordinated search crosses a passing intermediate without accepting that intermediate", async () => {
  const s = joined(),
    baseline = await runScenario(s);
  const run = async (scenario: Scenario) => ({
    ...baseline,
    scenario,
    status: (scenario.nodes.length === 3 &&
    scenario.nodes[0]?.delivery === "manual" &&
    scenario.nodes[1]?.delivery === "manual" &&
    scenario.turns.length === 2
      ? "fail"
      : "pass") as "fail" | "pass",
    failure: undefined as undefined | { rule: string; message: string }
  });
  const result = {
    ...baseline,
    status: "fail" as const,
    failure: { rule: "S1", message: "synthetic" }
  };
  const reduced = await shrink(
    result,
    async scenario => {
      const r = await run(scenario);
      if (r.status === "fail") r.failure = { rule: "L1", message: "synthetic smaller failure" };
      return r;
    },
    100,
    { order: ["deliverySchedule"] }
  );
  expect(reduced.accepted).toBe(1);
  expect(reduced.result.scenario.nodes[0].delivery).toBe("manual");
  expect(reduced.result.scenario.turns).toHaveLength(2);
  expect(reduced.result.failure?.rule).toBe("L1");
  expect(reduced.attempts).toBeLessThan(100);
});

test("observation collapse removes nested controls and their commands together", () => {
  const s = joined();
  s.readers = [
    { id: 0, refs: [-1, 0], gated: false, boundary: "reset" },
    { id: 1, refs: [0, 2], gated: true, boundary: "none", parent: 0, pending: true }
  ];
  s.turns.push({
    steps: [
      { op: "dispose", reader: 0 },
      { op: "click", reader: 1 }
    ]
  });
  const before = JSON.stringify(s),
    c = [...observationCollapseReductions(s)][0];
  expect(c.readers).toEqual([{ id: 0, refs: [-1, 0, 2], gated: false, boundary: "none" }]);
  expect(c.turns.at(-1)).toEqual({ steps: [{ op: "noop" }, { op: "noop" }] });
  expect(validate(c)).toBeUndefined();
  expect(JSON.stringify(s)).toBe(before);
  s.readers[0].render = { on: -1, target: "portal", scheduled: true };
  expect([...observationCollapseReductions(s)]).toHaveLength(0);
});

test("multiple optimistic proposals lower to a direct write sequence including authority", () => {
  const s: Scenario = {
    version: 2,
    sources: [-1, -2],
    anchors: [-2],
    anchorShow: false,
    show: true,
    optimistic: { proposals: [1, 2], authoritative: 3 },
    nodes: [{ id: 0, deps: [-2], factor: 1, offset: 0, delivery: "manual" }],
    readers: [{ id: 0, refs: [0], gated: false, boundary: "none" }],
    turns: [
      { steps: [{ op: "start-action" }] },
      { steps: [{ op: "resume-action" }] },
      { steps: [{ op: "resume-action" }] },
      { steps: [{ op: "resume-action" }, { op: "start-action" }] }
    ]
  };
  const before = JSON.stringify(s),
    c = [...lifecycleReductions(s)].find(c => !c.optimistic)!;
  expect(c.turns).toEqual([
    { steps: [{ op: "write", source: -1, value: 1 }] },
    { steps: [{ op: "write", source: -1, value: 2 }] },
    { steps: [{ op: "write", source: -1, value: 3 }] },
    { steps: [{ op: "noop" }, { op: "noop" }] }
  ]);
  expect(validate(c)).toBeUndefined();
  expect(JSON.stringify(s)).toBe(before);
});

test("more elaborate delivery forms always remove a node or explicit flush", () => {
  const s = joined();
  s.turns = [{ steps: [{ op: "write", value: 1 }] }];
  for (const c of deliveryScheduleReductions(s)) {
    if (c.nodes.some(n => n.delivery === "manual" || n.delivery === "await"))
      expect(c.nodes.length).toBeLessThan(s.nodes.length);
    expect(validate(c)).toBeUndefined();
  }
});

test("local delivery pairs preserve mixed async paths and surviving exact requests", () => {
  const s = joined();
  s.nodes[0].delivery = "manual";
  s.nodes[1].delivery = "manual";
  s.readers[0].refs = [0, 1, 2];
  const flight = { op: "resolve" as const, node: 1, which: "newest" as const, key: "1:[1]#2" };
  s.turns.push({ steps: [{ op: "resolve", node: 0, which: "newest", key: "0:[1]#1" }, flight] });
  const before = JSON.stringify(s);
  const c = [...deliveryScheduleReductions(s)].find(
    c =>
      c.nodes.length === 2 && c.nodes[0].delivery === "promise" && c.nodes[1].delivery === "manual"
  )!;
  expect(c).toBeDefined();
  expect(c.turns.at(-1)).toEqual({ steps: [{ op: "noop" }, flight] });
  expect(validate(c)).toBeUndefined();
  expect(JSON.stringify(s)).toBe(before);
});
