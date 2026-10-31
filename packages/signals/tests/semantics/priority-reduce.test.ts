import { chain } from "./fixtures.js";
import { arithmeticReductions, focusedReductions } from "./reduce.js";
import {
  reductions,
  reductionFamilies,
  reductionOrder,
  shrink,
  type ReductionStats,
  type ReductionFamily
} from "./shrink.js";
import { runScenario } from "./runner.js";
import { evaluate, type Scenario } from "./scenario.js";

test("coordinated arithmetic preserves dependency order and exact request questions", () => {
  const s = chain();
  s.nodes[0].deps = [-1, -1, -2, -2, -3];
  s.nodes[0].offset = 2;
  s.turns = [
    {
      steps: [
        { op: "write", value: 2 },
        { op: "resolve", node: 0, which: "newest", key: "0:[2,2,0,0,0]#2" }
      ]
    }
  ];
  const before = structuredClone(s);
  const c = [...arithmeticReductions(s)][0];
  expect(c.nodes[0].deps).toEqual([-1, -2, -3]);
  expect(c.nodes[0].offset).toBe(1);
  expect(c.turns[0]).toEqual({
    steps: [
      { op: "write", value: 1 },
      { op: "resolve", node: 0, which: "newest", key: "0:[2,2,0,0,0]#2" }
    ]
  });
  expect(s).toEqual(before);
});

test("moving a sync child's arithmetic upstream preserves its settled expression", () => {
  const s = chain("promise");
  s.nodes[0].factor = 2;
  s.nodes[0].offset = 3;
  s.nodes[1].delivery = "sync";
  s.nodes[1].factor = 4;
  s.nodes[1].offset = 5;
  const candidates = [...arithmeticReductions(s)];
  const c = candidates.find(c => c.nodes[0].offset === 17)!;
  expect(c).toBeDefined();
  for (const input of [0, 1, 7])
    expect(evaluate(c, input).get(s.nodes[1].id)).toBe(evaluate(s, input).get(s.nodes[1].id));
  expect(c.nodes[1].factor).toBe(1);
  expect(c.nodes[1].offset).toBe(0);
  const asyncChild = structuredClone(s);
  asyncChild.nodes[1].delivery = "promise";
  expect([...arithmeticReductions(asyncChild)].some(c => c.nodes[0].offset === 17)).toBe(false);
});

test("initial hide reduction removes only a standalone initial hide", () => {
  const s = chain();
  s.show = true;
  s.turns = [{ steps: [{ op: "show", value: false }] }, { steps: [{ op: "write", value: 1 }] }];
  const c = [...focusedReductions(s)].find(c => !c.show)!;
  expect(c.turns).toEqual(s.turns.slice(1));
  const mixed: Scenario = {
    ...s,
    turns: [
      {
        steps: [
          { op: "write", value: 1 },
          { op: "show", value: false }
        ]
      }
    ]
  };
  expect([...focusedReductions(mixed)].some(c => !c.show)).toBe(false);
});

test("family order retains all candidates and stats account for actual replays", async () => {
  expect(new Set(reductionOrder).size).toBe(Object.keys(reductionFamilies).length);
  const s = chain("sync");
  const reverse = [...reductionOrder].reverse();
  const keys = (items: Iterable<Scenario>) => new Set([...items].map(s => JSON.stringify(s)));
  expect(keys(reductions(s, reverse))).toEqual(keys(reductions(s)));
  const base = await runScenario(s);
  const original = {
    ...base,
    status: "fail" as const,
    failure: { rule: "test", message: "profile" }
  };
  const stats: Partial<Record<ReductionFamily, ReductionStats>> = {};
  let calls = 0;
  const r = await shrink(
    original,
    async scenario => {
      calls++;
      return { ...base, scenario };
    },
    10,
    { stats, order: reverse }
  );
  expect(Object.values(stats).reduce((n, s) => n + s.attempts, 0)).toBe(calls);
  expect(calls).toBe(r.attempts);
  expect(Object.values(stats).every(s => s.accepted === 0)).toBe(true);
});
