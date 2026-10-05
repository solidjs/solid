import { chain } from "./fixtures.js";
import { runScenario, type RunResult } from "./runner.js";
import { fingerprint, isSemanticFailure, shrink } from "./shrink.js";
import {
  coneReductions,
  lifecycleReductions,
  observationReductions,
  scheduleReductions
} from "./reduce.js";
import { validate, type Scenario } from "./scenario.js";
const fail = (r: RunResult, rule = "S1"): RunResult => ({
  ...r,
  status: "fail",
  failure: { rule, message: `synthetic ${rule}` }
});

test("discovery accepts another semantic bug and reports the final fingerprint", async () => {
  const baseline = await runScenario(chain("sync"));
  const original = fail(baseline);
  const run = async (scenario: Scenario) => fail({ ...baseline, scenario }, "L1");
  const reduced = await shrink(original, run, 10);
  expect(reduced.accepted).toBeGreaterThan(0);
  expect(fingerprint(reduced.result)).toBe("L1: synthetic L1");
  expect(reduced.reproKey).toMatch(/^L1: synthetic L1\n/);
  const focused = await shrink(original, run, 10, { mode: "focused" });
  expect(focused.accepted).toBe(0);
  expect(focused.result).toBe(original);
});

test("discovery rejects invalid, unsupported, waived and harness-failure outcomes", async () => {
  const baseline = await runScenario(chain("sync"));
  const original = fail(baseline);
  const rejected: RunResult[] = [
    ...(["pass", "policy", "invalid", "inapplicable", "limit", "error"] as const).map(status => ({
      ...original,
      status
    })),
    { ...original, error: "worker error" },
    { ...original, cleanupError: "cleanup error" },
    fail(baseline, "unregistered-rule"),
    fail(baseline, "W1"),
    {
      ...fail(baseline, "P1"),
      progress: [
        {
          failure: { rule: "P1", message: "waived" },
          outstanding: [],
          allowance: "legacy-disposal-wait"
        }
      ]
    }
  ];
  for (const result of rejected) {
    expect(isSemanticFailure(result)).toBe(false);
    expect((await shrink(original, async scenario => ({ ...result, scenario }), 1)).accepted).toBe(
      0
    );
  }
  expect(isSemanticFailure({ ...original, progress: rejected.at(-1)!.progress })).toBe(true);
});

test("waiting review cannot substitute for a bug but an explicit violation can", async () => {
  const baseline = await runScenario(chain("sync"));
  const frame = baseline.frames.at(-1)!;
  const result: RunResult = {
    ...fail(baseline, "W1"),
    waiting: {
      rule: "W1",
      message: "synthetic wait",
      policy: "required-only",
      disposition: "violation",
      scope: "other",
      before: frame,
      afterRetained: frame,
      after: frame,
      pending: [],
      retained: [],
      releases: [],
      recovered: true
    }
  };
  expect(isSemanticFailure(result)).toBe(true);
  for (const disposition of ["open", "allowed", "out-of-scope"] as const) {
    result.waiting!.disposition = disposition;
    expect(isSemanticFailure(result)).toBe(false);
  }
});

test("passing controls still constrain discovery and share its budget", async () => {
  const baseline = await runScenario(chain("sync")),
    original = fail(baseline);
  const run = vi.fn(async (scenario: Scenario) => fail({ ...baseline, scenario }, "L1"));
  const control = vi.fn(async (scenario: Scenario) =>
    scenario === original.scenario ? baseline : fail({ ...baseline, scenario })
  );
  const reduced = await shrink(original, run, 10, { control });
  expect(reduced.accepted).toBe(0);
  expect(reduced.attempts).toBe(run.mock.calls.length + control.mock.calls.length);
  expect(reduced.attempts).toBeLessThanOrEqual(10);
});

function optimistic(): Scenario {
  return {
    version: 2,
    sources: [-1, -2],
    anchors: [-2],
    anchorShow: false,
    optimistic: { proposals: [1], authoritative: 0 },
    nodes: [{ id: 0, deps: [-2], factor: 1, offset: 0, delivery: "manual" }],
    readers: [{ id: 0, refs: [-2, 0], gated: false, boundary: "none" }],
    show: true,
    turns: [{ steps: [{ op: "start-action" }] }],
    strict: true
  };
}

test("tuple projection keeps the data reader, order and unique anchors", () => {
  const s = optimistic();
  s.readers[0].refs = [-2, 0, -2];
  const original = JSON.stringify(s);
  const c = [...observationReductions(s)].find(c => c.readers[0]?.refs.length === 1)!;
  expect(c.anchors).toEqual([-2]);
  expect(c.readers[0].refs).toEqual([0]);
  expect(c.readers[0].id).toBe(0);
  expect(validate(c)).toBeUndefined();
  expect(JSON.stringify(s)).toBe(original);
  s.turns.push({ steps: [{ op: "click", reader: 0 }] });
  expect([...observationReductions(s)]).toHaveLength(0);
});

test("ordinary substitution remaps source roles and explicit authority without editing the input", () => {
  const s = optimistic();
  s.nodes.push({
    id: 1,
    deps: [-2],
    branch: { condition: -2, otherwise: [0] },
    factor: 1,
    offset: 0,
    delivery: "sync"
  });
  s.turns.push({ steps: [{ op: "read", ref: -2, mode: "plain" }, { op: "resume-action" }] });
  const original = JSON.stringify(s),
    c = [...lifecycleReductions(s)].find(c => !c.optimistic)!;
  expect(c.sources).toEqual([-1]);
  expect(c.anchors).toEqual([-1]);
  expect(c.nodes[1].branch).toEqual({ condition: -1, otherwise: [0] });
  expect(c.readers[0].refs).toEqual([-1, 0]);
  expect(c.turns).toEqual([
    { steps: [{ op: "write", source: -1, value: 1 }] },
    {
      steps: [
        { op: "read", ref: -1, mode: "plain" },
        { op: "write", source: -1, value: 0 }
      ]
    }
  ]);
  expect(validate(c)).toBeUndefined();
  expect(JSON.stringify(s)).toBe(original);
  s.readers[0].refs.push(-1);
  expect([...lifecycleReductions(s)]).toHaveLength(0);
});

test("proposal and authority change together when immediate completion is removed", () => {
  const s = optimistic();
  s.optimistic = { proposals: [0], authoritative: 2 };
  s.turns[0] = { steps: [{ op: "start-action" }, { op: "resume-action" }] };
  const c = [...lifecycleReductions(s)].find(c => c.optimistic?.proposals[0] === 2)!;
  expect(c.optimistic?.authoritative).toBe(0);
  expect(c.turns).toEqual([{ steps: [{ op: "start-action" }] }]);
  expect(validate(c)).toBeUndefined();
});

test("queue movement preserves other work and refuses addressed queues", () => {
  const s = optimistic();
  s.turns = [
    {
      steps: [
        { op: "queue", id: 0, via: "microtask", step: { op: "show", value: false } },
        { op: "start-action" }
      ]
    }
  ];
  const original = JSON.stringify(s),
    c = [...scheduleReductions(s)][0];
  expect(c.turns).toEqual([
    { steps: [{ op: "start-action" }] },
    { steps: [{ op: "show", value: false }] }
  ]);
  expect(validate(c)).toBeUndefined();
  expect(JSON.stringify(s)).toBe(original);
  s.turns.push({ steps: [{ op: "cancel", id: 0 }] });
  expect([...scheduleReductions(s)]).toHaveLength(0);
});

test("cone projection translates exact and paired occurrences and rejects mismatched inputs", () => {
  const s = optimistic();
  s.nodes = [
    { id: 0, deps: [-2, -2], factor: 2, offset: 0, delivery: "sync" },
    { id: 1, deps: [-2, 0], factor: 1, offset: 0, delivery: "manual" }
  ];
  s.readers[0].refs = [1];
  s.turns.push({
    steps: [
      {
        op: "resolve",
        node: 1,
        which: "oldest",
        key: "1:[3,12]#2",
        variantKeys: ["1:[3,12]#2", null]
      }
    ]
  });
  const original = JSON.stringify(s),
    c = [...coneReductions(s)][0];
  expect(c.nodes).toEqual([{ id: 1, deps: [-2], factor: 1, offset: 0, delivery: "manual" }]);
  expect(c.turns[1]).toEqual({
    steps: [
      { op: "resolve", node: 1, which: "oldest", key: "1:[3]#2", variantKeys: ["1:[3]#2", null] }
    ]
  });
  expect(validate(c)).toBeUndefined();
  expect(JSON.stringify(s)).toBe(original);
  s.turns[1] = { steps: [{ op: "resolve", node: 1, which: "newest", key: "1:[3,8]#2" }] };
  expect([...coneReductions(s)]).toHaveLength(0);
  s.turns.pop();
  s.readers[0].refs.push(0);
  expect([...coneReductions(s)]).toHaveLength(0);
});
