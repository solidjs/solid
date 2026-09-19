import { chain } from "./fixtures.js";
import { focusedReductions, identityValues } from "./reduce.js";
import { reductions, fingerprint } from "./shrink.js";
import { normalize } from "./normalize.js";
import { runScenario } from "./runner.js";
import { evaluate, validate, type Scenario } from "./scenario.js";

function identity(): Scenario {
  const s = chain();
  for (const n of s.nodes) {
    n.factor = 1;
    n.offset = 0;
  }
  s.turns = [
    { steps: [{ op: "write", value: 7 }] },
    { steps: [{ op: "resolve", node: 0, which: "newest", key: "0:[7]#1" }] },
    { steps: [{ op: "write", value: 9 }] },
    { steps: [{ op: "resolve", node: 0, which: "newest", key: "0:[9]#1" }] },
    { steps: [{ op: "write", value: 7 }] },
    { steps: [{ op: "resolve", node: 0, which: "newest", key: "0:[7]#2" }] }
  ];
  s.strict = true;
  return s;
}

test("identity renaming preserves equality, exact request occurrences and published values", async () => {
  const s = identity(),
    before = structuredClone(s),
    c = identityValues(s)!;
  expect(validate(c)).toBeUndefined();
  expect(c.turns[5]).toEqual({
    steps: [{ op: "resolve", node: 0, which: "newest", key: "0:[1]#2" }]
  });
  const a = await runScenario(s),
    b = await runScenario(c);
  expect(a.status).toBe("pass");
  expect(b.status).toBe("pass");
  expect(b.frames.length).toBe(a.frames.length);
  const rename = (n: number) => (n === 7 ? 1 : n === 9 ? 2 : n);
  for (let i = 0; i < a.frames.length; i++) {
    expect(b.frames[i].at).toBe(a.frames[i].at);
    expect(b.frames[i].input).toBe(rename(a.frames[i].input));
    for (const reader in a.frames[i].outputs) {
      const value = a.frames[i].outputs[reader];
      expect(b.frames[i].outputs[reader]).toEqual(Array.isArray(value) ? value.map(rename) : value);
    }
  }
  expect(identityValues(c)).toBeUndefined();
  expect(s).toEqual(before);
});

test("identity renaming handles optimistic proposals and paired keys with the same bijection", () => {
  const s = identity();
  s.version = 2;
  s.sources = [-1, -2];
  s.optimistic = { proposals: [2, 1], authoritative: 0 };
  s.nodes[0].deps = [-2];
  s.turns = [
    { steps: [{ op: "start-action" }] },
    {
      steps: [
        {
          op: "resolve",
          node: 0,
          which: "oldest",
          key: "0:[2]#1",
          variantKeys: ["0:[1]#2", null]
        }
      ]
    }
  ];
  const c = identityValues(s)!;
  expect(c.optimistic).toEqual({ proposals: [1, 2], authoritative: 0 });
  expect(c.turns[1]).toEqual({
    steps: [
      { op: "resolve", node: 0, which: "oldest", key: "0:[1]#1", variantKeys: ["0:[2]#2", null] }
    ]
  });
});

test("identity renaming declines arithmetic, branches, sums, negative zero and unknown questions", () => {
  const variants = [identity(), identity(), identity(), identity()];
  variants[0].nodes[0].offset = 1;
  variants[1].nodes[0].branch = { condition: -1, otherwise: [-1] };
  variants[2].nodes[0].deps = [-1, -1];
  variants[3].turns.unshift({ steps: [{ op: "write", value: -0 }] });
  for (const s of variants) expect(identityValues(s)).toBeUndefined();
  for (const key of [
    "0:[99]#1",
    "00:[7]#1",
    "1:[7]#1",
    "0:[7,9]#1",
    "0:[7.0]#1",
    "0:[x]#1",
    "0:[7]#01"
  ]) {
    const s = identity();
    s.turns[1] = { steps: [{ op: "resolve", node: 0, which: "newest", key }] };
    expect(identityValues(s), key).toBeUndefined();
  }
});

test("affine composition retains answers while bypassing a synchronous dependency", async () => {
  const s = chain("sync");
  s.nodes[1].factor = 3;
  s.nodes[1].offset = 4;
  s.nodes[1].delivery = "promise";
  const c = [...focusedReductions(s)].find(c => c.nodes[1].deps[0] === -1)!;
  expect(c.nodes[1]).toEqual({ id: 1, deps: [-1], factor: 6, offset: 7, delivery: "promise" });
  for (const input of [0, 1, 2]) expect(evaluate(c, input).get(1)).toBe(evaluate(s, input).get(1));
  const a = await runScenario(s),
    b = await runScenario(c);
  expect(a.status).toBe("pass");
  expect(b.frames).toEqual(a.frames);
  s.nodes[0].delivery = "manual";
  expect([...focusedReductions(s)].some(c => c.nodes[1].deps[0] === -1)).toBe(false);
});

test("a leading proposal and its resume can be removed together", () => {
  const s = identity();
  s.version = 2;
  s.sources = [-1, -2];
  s.optimistic = { proposals: [0, 1, 3], authoritative: 0 };
  s.nodes[0].deps = [-2];
  s.turns = [
    { steps: [{ op: "start-action" }] },
    { steps: [{ op: "resume-action" }] },
    { steps: [{ op: "resolve", node: 0, which: "newest", key: "0:[1]#1" }] }
  ];
  const c = [...focusedReductions(s)].find(c => c.optimistic?.proposals.length === 2)!;
  expect(c.optimistic?.proposals).toEqual([1, 3]);
  expect(c.turns[0]).toEqual(s.turns[0]);
  expect(c.turns[1]).toEqual({ steps: [{ op: "noop" }] });
  expect(c.turns[2]).toEqual(s.turns[2]);
});

test("default observers remain reducible after syntax normalization", () => {
  const s: Scenario = { ...chain(), version: 2, sources: [-1], anchors: [-1], anchorShow: true };
  for (const input of [s, normalize(s)]) {
    const cs = [...reductions(input)];
    expect(cs.some(c => c.anchors?.length === 0)).toBe(true);
    expect(cs.some(c => c.anchorShow === false)).toBe(true);
  }
});

test("moving a first unmount into initial state retains the later remount", () => {
  const s: Scenario = {
    ...chain(),
    version: 2,
    sources: [-1],
    turns: [
      { steps: [{ op: "write", value: 1 }] },
      { steps: [{ op: "mount", reader: 0, value: false }] },
      { steps: [{ op: "mount", reader: 0, value: true }] }
    ]
  };
  s.readers[0].mounted = true;
  const c = [...focusedReductions(s)].find(c => c.readers[0].mounted === false)!;
  expect(c.turns[0]).toEqual(s.turns[0]);
  expect(c.turns[1]).toEqual({ steps: [{ op: "noop" }] });
  expect(c.turns[2]).toEqual(s.turns[2]);
});

test("format upgrade excludes the legacy disposal allowance scope", async () => {
  const s = chain();
  expect([...focusedReductions(s)].some(c => c.version === 2)).toBe(false);
  s.readers[0].gated = true;
  s.turns.push({ steps: [{ op: "show", value: false }] });
  const c = [...focusedReductions(s)].find(c => c.version === 2)!;
  expect(c.sources).toEqual([-1]);
  const a = await runScenario(s),
    b = await runScenario(c);
  expect(fingerprint(a)).toBeDefined();
  expect(fingerprint(b)).toBe(fingerprint(a));
  for (let i = 0; i < a.frames.length; i++) {
    expect(b.frames[i].input).toBe(a.frames[i].input);
    expect(b.frames[i].outputs).toEqual(a.frames[i].outputs);
  }
});
