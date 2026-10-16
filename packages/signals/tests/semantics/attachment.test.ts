import { generate } from "./generate.js";
import { runScenario, type RunResult } from "./runner.js";
import { validate, type Scenario } from "./scenario.js";
import { fingerprint, shrink } from "./shrink.js";

function chain(): Scenario {
  return {
    version: 2,
    sources: [-1],
    show: true,
    nodes: [
      { id: 0, deps: [-1], factor: 1, offset: 0, delivery: "manual" },
      { id: 1, deps: [0], factor: 1, offset: 0, delivery: "manual" }
    ],
    readers: [
      {
        id: 0,
        refs: [1],
        gated: false,
        boundary: "none",
        render: { on: 0, target: "portal", scheduled: true }
      }
    ],
    turns: [
      { steps: [{ op: "write", value: 1 }] },
      { steps: [{ op: "resolve", node: 0, which: "newest" }] },
      { steps: [{ op: "resolve", node: 1, which: "newest" }] }
    ]
  };
}

test("attachment replay rejects unsupported renderer patterns", () => {
  const s = chain();
  expect(validate(s)).toBeUndefined();
  s.readers[0].render!.scheduled = false;
  expect(validate(s)).toContain("scheduled portals");
  s.readers[0].render!.scheduled = true;
  s.readers[0].render!.on = 2;
  expect(validate(s)).toBeDefined();
});

test("#3404 shape measures output removal, and remains replayable after the runtime fixes it", async () => {
  const result = await runScenario(chain());
  expect(["pass", "fail"], result.error).toContain(result.status);
  expect(result.attachment!.checks).toBeGreaterThan(0);
  expect(result.frames[0].outputs[0]).toEqual([0]);
  expect(result.frames.at(-1)!.outputs[0]).toEqual([1]);
  if (result.failure) {
    expect(result.failure.rule).toBe("A1");
    expect(result.failure.message).toBe("Visible output disappeared before replacement or removal");
    expect(result.failure.frame!.outputs[0]).toBe("absent");
    const reduced = await shrink(result, runScenario, 40);
    expect(fingerprint(reduced.result)).toBe(fingerprint(result));
    expect(reduced.result.scenario.readers.some(r => r.render)).toBe(true);
    expect((await runScenario(reduced.result.scenario)).failure).toEqual(reduced.result.failure);
  }
  const replay = await runScenario(result.scenario);
  expect(replay.frames).toEqual(result.frames);
  expect(replay.failure).toEqual(result.failure);
});

test("synchronous detached preparation and explicit removal preserve visible output", async () => {
  for (const target of ["local", "portal"] as const) {
    const s = chain();
    for (const node of s.nodes) node.delivery = "sync";
    s.readers[0].render!.target = target;
    s.readers[0].render!.scheduled = target === "portal";
    s.turns = [{ steps: [{ op: "write", value: 1 }] }, { steps: [{ op: "dispose", reader: 0 }] }];
    const result = await runScenario(s);
    expect(result.status, JSON.stringify(result)).toBe("pass");
    expect(result.frames.at(-1)!.outputs[0]).toBe("absent");
  }
});

test("attachment generation is valid, reproducible and independent of cleanup order", async () => {
  const cases = generate(3404, 30, "attachment");
  const results: RunResult[] = [];
  expect(generate(3404, 30, "attachment")).toEqual(cases);
  for (const s of cases) {
    expect(validate(s)).toBeUndefined();
    const result = await runScenario(s);
    expect(["pass", "fail"], result.error).toContain(result.status);
    results.push(result);
  }
  for (let i = results.length - 1; i >= 0; i--) {
    const result = results[i];
    const replay = await runScenario(result.scenario);
    expect(replay.frames).toEqual(result.frames);
    expect(fingerprint(replay)).toEqual(fingerprint(result));
  }
});
