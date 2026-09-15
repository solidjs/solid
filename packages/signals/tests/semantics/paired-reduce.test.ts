import { chain } from "./fixtures.js";
import {
  mergeArithmeticReductions,
  deliveryOrderingReductions,
  callbackEndReductions,
  initialVisibilityReductions
} from "./reduce.js";
import { OrderingLimit } from "./order.js";
import { scenarioKey } from "./normalize.js";
import { validate, type Scenario } from "./scenario.js";
import { runScenario } from "./runner.js";
import { shrink, type ShrinkOptions } from "./shrink.js";

function branch(): Scenario {
  return {
    version: 2,
    sources: [-1, -2],
    anchors: [],
    anchorShow: false,
    show: true,
    nodes: [
      { id: 0, deps: [-2], factor: 1, offset: 0, delivery: "promise" },
      {
        id: 1,
        deps: [-1],
        branch: { condition: -2, otherwise: [0] },
        factor: 1,
        offset: 0,
        delivery: "promise"
      }
    ],
    readers: [{ id: 0, refs: [-2, 1], gated: false, boundary: "none" }],
    turns: [{ steps: [{ op: "write", source: -2, value: 1 }] }]
  };
}

test("source merging repairs a literal in the same candidate and keeps exact flight keys", () => {
  const s = branch();
  s.turns.push({
    steps: [
      { op: "resolve", node: 0, which: "newest", key: "0:[1]#2", variantKeys: ["0:[1]#2", null] }
    ]
  });
  const before = JSON.stringify(s);
  const c = [...mergeArithmeticReductions(s)].find(c => c.nodes[0].offset === 1)!;
  expect(c.sources).toEqual([-1]);
  expect(c.nodes[0].deps).toEqual([-1]);
  expect(c.nodes[1].branch?.condition).toBe(-1);
  expect(c.turns[0]).toEqual({ steps: [{ op: "write", source: -1, value: 1 }] });
  expect(c.turns[1]).toEqual(s.turns[1]);
  expect(validate(c)).toBeUndefined();
  expect(JSON.stringify(s)).toBe(before);
  s.optimistic = { proposals: [1], authoritative: 0 };
  expect([...mergeArithmeticReductions(s)]).toHaveLength(0);
});

test("source/offset search can cross two passing single edits", async () => {
  const s = branch(),
    baseline = await runScenario(s);
  const original = {
    ...baseline,
    status: "fail" as const,
    failure: { rule: "S1", message: "original" }
  };
  const run = async (scenario: Scenario) => {
    const failed = scenario.sources?.length === 1 && scenario.nodes[0].offset === 1;
    return {
      ...baseline,
      scenario,
      status: failed ? ("fail" as const) : ("pass" as const),
      failure: failed ? { rule: "L1", message: "smaller" } : undefined
    };
  };
  expect((await run({ ...s, nodes: [{ ...s.nodes[0], offset: 1 }, s.nodes[1]] })).status).toBe(
    "pass"
  );
  const r = await shrink(original, run, 30, { order: ["mergeArithmetic"] });
  expect(r.accepted).toBe(1);
  expect(r.result.failure?.rule).toBe("L1");
  expect(r.result.scenario.sources).toEqual([-1]);
});

test("queue-at-end preserves payload order and unrelated callback/task work", () => {
  const s = chain();
  s.turns = [
    {
      steps: [
        {
          op: "queue",
          id: 0,
          via: "microtask",
          steps: [
            { op: "write", value: 1 },
            { op: "show", value: false }
          ]
        },
        { op: "show", value: true },
        { op: "queue", id: 1, via: "task", step: { op: "write", value: 2 } }
      ]
    },
    { task: 1 }
  ];
  const before = JSON.stringify(s),
    c = [...callbackEndReductions(s)][0];
  expect(c.turns[0]).toEqual({
    steps: [
      { op: "show", value: true },
      { op: "queue", id: 1, via: "task", step: { op: "write", value: 2 } },
      { op: "write", value: 1 },
      { op: "show", value: false }
    ]
  });
  expect(c.turns[1]).toEqual({ task: 1 });
  expect(validate(c)).toBeUndefined();
  expect(JSON.stringify(s)).toBe(before);
  s.turns.push({ steps: [{ op: "cancel", id: 0 }] });
  expect([...callbackEndReductions(s)]).toHaveLength(0);
});

test("initial visibility absorbs only the first direct setter in a mixed callback", () => {
  const s = chain();
  s.turns = [
    {
      steps: [
        { op: "show", value: false },
        { op: "write", value: 1 },
        { op: "show", value: true }
      ]
    }
  ];
  const before = JSON.stringify(s),
    candidates = [...initialVisibilityReductions(s)];
  expect(candidates).toHaveLength(1);
  expect(candidates[0].show).toBe(false);
  expect(candidates[0].turns).toEqual([
    {
      steps: [
        { op: "write", value: 1 },
        { op: "show", value: true }
      ]
    }
  ]);
  expect(validate(candidates[0])).toBeUndefined();
  expect(JSON.stringify(s)).toBe(before);
  s.turns = [
    { steps: [{ op: "queue", id: 0, via: "microtask", step: { op: "show", value: false } }] }
  ];
  expect([...initialVisibilityReductions(s)]).toHaveLength(0);
});

test("delivery/order candidates descend or remove a node without changing captured inputs", () => {
  const s: Scenario = {
    version: 2,
    sources: [-1],
    show: true,
    nodes: [
      { id: 0, deps: [-1], factor: 1, offset: 0, delivery: "promise" },
      { id: 1, deps: [-1], factor: 1, offset: 0, delivery: "promise" },
      { id: 2, deps: [1], factor: 1, offset: 0, delivery: "sync" }
    ],
    readers: [{ id: 0, refs: [0, 2], gated: false, boundary: "none", pending: true }],
    turns: [
      {
        steps: [
          { op: "write", value: 1 },
          { op: "resolve", node: 1, which: "newest", key: "1:[1]#2" }
        ]
      }
    ]
  };
  const before = JSON.stringify(s),
    candidates = [...deliveryOrderingReductions(s)];
  expect(candidates.some(c => c.nodes[0].delivery === "manual" && c.nodes[2].deps[0] === 0)).toBe(
    true
  );
  for (const c of candidates) {
    expect(validate(c)).toBeUndefined();
    expect(c.nodes.length < s.nodes.length || scenarioKey(c) < scenarioKey(s)).toBe(true);
    expect(JSON.stringify(c.turns)).toContain(":[1]#2");
  }
  expect(JSON.stringify(s)).toBe(before);
});

test("ordering progress survives another family's higher-key delivery edit", () => {
  const s = chain("sync"),
    limit = new OrderingLimit(s);
  const lower: Scenario = { ...s, nodes: [{ ...s.nodes[0], delivery: "promise" }, s.nodes[1]] };
  expect(limit.allows(lower)).toBe(true);
  limit.accept(lower);
  limit.accept(s);
  expect(limit.allows(lower)).toBe(false);
  expect(limit.allows(s)).toBe(false);
  const smaller: Scenario = {
    ...s,
    nodes: [s.nodes[0]],
    readers: [{ ...s.readers[0], refs: [0] }]
  };
  expect(limit.allows(smaller)).toBe(true);
  limit.accept(smaller);
  expect(limit.allows({ ...smaller, nodes: [{ ...smaller.nodes[0], delivery: "promise" }] })).toBe(
    true
  );
});

test("delivery/order exploration finishes with simpler delivery within the shared budget", async () => {
  const s: Scenario = {
    version: 2,
    sources: [-1],
    show: true,
    nodes: [
      { id: 0, deps: [-1], factor: 1, offset: 0, delivery: "sync" },
      { id: 1, deps: [-1], factor: 1, offset: 0, delivery: "sync" }
    ],
    readers: [{ id: 0, refs: [0, 1], gated: false, boundary: "none" }],
    turns: []
  };
  const baseline = await runScenario(s);
  const failure = { rule: "S1", message: "synthetic two-reader-value failure" };
  let calls = 0;
  const stats: NonNullable<ShrinkOptions["stats"]> = {};
  const reduced = await shrink(
    { ...baseline, status: "fail", failure },
    async scenario => {
      calls++;
      const failed =
        scenario.nodes.length === 2 &&
        scenario.readers.length === 1 &&
        scenario.readers[0].refs.length === 2 &&
        scenario.readers[0].refs.every(ref => ref >= 0);
      return {
        ...baseline,
        scenario,
        status: failed ? "fail" : "pass",
        failure: failed ? failure : undefined
      };
    },
    200,
    { order: ["structural", "deliveryOrdering"], stats }
  );
  expect(stats!.deliveryOrdering!.accepted).toBeGreaterThan(0);
  expect(reduced.result.scenario.nodes.every(n => n.delivery === "sync")).toBe(true);
  expect(reduced.attempts).toBe(calls);
  expect(reduced.attempts).toBeLessThan(200);
});
