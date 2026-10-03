import { chain } from "./fixtures.js";
import { canonicalize, structuralReductions } from "./reduce.js";
import { validate, type Scenario } from "./scenario.js";
import { runScenario } from "./runner.js";

const candidates = (s: Scenario) => [...structuralReductions(s)].filter(c => !validate(c));

test("reader deletion prunes its subtree and targeted operations, keeping event boundaries", () => {
  const s: Scenario = {
    ...chain("sync"),
    version: 2,
    sources: [-1],
    readers: [
      { id: 0, refs: [1], gated: false, boundary: "none", mounted: true, pending: true },
      { id: 1, refs: [-1], gated: false, boundary: "none" }
    ],
    turns: [
      {
        steps: [
          {
            op: "queue",
            id: 4,
            via: "task",
            steps: [
              { op: "mount", reader: 0, value: false },
              { op: "click", reader: 0 },
              { op: "write", value: 1 }
            ]
          }
        ]
      },
      { task: 4 }
    ]
  };
  const original = structuredClone(s);
  const c = candidates(s).find(c => c.readers.length === 1 && c.readers[0].id === 1)!;
  expect(c.turns).toEqual([
    {
      steps: [
        {
          op: "queue",
          id: 4,
          via: "task",
          steps: [{ op: "noop" }, { op: "noop" }, { op: "write", value: 1 }]
        }
      ]
    },
    { task: 4 }
  ]);
  expect(s).toEqual(original);
  s.turns = [];
  s.readers = [
    { id: 0, refs: [1], gated: false, boundary: "retain" },
    { id: 1, refs: [1], gated: false, boundary: "retain", parent: 0 },
    { id: 2, refs: [1], gated: false, boundary: "none", parent: 1 },
    { id: 3, refs: [-1], gated: false, boundary: "none" }
  ];
  expect(candidates(s).some(c => c.readers.length === 1 && c.readers[0].id === 3)).toBe(true);
});

test("bypass rewires branches, warmups and reads but never redirects a surviving flight", () => {
  const s: Scenario = {
    ...chain("manual"),
    version: 2,
    sources: [-1],
    warmLatest: [0],
    nodes: [
      { id: 0, deps: [-1], factor: 1, offset: 0, delivery: "manual" },
      {
        id: 1,
        deps: [0],
        factor: 1,
        offset: 0,
        delivery: "manual",
        branch: { condition: 0, otherwise: [0] }
      }
    ],
    turns: [
      {
        steps: [
          { op: "resolve", node: 0, which: "newest", key: "0:[1]#1" },
          { op: "resolve", node: 1, which: "oldest", key: "1:[1,1]#2" },
          { op: "read", ref: 0, mode: "latest" }
        ]
      }
    ]
  };
  const original = structuredClone(s);
  const c = candidates(s).find(c => c.nodes.length === 1 && c.nodes[0].id === 1)!;
  expect(c.nodes[0]).toMatchObject({ deps: [-1], branch: { condition: -1, otherwise: [-1] } });
  expect(c.warmLatest).toEqual([-1]);
  expect(c.turns).toEqual([
    {
      steps: [
        { op: "noop" },
        { op: "resolve", node: 1, which: "oldest", key: "1:[1,1]#2" },
        { op: "read", ref: -1, mode: "latest" }
      ]
    }
  ]);
  expect(s).toEqual(original);
});

test("dead chains and removed deliveries drop only their own resolve operations", () => {
  const s = chain("await");
  s.turns = [
    {
      steps: [
        {
          op: "queue",
          id: 1,
          via: "promise",
          step: {
            op: "resolve",
            node: 0,
            which: "oldest",
            key: "0:[1]#1",
            variantKeys: [null, "0:[1]#1"]
          }
        }
      ]
    }
  ];
  const c = candidates(s).find(c => c.nodes.length === 2 && c.nodes[0].delivery === "sync")!;
  expect(c.turns).toEqual([
    { steps: [{ op: "queue", id: 1, via: "promise", step: { op: "noop" } }] }
  ]);
  s.readers[0].refs = [-1];
  expect(
    candidates(s).some(
      c =>
        !c.nodes.length &&
        JSON.stringify(c.turns) ===
          JSON.stringify([
            { steps: [{ op: "queue", id: 1, via: "promise", step: { op: "noop" } }] }
          ])
    )
  ).toBe(true);
});

test("queue deletion repairs its task and cancel references", () => {
  const s = chain("sync");
  s.turns = [
    { steps: [{ op: "queue", id: 0, via: "task", step: { op: "write", value: 1 } }] },
    {
      steps: [
        { op: "cancel", id: 0 },
        { op: "write", value: 2 }
      ]
    },
    { task: 0 }
  ];
  expect(
    candidates(s).some(
      c =>
        JSON.stringify(c.turns) ===
        JSON.stringify([{ steps: [] }, { steps: [{ op: "write", value: 2 }] }, { steps: [] }])
    )
  ).toBe(true);
});

test("canonicalization removes noop debris without changing execution or timing", async () => {
  const s = chain("promise");
  const debris = { op: "noop" as const, node: 0, which: "newest", key: "obsolete" };
  s.turns.push({ steps: [{ op: "queue", id: 2, via: "microtask", step: debris }] }, { steps: [] });
  const c = canonicalize(s);
  expect(c.turns[1]).toEqual({
    steps: [{ op: "queue", id: 2, via: "microtask", step: { op: "noop" } }]
  });
  expect(c.turns[2]).toEqual({ steps: [] });
  const before = await runScenario(s),
    after = await runScenario(c);
  expect(after.frames).toEqual(before.frames);
  expect(after.events).toEqual(before.events);
  expect(canonicalize(c)).toBe(c);
});

test("a bypass that changes an explicitly resolved downstream question is rejected", async () => {
  const s = chain("manual");
  s.nodes[1].delivery = "manual";
  s.turns = [
    { steps: [{ op: "write", value: 1 }] },
    { steps: [{ op: "resolve", node: 0, which: "oldest", key: "0:[1]#1" }] },
    { steps: [{ op: "resolve", node: 1, which: "oldest", key: "1:[3]#1" }] }
  ];
  s.strict = true;
  expect((await runScenario(s)).status).toBe("pass");
  const bypassed = candidates(s).find(c => c.nodes.length === 1 && c.nodes[0].id === 1)!;
  const result = await runScenario(bypassed);
  expect(result.status).toBe("invalid");
  expect(result.error).toContain("1:[3]#1");
});
