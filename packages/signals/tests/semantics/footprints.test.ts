import { Footprint, type PathWork } from "./footprints.js";
import { Model } from "./model.js";
import type { Scenario } from "./scenario.js";
import { validate } from "./scenario.js";
import { runScenario } from "./runner.js";
import { generate } from "./generate.js";
import { withWorker } from "./worker-fixture.js";

function branching(): Scenario {
  return {
    version: 2,
    sources: [-1, -2],
    show: true,
    nodes: [
      { id: 0, deps: [-1], delivery: "manual", factor: 1, offset: 0 },
      { id: 1, deps: [-1], delivery: "manual", factor: 2, offset: 0 },
      {
        id: 2,
        deps: [1],
        branch: { condition: -2, otherwise: [0] },
        delivery: "sync",
        factor: 1,
        offset: 0
      }
    ],
    readers: [{ id: 0, refs: [2], gated: false, boundary: "reset" }],
    turns: [
      { steps: [{ op: "write", source: -1, value: 1 }] },
      { steps: [{ op: "write", source: -2, value: 1 }] }
    ]
  };
}

test("branch history retains the exact witnessed flight without granting another flight permission", () => {
  const s = branching();
  const model = new Model(s);
  const path = new Footprint(model, s.readers[0]);
  const a: PathWork = { key: "0:[1]#1", node: 0, inputs: [1], state: "waiting" };
  const b: PathWork = { key: "1:[1]#1", node: 1, inputs: [1], state: "waiting" };
  const ids = [0, 1, 2];
  path.attempted = 1;
  const published = model.evaluate(0, { [-1]: 0, [-2]: 0 });
  path.update(
    model.evaluate(1, { [-1]: 1, [-2]: 0 }),
    published,
    true,
    true,
    id => (id === 0 ? a : undefined),
    ids,
    "A",
    1
  );
  expect(path.retained.has(a)).toBe(true);
  expect(path.retained.has(b)).toBe(false);
  path.update(
    model.evaluate(1, { [-1]: 1, [-2]: 1 }),
    published,
    false,
    true,
    id => (id === 1 ? b : undefined),
    ids,
    "B",
    2
  );
  expect(path.retained.has(a)).toBe(true);
  expect(path.retained.has(b)).toBe(true);
  expect(path.published[model.slots.get(0)!]).toBe(1);
  expect(path.requested[model.slots.get(0)!]).toBe(0);
  const replacement = { ...a, key: "0:[1]#2" };
  a.state = "resolved";
  path.update(
    model.evaluate(1, { [-1]: 1, [-2]: 1 }),
    published,
    false,
    true,
    id => (id === 0 ? replacement : id === 1 ? b : undefined),
    ids,
    "B again",
    2
  );
  expect(path.retained.has(a)).toBe(false);
  expect(path.retained.has(replacement)).toBe(false);
  path.clear();
  expect(path.retained.size).toBe(0);
});

test("a never-attempted reader gets no historical waiting permission", () => {
  const s = branching();
  const model = new Model(s);
  const path = new Footprint(model, s.readers[0]);
  const work: PathWork = { key: "0:[1]#1", node: 0, inputs: [1], state: "waiting" };
  path.update(
    model.evaluate(1),
    model.evaluate(0),
    false,
    true,
    () => work,
    [0, 1, 2],
    "unread",
    1
  );
  expect(path.retained.size).toBe(0);
});

test("branch changes under a Loading region finish with the selected answer", async () => {
  const result = await runScenario(branching());
  expect(["pass", "policy"], JSON.stringify(result)).toContain(result.status);
  expect(result.frames.at(-1)?.outputs[0]).toEqual([2]);
  expect(result.coverage).toContain("witnessed-fallback-work");
  expect(result.footprints?.[0].published).toContain(1);
  expect(result.footprints?.[0].published).not.toContain(0);
});

test("branch/fallback generation preserves scoped witnesses on replay", async () => {
  await withWorker(async client => {
    for (const s of generate(3350, 60, "branch-boundaries")) {
      expect(validate(s)).toBeUndefined();
      const a = await client.run(s);
      const b = await client.run(a.scenario);
      expect(["pass", "fail", "policy", "error"], JSON.stringify(a)).toContain(a.status);
      expect(b.status).toBe(a.status);
      expect(b.frames).toEqual(a.frames);
      expect(b.requirements).toEqual(a.requirements);
      expect(b.footprints).toEqual(a.footprints);
    }
  });
});
