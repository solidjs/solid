import { chain } from "./fixtures.js";
import { normalize, scenarioKey } from "./normalize.js";
import { orderingReductions } from "./order.js";
import { validate, type Scenario } from "./scenario.js";
import { runScenario } from "./runner.js";

function renamed(): Scenario {
  const s = chain("manual");
  s.nodes[0].id = 8;
  s.nodes[1].id = 23;
  s.nodes[1].deps = [8];
  s.readers[0].id = 9;
  s.readers[0].refs = [-1, 23];
  s.turns = [
    { steps: [{ op: "write", value: 1 }] },
    {
      steps: [
        {
          op: "queue",
          id: 42,
          via: "task",
          step: {
            op: "resolve",
            node: 8,
            which: "oldest",
            key: "8:[1]#1",
            variantKeys: ["8:[1]#1", null]
          }
        }
      ]
    },
    { task: 42 }
  ];
  return s;
}

test("normalization renames owners without changing exact request questions or callback boundaries", () => {
  const s = renamed();
  const before = JSON.stringify(s);
  const n = normalize(s);
  expect(validate(n)).toBeUndefined();
  expect(n.nodes[1].deps).toEqual([0]);
  expect(n.readers[0].refs).toEqual([-1, 1]);
  expect(n.turns[1]).toEqual({
    steps: [
      {
        op: "queue",
        id: 0,
        via: "task",
        steps: [
          {
            op: "resolve",
            node: 0,
            which: "newest",
            key: "0:[1]#1",
            variantKeys: ["0:[1]#1", null]
          }
        ]
      }
    ]
  });
  expect(n.turns[2]).toEqual({ task: 0 });
  expect(scenarioKey(n)).toBe(scenarioKey(s));
  expect(JSON.stringify(s)).toBe(before);
});

test("alpha-renamed manual requests replay with the same values and completion state", async () => {
  const s = renamed();
  const turn = s.turns[1];
  if ("steps" in turn) {
    const q = turn.steps[0];
    if (q.op === "queue" && q.step?.op === "resolve") delete q.step.variantKeys;
  }
  const a = await runScenario(s);
  const b = await runScenario(normalize(s));
  expect(a.status, a.error).not.toBe("invalid");
  expect(a.status).not.toBe("error");
  expect(b.status).toBe(a.status);
  expect(b.failure?.message).toBe(a.failure?.message);
  expect(b.frames.length).toBe(a.frames.length);
  for (let i = 0; i < a.frames.length; i++)
    expect(Object.values(b.frames[i].outputs)).toEqual(Object.values(a.frames[i].outputs));
});

function siblings(): Scenario {
  return {
    version: 2,
    sources: [-1, -2],
    show: true,
    nodes: [
      { id: 4, deps: [-1], factor: 1, offset: 9, delivery: "sync" },
      { id: 8, deps: [-2], factor: 1, offset: 2, delivery: "sync" }
    ],
    readers: [
      { id: 6, refs: [4], gated: false, boundary: "none" },
      { id: 7, refs: [8], gated: false, boundary: "none" }
    ],
    turns: [
      {
        steps: [
          { op: "write", source: -1, value: 1 },
          { op: "write", source: -2, value: 2 }
        ]
      }
    ]
  };
}

function ordered(s: Scenario): Scenario {
  for (let i = 0; i < 100; i++) {
    const candidate = orderingReductions(s).next().value;
    if (!candidate) return normalize(s);
    expect(scenarioKey(candidate) < scenarioKey(s)).toBe(true);
    expect(validate(candidate)).toBeUndefined();
    s = candidate;
  }
  throw Error("Ordering did not terminate");
}

test("different sibling creation orders converge using graph references rather than original names", () => {
  const a = siblings();
  const b = siblings();
  b.nodes.reverse();
  b.readers.reverse();
  if ("steps" in b.turns[0]) b.turns[0].steps.reverse();
  expect(scenarioKey(a)).not.toBe(scenarioKey(b));
  expect(scenarioKey(ordered(a))).toBe(scenarioKey(ordered(b)));
});

test("ordering keeps parents before children, dependencies before users, and event boundaries intact", () => {
  const s = chain();
  s.turns = [{ steps: [{ op: "write", value: 2 }, { op: "flush" }, { op: "write", value: 1 }] }];
  for (const c of orderingReductions(s)) {
    expect(validate(c)).toBeUndefined();
    expect(c.turns).toEqual(s.turns);
    expect(c.nodes[0].deps).toEqual([-1]);
  }
  const a = siblings();
  a.readers[0].boundary = "retain";
  a.readers[1].parent = a.readers[0].id;
  for (const c of orderingReductions(a)) expect(validate(c)).toBeUndefined();
});

test("action and reader references normalize while distinguished source roles stay fixed", () => {
  const s = siblings();
  s.readers[0].boundary = "retain";
  s.readers[1].parent = 6;
  s.actions = [{ id: 99, segments: [[{ source: -2, value: 3 }], []] }];
  s.turns = [
    { steps: [{ op: "start-action", action: 99 }] },
    { steps: [{ op: "resume-action", action: 99 }] }
  ];
  const n = normalize(s);
  expect(validate(n)).toBeUndefined();
  expect(n.readers[1].parent).toBe(0);
  expect(n.actions![0]).toEqual({ id: 0, segments: [[{ source: -2, value: 3 }], []] });
  expect(n.turns[0]).toEqual({ steps: [{ op: "start-action", action: 0 }] });
  expect(n.sources).toEqual([-1, -2]);
});

test("renaming does not repair malformed exact request keys", () => {
  const s = renamed();
  const turn = s.turns[1];
  if (!("steps" in turn)) throw Error("Missing callback");
  const q = turn.steps[0];
  if (q.op !== "queue" || q.step?.op !== "resolve") throw Error("Missing resolve");
  q.step.key = "08:[1]#1";
  expect(scenarioKey(s)).toContain('"key":"08:[1]#1"');
});

test("default publication anchors normalize without losing absent anchors or creation order", async () => {
  const s: Scenario = { ...chain("sync"), version: 2, sources: [-1, -2] };
  const explicit = { ...s, anchors: [-1, -2], anchorShow: true };
  expect(scenarioKey(s)).toBe(scenarioKey(explicit));
  expect(scenarioKey({ ...s, anchors: [] })).not.toBe(scenarioKey(s));
  expect(scenarioKey({ ...s, anchors: [-2, -1] })).not.toBe(scenarioKey(s));
  expect(scenarioKey({ ...s, anchorShow: false })).not.toBe(scenarioKey(s));
  const a = await runScenario(explicit),
    b = await runScenario(normalize(explicit));
  expect(a.status).toBe("pass");
  expect(b.frames).toEqual(a.frames);
});

test("empty latest warmups normalize to omission without discarding real warmups", () => {
  const s = chain();
  expect(scenarioKey({ ...s, warmLatest: [] })).toBe(scenarioKey(s));
  expect(normalize({ ...s, warmLatest: [-1] }).warmLatest).toEqual([-1]);
});
