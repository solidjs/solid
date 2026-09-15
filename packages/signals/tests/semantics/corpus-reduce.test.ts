import { chain } from "./fixtures.js";
import { arithmeticReductions, focusedReductions, structuralReductions } from "./reduce.js";
import { reductionFamilies } from "./shrink.js";
import { runScenario } from "./runner.js";
import { evaluate, validate, type Scenario } from "./scenario.js";

function affine(): Scenario {
  const s = chain("sync");
  s.nodes[1].delivery = "manual";
  s.turns = [
    { steps: [{ op: "write", value: 2 }] },
    { steps: [{ op: "resolve", node: 1, which: "newest", key: "1:[5]#1" }] },
    { steps: [{ op: "write", value: 3 }] },
    { steps: [{ op: "resolve", node: 1, which: "newest", key: "1:[7]#1" }] },
    { steps: [{ op: "write", value: 2 }] },
    { steps: [{ op: "resolve", node: 1, which: "newest", key: "1:[5]#2" }] }
  ];
  s.strict = true;
  return s;
}

function translated(s: Scenario): Scenario | undefined {
  return [...focusedReductions(s)].find(
    c => c.nodes[1].deps[0] === -1 && JSON.stringify(c.turns) !== JSON.stringify(s.turns)
  );
}

test("affine input folding resolves the corresponding requests, including repeated inputs", async () => {
  const s = affine(),
    before = structuredClone(s),
    c = translated(s)!;
  expect(validate(c)).toBeUndefined();
  expect(c.turns[5]).toEqual({
    steps: [{ op: "resolve", node: 1, which: "newest", key: "1:[2]#2" }]
  });
  for (const input of [0, 2, 3]) expect(evaluate(c, input)).toEqual(evaluate(s, input));
  const a = await runScenario(s),
    b = await runScenario(c);
  expect(a.status).toBe("pass");
  expect(b.status).toBe("pass");
  expect(b.frames).toEqual(a.frames);
  expect(s).toEqual(before);
});

test("affine translation preserves queued boundaries, paired nulls and request occurrences", () => {
  const s = affine();
  s.turns = [
    {
      steps: [
        {
          op: "queue",
          id: 0,
          via: "task",
          steps: [
            {
              op: "resolve",
              node: 1,
              which: "newest",
              key: "1:[5]#2",
              variantKeys: [null, "1:[7]#3"]
            },
            { op: "resolve", node: 0, which: "oldest", key: "0:[2]#1" }
          ]
        }
      ]
    },
    { task: 0 }
  ];
  const c = translated(s)!;
  expect(c.turns).toEqual([
    {
      steps: [
        {
          op: "queue",
          id: 0,
          via: "task",
          steps: [
            {
              op: "resolve",
              node: 1,
              which: "newest",
              key: "1:[2]#2",
              variantKeys: [null, "1:[3]#3"]
            },
            { op: "resolve", node: 0, which: "oldest", key: "0:[2]#1" }
          ]
        }
      ]
    },
    { task: 0 }
  ]);
});

test("affine translation rejects malformed, noninvertible and inexact questions", () => {
  for (const key of [
    "1:[4]#1",
    "0:[5]#1",
    "01:[5]#1",
    "1:[5.0]#1",
    "1:[5,7]#1",
    "1:[5]#01",
    "1:[x]#1",
    "1:[9007199254740992]#1",
    "1:[-0]#1"
  ]) {
    const s = affine();
    s.turns = [{ steps: [{ op: "resolve", node: 1, which: "newest", key }] }];
    expect(translated(s), key).toBeUndefined();
  }
  for (const factor of [0, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    const s = affine();
    s.nodes[0].factor = factor;
    expect(translated(s)).toBeUndefined();
  }
  const asyncParent = affine();
  asyncParent.nodes[0].delivery = "manual";
  expect(translated(asyncParent)).toBeUndefined();
});

test("removing a mounting mechanism retains unrelated callbacks and controls", () => {
  const s: Scenario = { ...chain(), version: 2, sources: [-1] };
  s.readers[0].mounted = true;
  s.turns = [
    {
      steps: [
        {
          op: "queue",
          id: 0,
          via: "microtask",
          steps: [
            { op: "mount", reader: 0, value: false },
            { op: "show", value: false }
          ]
        }
      ]
    }
  ];
  const before = structuredClone(s);
  const c = [...structuralReductions(s)].find(
    c => c.readers.length === 1 && c.readers[0].mounted === undefined
  )!;
  expect(c.turns).toEqual([
    {
      steps: [
        {
          op: "queue",
          id: 0,
          via: "microtask",
          steps: [{ op: "noop" }, { op: "show", value: false }]
        }
      ]
    }
  ]);
  expect(validate(c)).toBeUndefined();
  expect(s).toEqual(before);
});

test("direct tuple reads preserve input order and do not flatten async or branch computations", () => {
  const s = chain("sync");
  s.nodes[1].deps = [0, -1];
  const c = [...structuralReductions(s)].find(c => c.readers[0]?.refs.length === 3)!;
  expect(c.readers[0].refs).toEqual([-1, 0, -1]);
  expect(c.nodes).toEqual(s.nodes);
  s.nodes[1].delivery = "promise";
  expect([...structuralReductions(s)].some(c => c.readers[0]?.refs.length === 3)).toBe(false);
  s.nodes[1].delivery = "sync";
  s.nodes[1].branch = { condition: -1, otherwise: [0] };
  expect([...structuralReductions(s)].some(c => c.readers[0]?.refs.length === 3)).toBe(false);
});

test("joining event bodies retains work order, callback boundaries and explicit flushes", () => {
  const s = chain();
  s.turns = [
    { steps: [{ op: "write", value: 1 }, { op: "flush" }] },
    { steps: [{ op: "queue", id: 0, via: "task", step: { op: "write", value: 2 } }] },
    { task: 0 },
    { steps: [{ op: "write", value: 3 }] }
  ];
  const before = structuredClone(s);
  const candidates = [...reductionFamilies.turns(s)];
  const c = candidates.find(c => "steps" in c.turns[0] && c.turns[0].steps.length === 3)!;
  expect(c.turns).toEqual([
    {
      steps: [
        { op: "write", value: 1 },
        { op: "flush" },
        { op: "queue", id: 0, via: "task", step: { op: "write", value: 2 } }
      ]
    },
    { task: 0 },
    { steps: [{ op: "write", value: 3 }] }
  ]);
  expect(s).toEqual(before);
});

test("offsets can be removed together without translating captured questions", () => {
  const s = affine();
  const c = [...arithmeticReductions(s)].find(c => c.nodes.every(n => n.offset === 0))!;
  expect(c).toBeDefined();
  expect(c.turns).toEqual(s.turns);
  expect(s.nodes[0].offset).toBe(1);
});
