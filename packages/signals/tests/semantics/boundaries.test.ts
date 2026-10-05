import { runScenario } from "./runner.js";
import { checkFrame, type Frame } from "./rules.js";
import { generate } from "./generate.js";
import { validate, type Scenario } from "./scenario.js";
import { reductions } from "./shrink.js";
import { withWorker } from "./worker-fixture.js";

function disjoint(): Scenario {
  return {
    version: 2,
    sources: [-1, -2],
    show: true,
    nodes: [
      { id: 0, deps: [-1], factor: 1, offset: 0, delivery: "manual" },
      { id: 1, deps: [-2], factor: 1, offset: 0, delivery: "manual" }
    ],
    readers: [
      { id: 0, refs: [0], gated: false, boundary: "reset" },
      { id: 1, refs: [1], gated: false, boundary: "reset" }
    ],
    turns: [
      {
        steps: [
          { op: "write", source: -1, value: 1 },
          { op: "write", source: -2, value: 1 }
        ]
      },
      { steps: [{ op: "resolve", node: 0, which: "newest" }] },
      { steps: [{ op: "resolve", node: 1, which: "newest" }] }
    ]
  };
}

test("separate Loading regions publish fallbacks and resolve independently", async () => {
  const result = await runScenario(disjoint());
  expect(result.status, JSON.stringify(result)).toBe("pass");
  expect(result.coverage).toContain("multiple-published-fallbacks");
  expect(result.coverage).toContain("fallback-beside-content");
  expect(
    result.frames.some(f => f.outputs[1] === "loading" && JSON.stringify(f.outputs[0]) === "[1]")
  ).toBe(true);
  expect((await runScenario(result.scenario)).frames).toEqual(result.frames);
});

test("a fallback never excuses another region's incoherent content", () => {
  const s = disjoint();
  const frame: Frame = {
    at: "control",
    input: 1,
    inputs: { [-1]: 1, [-2]: 1 },
    show: true,
    outputs: { 0: "loading", 1: [1] }
  };
  expect(checkFrame(s, frame)).toBeUndefined();
  frame.outputs[1] = [0];
  expect(checkFrame(s, frame)).toMatchObject({ rule: "S1", reader: 1 });
});

test("boundary removal is a valid structural reduction", () => {
  expect(
    [...reductions(disjoint())].some(
      s => !validate(s) && s.readers.length === 2 && s.readers[0].boundary === "none"
    )
  ).toBe(true);
});

test("generated boundary regions retain canonical replay", async () => {
  await withWorker(async client => {
    for (const s of generate(3347, 50, "boundaries")) {
      expect(validate(s)).toBeUndefined();
      const a = await client.run(s);
      const b = await client.run(a.scenario);
      expect(["pass", "fail", "policy", "error"], JSON.stringify(a)).toContain(a.status);
      expect(b.status).toBe(a.status);
      expect(b.frames).toEqual(a.frames);
      expect(b.requirements).toEqual(a.requirements);
    }
  });
});

test("an inner boundary can load while its outer region keeps showing content", async () => {
  const s = disjoint();
  s.readers[1].parent = 0;
  s.turns = [
    {
      steps: [
        { op: "write", source: -1, value: 1 },
        { op: "write", source: -2, value: 1 }
      ]
    },
    { steps: [{ op: "resolve", node: 0, which: "newest" }] },
    { steps: [{ op: "resolve", node: 1, which: "newest" }] }
  ];
  const r = await runScenario(s);
  expect(r.status, JSON.stringify(r)).toBe("pass");
  expect(r.coverage).toContain("nested-content-covered");
  expect(r.coverage).toContain("inner-fallback-beside-parent-content");
  expect(r.frames.some(f => f.outputs[0] === "loading" && f.outputs[1] === "covered")).toBe(true);
  expect((await runScenario(r.scenario)).frames).toEqual(r.frames);
});

test("an unbounded child sends its loading to the outer boundary", async () => {
  const s = disjoint();
  s.readers[1].parent = 0;
  s.readers[1].boundary = "none";
  const r = await runScenario(s);
  expect(r.status, JSON.stringify(r)).toBe("pass");
  expect(r.coverage).toContain("nested-content-covered");
  expect(r.coverage).not.toContain("inner-fallback-beside-parent-content");
  expect(r.frames.at(-1)?.outputs).toEqual({ 0: [1], 1: [1] });
});

test("nested-region checks distinguish covered content from a stale visible child", () => {
  const s = disjoint();
  s.readers[1].parent = 0;
  const frame: Frame = {
    at: "control",
    input: 1,
    inputs: { [-1]: 1, [-2]: 1 },
    show: true,
    outputs: { 0: "loading", 1: "covered" }
  };
  expect(checkFrame(s, frame)).toBeUndefined();
  frame.outputs[0] = [1];
  expect(checkFrame(s, frame)).toMatchObject({ rule: "S2", reader: 1 });
  frame.outputs[1] = [0];
  expect(checkFrame(s, frame)).toMatchObject({ rule: "S1", reader: 1 });
});

test("nested generation and flattening reduction preserve exact replay", async () => {
  await withWorker(async client => {
    for (const s of generate(3347, 60, "nested")) {
      expect(validate(s)).toBeUndefined();
      expect(
        [...reductions(s)].some(
          r =>
            !validate(r) &&
            r.readers.length === s.readers.length &&
            r.readers.some((reader, i) => reader.parent !== s.readers[i].parent)
        )
      ).toBe(true);
      const a = await client.run(s);
      const b = await client.run(a.scenario);
      expect(["pass", "fail", "policy", "error"], JSON.stringify(a)).toContain(a.status);
      expect(b.status).toBe(a.status);
      expect(b.frames).toEqual(a.frames);
      expect(b.requirements).toEqual(a.requirements);
    }
  });
});
