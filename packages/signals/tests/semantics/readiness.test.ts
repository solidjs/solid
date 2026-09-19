import { readyControl } from "./fixtures.js";
import { generate } from "./generate.js";
import { runScenario } from "./runner.js";
import { validate } from "./scenario.js";
import { withWorker } from "./worker-fixture.js";

test("a rendered pending control guards an async read until it becomes ready", async () => {
  const s = readyControl();
  const r = await runScenario(s);
  expect(r.status, JSON.stringify(r)).toBe("pass");
  expect(r.clicks?.map(c => c.values)).toEqual([[4], [6]]);
  expect(r.frames.some(f => JSON.stringify(f.outputs[0]) === '{"pending":true}')).toBe(true);
  expect(r.frames.at(-1)?.outputs[0]).toEqual({ pending: false });
  expect(r.reads?.at(-1)?.verdict).toBe(false);
});

test("readiness generation preserves explicit clicks, pending probes and canonical replay", async () => {
  await withWorker(async client => {
    for (const s of generate(2928, 40, "readiness")) {
      expect(validate(s)).toBeUndefined();
      const a = await client.run(s);
      const b = await client.run(a.scenario);
      expect(["pass", "fail", "policy", "error"], JSON.stringify(a)).toContain(a.status);
      expect(b.status).toBe(a.status);
      expect(b.frames).toEqual(a.frames);
      expect(b.clicks).toEqual(a.clicks);
      expect(b.reads).toEqual(a.reads);
    }
  });
});

test("readiness verdicts are outside exact data-trace delivery equivalence", async () => {
  const { variants } = await import("./equivalence.js");
  expect(() => variants(readyControl())).toThrow("excludes observable readiness verdicts");
});

test("readiness reduction removes the feature and only its guarded clicks", async () => {
  const { reductions } = await import("./shrink.js");
  const reduced = [...reductions(readyControl())].find(
    s => s.readers.length && !s.readers[0].pending
  );
  expect(reduced).toBeDefined();
  expect(validate(reduced!)).toBeUndefined();
  expect(JSON.stringify(reduced!.turns)).not.toContain('"click"');
  expect(JSON.stringify(reduced!.turns)).toContain('"write"');
});

test("A24 catches false verdicts over distinct held answers without requiring a click", async () => {
  const { checkPending } = await import("./rules.js");
  const s = readyControl();
  const frame = {
    at: "after flush",
    input: 0,
    inputs: { [-1]: 0 },
    show: true,
    outputs: { 0: { pending: false } }
  };
  expect(checkPending(s, frame, { [-1]: 1 })).toMatchObject({ rule: "R4", reader: 0 });
  frame.outputs[0].pending = true;
  expect(checkPending(s, frame, { [-1]: 1 })).toBeUndefined();
  frame.outputs[0].pending = false;
  expect(checkPending(s, frame, { [-1]: 0 })).toBeUndefined();
  s.anchors = [];
  expect(checkPending(s, frame, { [-1]: 1 })).toBeUndefined();
});

test("A24's held-answer check does not infer pending from unrelated or equal-answer work", async () => {
  const { checkPending } = await import("./rules.js");
  const s = readyControl();
  s.sources!.push(-2);
  const frame = {
    at: "after flush",
    input: 0,
    inputs: { [-1]: 0, [-2]: 0 },
    show: true,
    outputs: { 0: { pending: false } }
  };
  expect(checkPending(s, frame, { [-1]: 0, [-2]: 1 })).toBeUndefined();
  s.nodes[0].factor = 0;
  expect(checkPending(s, frame, { [-1]: 1, [-2]: 1 })).toBeUndefined();
  s.nodes[0].factor = 2;
  s.readers[0].mounted = true;
  expect(checkPending(s, frame, { [-1]: 1, [-2]: 1 })).toBeUndefined();
});

test("the held sync-memo verdict candidate is independent of completion probes", async () => {
  const s = readyControl();
  s.nodes = [
    { id: 0, deps: [-1], factor: 1, offset: 0, delivery: "sync" },
    { id: 1, deps: [-1], factor: 1, offset: 0, delivery: "manual" }
  ];
  s.readers[0].refs = [0];
  s.readers.push({ id: 1, refs: [1], gated: false, boundary: "none" });
  s.turns = [{ steps: [{ op: "write", value: 1 }] }];
  const a = await runScenario(s);
  const b = await runScenario(s, { completionProbes: false });
  expect(b.status).toBe(a.status);
  expect(b.failure).toEqual(a.failure);
  expect(b.frames).toEqual(a.frames);
  expect(a.coverage).toContain("tracked-held-answer-verdict");
});

test.each([1, 2, 3])(
  "pending verdicts propagate through %i synchronous numeric memos",
  async pendingDepth => {
    const s = readyControl();
    s.readers[0].pendingDepth = pendingDepth;
    const r = await runScenario(s);
    expect(r.status, JSON.stringify(r)).toBe("pass");
    expect(r.coverage).toContain("derived-pending-verdict");
    expect(r.clicks?.map(c => c.values)).toEqual([[4], [6]]);
    expect(
      r.frames.some(
        f =>
          typeof f.outputs[0] === "object" && !Array.isArray(f.outputs[0]) && f.outputs[0].pending
      )
    ).toBe(true);
  }
);

test("derived readiness has structural reductions and exact replay", async () => {
  const { reductions } = await import("./shrink.js");
  await withWorker(async client => {
    for (const s of generate(2928, 40, "derived-readiness")) {
      expect(validate(s)).toBeUndefined();
      expect(
        [...reductions(s)].some(
          c =>
            !validate(c) &&
            c.readers.length === s.readers.length &&
            c.readers[0].pendingDepth !== s.readers[0].pendingDepth
        )
      ).toBe(true);
      const a = await client.run(s);
      const b = await client.run(a.scenario);
      expect(["pass", "fail", "policy", "error"], JSON.stringify(a)).toContain(a.status);
      expect(b.status).toBe(a.status);
      expect(b.frames).toEqual(a.frames);
      expect(b.clicks).toEqual(a.clicks);
    }
  });
});

test("an optimistic override is verdict-inert while its parent is held (A24)", async () => {
  const s = readyControl();
  s.sources = [-1, -2];
  s.nodes = [];
  s.readers[0].refs = [-2];
  s.readers[0].pendingDepth = 2;
  s.optimistic = { proposals: [1], authoritative: 0, hold: true };
  s.turns = [{ steps: [{ op: "start-action" }] }, { steps: [{ op: "click", reader: 0 }] }];
  const r = await runScenario(s);
  expect(r.status, JSON.stringify(r)).toBe("pass");
  expect(r.clicks?.at(-1)?.values).toEqual([1]);
  expect(r.frames.at(-1)?.outputs[0]).toEqual({ pending: false });
});

test("optimistic readiness generation keeps guarded clicks and reproducible lifetimes", async () => {
  await withWorker(async client => {
    for (const s of generate(2928, 40, "optimistic-readiness")) {
      expect(validate(s)).toBeUndefined();
      const a = await client.run(s);
      const b = await client.run(a.scenario);
      expect(["pass", "fail", "policy", "error"], JSON.stringify(a)).toContain(a.status);
      expect(b.status).toBe(a.status);
      expect(b.frames).toEqual(a.frames);
      expect(b.clicks).toEqual(a.clicks);
    }
  });
});
