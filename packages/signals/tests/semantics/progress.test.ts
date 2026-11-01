import { Model } from "./model.js";
import { chain, releasedFallback, disposedReader } from "./fixtures.js";
import { checkProgress, progressScope } from "./progress.js";
import { progressAllowance, type Observation } from "./policy.js";
import { runScenario } from "./runner.js";

const witnessed: Observation[] = [{ reader: 0, write: 1, at: "request", disposedAt: "dispose" }];

test("historical disposal allowance is explicit and confined to exact witnessed work", () => {
  const outstanding = [{ key: "first", observations: witnessed }];
  expect(progressAllowance([], true, 1, outstanding)).toBeUndefined();
  expect(progressAllowance(["legacy-disposal-wait"], true, 1, outstanding)).toBe(
    "legacy-disposal-wait"
  );
  expect(progressAllowance(["legacy-disposal-wait"], false, 1, outstanding)).toBeUndefined();
  expect(progressAllowance(["legacy-disposal-wait"], true, 2, outstanding)).toBeUndefined();
  expect(progressAllowance(["legacy-disposal-wait"], true, 1, [])).toBeUndefined();
  outstanding.push({ key: "new-descendant", observations: [] });
  expect(progressAllowance(["legacy-disposal-wait"], true, 1, outstanding)).toBeUndefined();
});

test("published fallback releases source progress but a live outside reader can still hold it", () => {
  const s = releasedFallback();
  const model = new Model(s);
  const frame = {
    at: "drain",
    input: 0,
    inputs: { [-1]: 1, [-2]: 0 },
    show: true,
    outputs: { 0: "loading" as const }
  };
  const req = [
    {
      reader: 0,
      node: 1,
      inputs: [1, 1],
      gate: "waiting" as const,
      fallback: true,
      basis: "desired" as const
    }
  ];
  expect(checkProgress(s, frame, { [-1]: 1, [-2]: 1 }, true, {}, req, model)?.rule).toBe("P1");
  s.readers.push({ id: 1, refs: [1], gated: false, boundary: "none" });
  req.push({ ...req[0], reader: 1 });
  expect(
    checkProgress(
      s,
      { ...frame, outputs: { ...frame.outputs, 1: [0] } },
      { [-1]: 1, [-2]: 1 },
      true,
      {},
      req,
      new Model(s)
    )
  ).toBeUndefined();
});

test("unsettled observation controls are outside the sufficient progress proof", () => {
  const s = chain();
  s.readers[0].gated = true;
  const frame = { at: "drain", input: 0, show: false, outputs: { 0: "hidden" as const } };
  expect(checkProgress(s, frame, { [-1]: 1 }, true, {}, [], new Model(s))).toBeUndefined();
});

test("progress scope does not guess action, branch, readiness or partial-anchor ownership", () => {
  for (const s of [
    { ...chain(), optimistic: { proposals: [1], authoritative: 2 } },
    { ...chain(), anchors: [] },
    {
      ...chain(),
      readers: [{ id: 0, refs: [0], gated: false, boundary: "none" as const, pending: true }]
    }
  ])
    expect(progressScope(s, new Model(s))).toBe(false);
});

test.each(["disposal", "fallback"])(
  "%s publishes ordinary sources before abandoned/covered requests finish",
  async kind => {
    const result = await runScenario(kind === "disposal" ? disposedReader() : releasedFallback());
    expect(result.status, JSON.stringify(result)).toBe("pass");
    expect(result.progress).toBeUndefined();
    const frame = result.frames.findLast(f => f.at === "turn 1");
    if (kind === "disposal") expect(frame?.input).toBe(1);
    else {
      expect(frame?.inputs).toEqual({ [-1]: 1, [-2]: 1 });
      expect(frame?.outputs[0]).toBe("loading");
    }
  }
);

test.each(["disposal", "fallback"])("%s preserves another reader's blocker", async kind => {
  const s = kind === "disposal" ? disposedReader() : releasedFallback();
  s.readers.push({ id: 1, refs: [1], gated: false, boundary: "none" });
  const result = await runScenario(s);
  expect(result.status, JSON.stringify(result)).toBe("pass");
  const frame = result.frames.findLast(f => f.at === "turn 1");
  expect(kind === "disposal" ? frame?.input : frame?.inputs?.[-2]).toBe(0);
});
