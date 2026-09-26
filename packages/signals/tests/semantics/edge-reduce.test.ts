import { chain } from "./fixtures.js";
import { edgeReductions } from "./reduce.js";
import { orderingReductions } from "./order.js";
import { scenarioKey } from "./normalize.js";
import { validate, type Scenario, type Step } from "./scenario.js";

test("single-use bypass retains other consumers, warmups and exact flights", () => {
  const s: Scenario = { ...chain("manual"), version: 2, sources: [-1], warmLatest: [0] };
  s.nodes[1].delivery = "manual";
  s.readers.push({ id: 1, refs: [0], gated: false, boundary: "none" });
  s.turns.push({
    steps: [
      { op: "resolve", node: 1, which: "newest", key: "1:[3]#2", variantKeys: [null, "1:[3]#1"] }
    ]
  });
  const before = structuredClone(s);
  const candidates = [...edgeReductions(s)];
  const memo = candidates.find(c => c.nodes[1].deps[0] === -1)!;
  expect(memo.nodes[0]).toBe(s.nodes[0]);
  expect(memo.readers).toBe(s.readers);
  expect(memo.turns).toBe(s.turns);
  expect(memo.warmLatest).toBe(s.warmLatest);
  const reader = candidates.find(c => c.readers[0].refs[1] === 0)!;
  expect(reader.readers[1]).toBe(s.readers[1]);
  expect(reader.nodes).toBe(s.nodes);
  expect(reader.turns).toBe(s.turns);
  expect(s).toEqual(before);
  for (const c of candidates) expect(validate(c)).toBeUndefined();
});

test("branch-edge bypass changes only the chosen arm and keeps its condition", () => {
  const s: Scenario = { ...chain("manual"), version: 2, sources: [-1, -2] };
  s.nodes[0].deps = [-1, -1];
  s.nodes[0].branch = { condition: -2, otherwise: [-1, -2] };
  s.nodes[1].branch = { condition: 0, otherwise: [0] };
  const cs = [...edgeReductions(s)];
  const c = cs.find(c => c.nodes[1].branch?.otherwise[0] === -2)!;
  expect(c.nodes[1]).toEqual({ ...s.nodes[1], branch: { condition: 0, otherwise: [-2] } });
  expect(c.nodes[0]).toBe(s.nodes[0]);
  expect(new Set(cs.map(c => JSON.stringify(c))).size).toBe(cs.length);
  for (const c of cs) expect(validate(c)).toBeUndefined();
});

test("visibility and mounting setters can sort within their own callback", () => {
  const s: Scenario = { ...chain(), version: 2, sources: [-1] };
  s.readers[0].mounted = false;
  s.turns = [
    {
      steps: [
        { op: "write", value: 1 },
        { op: "show", value: true }
      ]
    },
    {
      steps: [
        {
          op: "queue",
          id: 0,
          via: "microtask",
          steps: [
            { op: "write", value: 2 },
            { op: "mount", reader: 0, value: true }
          ]
        }
      ]
    }
  ];
  const before = structuredClone(s);
  const cs = [...orderingReductions(s)];
  expect(
    cs.some(
      c =>
        JSON.stringify(c.turns[0]) ===
        JSON.stringify({
          steps: [
            { op: "show", value: true },
            { op: "write", source: -1, value: 1 }
          ]
        })
    )
  ).toBe(true);
  expect(
    cs.some(
      c =>
        JSON.stringify(c.turns[1]) ===
        JSON.stringify({
          steps: [
            {
              op: "queue",
              id: 0,
              via: "microtask",
              steps: [
                { op: "mount", reader: 0, value: true },
                { op: "write", source: -1, value: 2 }
              ]
            }
          ]
        })
    )
  ).toBe(true);
  for (const c of cs) {
    expect(scenarioKey(c) < scenarioKey(s)).toBe(true);
    expect(c.turns.length).toBe(s.turns.length);
  }
  expect(s).toEqual(before);
});

test("setter ordering does not swap same-target writes or cross reads, flushes and turns", () => {
  const s: Scenario = { ...chain("sync"), version: 2, sources: [-1] };
  s.readers[0].mounted = true;
  const cases: Step[][] = [
    [
      { op: "write", value: 2 },
      { op: "write", value: 1 }
    ],
    [
      { op: "show", value: true },
      { op: "show", value: false }
    ],
    [
      { op: "mount", reader: 0, value: true },
      { op: "mount", reader: 0, value: false }
    ],
    [{ op: "write", value: 2 }, { op: "flush" }, { op: "show", value: false }],
    [
      { op: "write", value: 2 },
      { op: "read", ref: 0, mode: "latest" },
      { op: "show", value: false }
    ]
  ];
  for (const steps of cases) {
    s.turns = [{ steps }, { steps: [{ op: "show", value: false }] }];
    for (const c of orderingReductions(s))
      expect(c.turns).toEqual(JSON.parse(scenarioKey(s)).turns);
  }
});
