import { chain } from "./fixtures.js";
import { focusedReductions } from "./reduce.js";
import { runScenario } from "./runner.js";
import { validate, type Scenario } from "./scenario.js";

const candidates = (s: Scenario) => [...focusedReductions(s)].filter(c => !validate(c));

test("optimistic values try one as well as the existing zero reduction", () => {
  const s: Scenario = {
    ...chain(),
    version: 2,
    sources: [-1, -2],
    optimistic: { proposals: [2, 3], authoritative: 4 },
    turns: []
  };
  const before = structuredClone(s);
  const cs = candidates(s);
  expect(cs.some(c => c.optimistic?.proposals.join() === "1,3")).toBe(true);
  expect(cs.some(c => c.optimistic?.authoritative === 1)).toBe(true);
  expect(cs.some(c => c.sources?.length !== 2)).toBe(false);
  expect(s).toEqual(before);
});

test("action write simplification retains segment boundaries and other writes", () => {
  const s: Scenario = {
    ...chain(),
    version: 2,
    sources: [-1],
    actions: [{ id: 7, segments: [[{ source: -1, value: 3 }], [{ source: -1, value: 2 }]] }],
    turns: [{ steps: [{ op: "start-action", action: 7 }] }]
  };
  expect(
    candidates(s).some(
      c =>
        JSON.stringify(c.actions) ===
        JSON.stringify([
          { id: 7, segments: [[{ source: -1, value: 1 }], [{ source: -1, value: 2 }]] }
        ])
    )
  ).toBe(true);
});

test("source merging rewrites references, actions and anchors, retaining request questions", () => {
  const s: Scenario = {
    ...chain(),
    version: 2,
    sources: [-1, -2],
    anchors: [-1, -2],
    warmLatest: [-2],
    actions: [{ id: 0, segments: [[{ source: -2, value: 1 }], []] }],
    turns: [
      {
        steps: [
          { op: "read", ref: -2, mode: "plain" },
          { op: "resolve", node: 0, which: "oldest", key: "0:[1]#1" }
        ]
      }
    ]
  };
  s.nodes[0].deps = [-2];
  s.nodes[1].branch = { condition: -2, otherwise: [-2] };
  const before = structuredClone(s);
  const c = candidates(s).find(c => c.sources?.length === 1)!;
  expect(c.nodes[0].deps).toEqual([-1]);
  expect(c.nodes[1].branch).toEqual({ condition: -1, otherwise: [-1] });
  expect(c.anchors).toEqual([-1]);
  expect(c.warmLatest).toEqual([-1]);
  expect(c.actions![0].segments[0][0].source).toBe(-1);
  expect(c.turns[0]).toEqual({
    steps: [
      { op: "read", ref: -1, mode: "plain" },
      { op: "resolve", node: 0, which: "oldest", key: "0:[1]#1" }
    ]
  });
  expect(s).toEqual(before);
});

test("merging which changes a resolved question is invalid rather than redirected", async () => {
  const s: Scenario = {
    ...chain(),
    version: 2,
    sources: [-1, -2],
    strict: true,
    turns: [
      {
        steps: [
          { op: "write", source: -2, value: 1 },
          { op: "write", source: -1, value: 2 }
        ]
      },
      { steps: [{ op: "resolve", node: 0, which: "newest", key: "0:[1]#1" }] }
    ]
  };
  s.nodes[0].deps = [-2];
  s.readers[0].refs = [-2, 1];
  expect((await runScenario(s)).status).toBe("pass");
  const c = candidates(s).find(c => c.sources?.length === 1)!;
  expect((await runScenario(c)).status).toBe("invalid");
});

test("task materialization puts work at invocation, not registration", async () => {
  const s = chain("sync");
  s.turns = [
    { steps: [{ op: "queue", id: 7, via: "task", step: { op: "write", value: 1 } }] },
    { steps: [{ op: "write", value: 2 }] },
    { task: 7 }
  ];
  const before = structuredClone(s);
  const c = candidates(s).find(c => "steps" in c.turns[2])!;
  expect(c.turns).toEqual([
    { steps: [{ op: "noop" }] },
    { steps: [{ op: "write", value: 2 }] },
    { steps: [{ op: "write", value: 1 }] }
  ]);
  const a = await runScenario(s),
    b = await runScenario(c);
  expect(a.status).toBe("pass");
  expect(b.frames).toEqual(a.frames);
  expect(s).toEqual(before);
});

test("implicit tasks move to a final host turn; canceled or repeated tasks are left alone", () => {
  const s = chain("sync");
  s.turns = [{ steps: [{ op: "queue", id: 0, via: "task", step: { op: "write", value: 1 } }] }];
  expect(
    candidates(s).some(
      c =>
        c.turns.length === 2 &&
        JSON.stringify(c.turns[1]) === JSON.stringify({ steps: [{ op: "write", value: 1 }] })
    )
  ).toBe(true);
  s.turns.push({ steps: [{ op: "cancel", id: 0 }] });
  expect(candidates(s).some(c => JSON.stringify(c.turns).includes('"noop"'))).toBe(false);
  s.turns.splice(1, 1, { task: 0 }, { task: 0 });
  expect(candidates(s).some(c => JSON.stringify(c.turns).includes('"noop"'))).toBe(false);
});

test("setup, flush separation and grouped probe removal are separate candidates", () => {
  const s = chain("sync");
  s.show = false;
  s.turns = [
    {
      steps: [
        { op: "read", ref: -1, mode: "plain" },
        { op: "write", value: 1 },
        { op: "flush" },
        { op: "show", value: true },
        { op: "read", ref: -1, mode: "latest" }
      ]
    }
  ];
  const cs = candidates(s);
  expect(cs.some(c => c.show && c.turns === s.turns)).toBe(true);
  const split = cs.find(c => c.turns.length === 2)!;
  expect(split.show).toBe(false);
  const probes = cs.find(c => JSON.stringify(c.turns).includes('"noop"'))!;
  expect(probes.turns).toEqual([
    {
      steps: [
        { op: "noop" },
        { op: "write", value: 1 },
        { op: "flush" },
        { op: "show", value: true },
        { op: "noop" }
      ]
    }
  ]);
});

test("dropping a setup prefix can retain a changing write without altering surviving requests", () => {
  const s = chain();
  s.turns = [
    { steps: [{ op: "write", value: 1 }] },
    { steps: [{ op: "resolve", node: 0, which: "newest", key: "0:[1]#1" }] },
    { steps: [{ op: "write", value: 0 }] },
    { steps: [{ op: "show", value: true }] }
  ];
  const before = structuredClone(s);
  expect(
    candidates(s).some(
      c =>
        JSON.stringify(c.turns) ===
        JSON.stringify([
          { steps: [{ op: "write", value: 1 }] },
          { steps: [{ op: "show", value: true }] }
        ])
    )
  ).toBe(true);
  expect(s).toEqual(before);
});

test("a microtask can move to a new event only when it is last in its callback", () => {
  const s = chain("sync");
  s.turns = [
    {
      steps: [
        { op: "write", value: 1 },
        { op: "queue", id: 0, via: "microtask", step: { op: "show", value: true } }
      ]
    }
  ];
  expect(candidates(s).some(c => c.turns.length === 2)).toBe(true);
  const t = s.turns[0];
  if ("steps" in t) t.steps.push({ op: "write", value: 2 });
  expect(candidates(s).some(c => c.turns.length === 2)).toBe(false);
});

test("matching offsets and writes can shrink together without rewriting request inputs", () => {
  const s = chain();
  s.nodes[0].offset = 2;
  s.nodes[1].offset = 2;
  s.turns = [
    { steps: [{ op: "write", value: 2 }] },
    { steps: [{ op: "resolve", node: 0, which: "newest", key: "0:[2]#1" }] }
  ];
  const before = structuredClone(s);
  const c = candidates(s).find(c => c.nodes[0].offset === 1 && c.nodes[1].offset === 1)!;
  expect(c.turns[0]).toEqual({ steps: [{ op: "write", value: 1 }] });
  expect(c.turns[1]).toEqual(s.turns[1]);
  expect(s).toEqual(before);
});
