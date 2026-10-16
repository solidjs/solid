import { separateUpdates } from "./fixtures.js";
import { runScenario } from "./runner.js";
import type { Scenario } from "./scenario.js";
import { Groups } from "./groups.js";
import { Model } from "./model.js";

const independent = separateUpdates;

test.each([0, 1])("one shared effect permits independent publication, first=%s", async first => {
  const s = independent();
  s.turns[2] = { steps: [{ op: "resolve", node: first, which: "newest" }] };
  const r = await runScenario(s);
  expect(r.status, JSON.stringify(r)).toBe("pass");
  expect(r.frames.findLast(f => f.at === "turn 2")?.inputs).toEqual({
    [-1]: first === 0 ? 1 : 0,
    [-2]: first === 1 ? 1 : 0
  });
  expect(r.groups?.events).toContain(`group ${first} published`);
});

test("same-block writes cannot be mistaken for independent updates", async () => {
  const s = independent();
  s.turns.splice(0, 2, {
    steps: [
      { op: "write", source: -1, value: 1 },
      { op: "write", source: -2, value: 1 }
    ]
  });
  const r = await runScenario(s);
  expect(r.status, JSON.stringify(r)).toBe("pass");
  expect(r.frames.findLast(f => f.at === "turn 1")?.inputs).toEqual({ [-1]: 0, [-2]: 0 });
});

test("same-source overlap joins, but a published update is retired before the next write", async () => {
  const s = independent();
  s.turns = [
    { steps: [{ op: "write", value: 1 }] },
    { steps: [{ op: "write", value: 2 }] },
    { steps: [{ op: "resolve", node: 0, which: "newest" }] },
    { steps: [{ op: "write", value: 3 }] }
  ];
  const r = await runScenario(s);
  expect(r.status, JSON.stringify(r)).toBe("pass");
  expect(r.groups?.events).toContain("group 1 joins 0: same source");
  expect(r.groups?.events).toContain("group 0 published");
  expect(r.groups?.events).toContain("group 2 published");
});

test.each([true, false])("two authoritative actions, together=%s", async together => {
  const s = independent();
  s.actions = [
    { id: 0, segments: [[{ source: -1, value: 1 }], []] },
    { id: 1, segments: [[{ source: -2, value: 1 }], []] }
  ];
  s.turns = together
    ? [
        {
          steps: [
            { op: "start-action", action: 0 },
            { op: "start-action", action: 1 }
          ]
        }
      ]
    : [
        { steps: [{ op: "start-action", action: 0 }] },
        { steps: [{ op: "start-action", action: 1 }] }
      ];
  s.turns.push(
    {
      steps: [
        { op: "resolve", node: 0, which: "newest" },
        { op: "resolve", node: 1, which: "newest" }
      ]
    },
    { steps: [{ op: "resume-action", action: 0 }] }
  );
  const r = await runScenario(s);
  expect(r.status, JSON.stringify(r)).toBe("pass");
  expect(r.frames.findLast(f => f.at === `turn ${s.turns.length - 1}`)?.inputs).toEqual({
    [-1]: together ? 0 : 1,
    [-2]: 0
  });
  expect(r.actionScripts?.every(a => a.ended)).toBe(true);
});

test("an action continuation keeps its group across yields", async () => {
  const s = independent();
  s.actions = [{ id: 4, segments: [[{ source: -1, value: 1 }], [{ source: -1, value: 2 }], []] }];
  s.turns = [
    { steps: [{ op: "start-action", action: 4 }] },
    { steps: [{ op: "write", source: -2, value: 1 }] },
    { steps: [{ op: "resume-action", action: 4 }] },
    {
      steps: [
        { op: "resolve", node: 0, which: "newest" },
        { op: "resolve", node: 1, which: "newest" }
      ]
    }
  ];
  const r = await runScenario(s);
  expect(r.status, JSON.stringify(r)).toBe("pass");
  expect(r.frames.findLast(f => f.at === "turn 3")?.inputs).toEqual({ [-1]: 0, [-2]: 1 });
  expect(r.frames.at(-1)?.inputs).toEqual({ [-1]: 2, [-2]: 1 });
});

test("possible memo grouping affects deadlines, never mandatory joint publication", () => {
  const s = independent();
  s.nodes.push({ id: 2, deps: [-1, -2], factor: 1, offset: 0, delivery: "sync" });
  const model = new Model(s);
  const groups = new Groups(model, s.readers);
  const frame = { at: "test", input: 0, inputs: { [-1]: 0, [-2]: 0 }, show: true, outputs: {} };
  groups.write(-1, 1, frame);
  groups.closeBatch();
  groups.write(-2, 1, frame);
  groups.closeBatch();
  expect(
    groups.progress(frame, [
      { reader: 1, node: 1, inputs: [1], gate: "waiting", fallback: false, basis: "desired" }
    ])
  ).toBeUndefined();
  expect(groups.possibleJoins).toBeGreaterThan(0);
  expect(groups.publication({ ...frame, inputs: { [-1]: 1, [-2]: 0 } })).toBeUndefined();
});

test("update-group generation is valid, deterministic and replayable", async () => {
  const { generate } = await import("./generate.js");
  const { validate } = await import("./scenario.js");
  const scenarios = generate(3392, 40, "update-groups");
  expect(generate(3392, 40, "update-groups")).toEqual(scenarios);
  for (const s of scenarios) {
    expect(validate(s)).toBeUndefined();
    const r = await runScenario(s);
    expect(["pass", "fail", "policy"], JSON.stringify(r)).toContain(r.status);
    const disabled = await runScenario(r.scenario, { groupChecks: false });
    expect(disabled.frames).toEqual(r.frames);
    const replay = await runScenario(r.scenario);
    expect(replay.status).toBe(r.status);
    expect(replay.frames).toEqual(r.frames);
    expect(replay.groups).toEqual(r.groups);
    expect(replay.actionScripts).toEqual(r.actionScripts);
  }
});

test("action replay rejects invalid identities, sources and unbounded scripts", async () => {
  const { validate } = await import("./scenario.js");
  const s = independent();
  s.actions = [{ id: 0, segments: [[{ source: -1, value: 1 }], []] }];
  s.turns = [{ steps: [{ op: "start-action", action: 9 }] }];
  expect(validate(s)).toBe("Invalid operation");
  s.turns = [{ steps: [{ op: "start-action", action: 0 }] }];
  s.actions[0].segments[0][0].source = -3;
  expect(validate(s)).toBe("Invalid action segment");
  s.actions[0].segments = [[], [], [], [], [], []];
  expect(validate(s)).toBe("Invalid action script");
});

test("a changed shared derivation still needs foreign async ancestors after their source published", () => {
  const s = independent();
  s.nodes.push({ id: 2, deps: [0, -2], factor: 1, offset: 0, delivery: "sync" });
  s.readers = [{ id: 0, refs: [2], gated: false, boundary: "none" }];
  const model = new Model(s);
  const groups = new Groups(model, s.readers);
  const frame = { at: "test", input: 0, inputs: { [-1]: 0, [-2]: 0 }, show: true, outputs: {} };
  groups.write(-2, 1, frame);
  groups.closeBatch();
  expect(
    groups.progress(frame, [
      { reader: 0, node: 0, inputs: [0], gate: "waiting", fallback: false, basis: "desired" }
    ])
  ).toBeUndefined();
  expect(
    groups.progress(frame, [
      { reader: 0, node: 0, inputs: [0], gate: "resolved", fallback: false, basis: "desired" }
    ])?.rule
  ).toBe("G2");
});

function groupFrame(a = 0, b = 0) {
  return { at: "test", input: a, inputs: { [-1]: a, [-2]: b }, show: true, outputs: {} };
}
const waitingB = [
  {
    reader: 1,
    node: 1,
    inputs: [1],
    gate: "waiting" as const,
    fallback: false,
    basis: "desired" as const
  }
];

test.each([false, true])(
  "adjacent callbacks permit either publication choice, independent=%s",
  independent => {
    const s = separateUpdates();
    const groups = new Groups(new Model(s), s.readers);
    groups.write(-1, 1, groupFrame());
    groups.closeBatch();
    groups.write(-2, 1, groupFrame());
    groups.closeBatch();
    const frame = independent ? groupFrame(1, 0) : groupFrame();
    expect(groups.publication(frame)).toBeUndefined();
    expect(groups.progress(frame, waitingB)).toBeUndefined();
    expect(groups.batchingHeld).toBe(independent ? 0 : 1);
    expect(groups.publication(groupFrame(1, 1))).toBeUndefined();
    expect(groups.pending).toBe(false);
  }
);

test("same-callback writes still require joint publication", () => {
  const s = separateUpdates();
  const groups = new Groups(new Model(s), s.readers);
  groups.write(-1, 1, groupFrame());
  groups.write(-2, 1, groupFrame());
  expect(groups.publication(groupFrame(1, 0))?.rule).toBe("G1");
});

test.each(["task", "flush"])(
  "a %s separator does not introduce temporal entanglement",
  separator => {
    const s = separateUpdates();
    const groups = new Groups(new Model(s), s.readers);
    groups.write(-1, 1, groupFrame());
    if (separator === "task") groups.beginTask();
    else groups.separator();
    groups.write(-2, 1, groupFrame());
    expect(groups.progress(groupFrame(), waitingB)?.rule).toBe("G2");
    expect(groups.batchingHeld).toBe(0);
  }
);

test("a landing can introduce proximity to an older update, without adopting its identity", () => {
  const s = separateUpdates();
  const groups = new Groups(new Model(s), s.readers);
  groups.write(-1, 1, groupFrame());
  groups.beginTask();
  groups.write(-2, 1, groupFrame());
  groups.landing(1);
  expect(groups.progress(groupFrame(), waitingB)).toBeUndefined();
  expect(groups.batchingHeld).toBe(1);
  expect(groups.publication(groupFrame(1, 0))).toBeUndefined();
});

test("temporal permission ends with the relevant groups, not future source generations", () => {
  const s = separateUpdates();
  const groups = new Groups(new Model(s), s.readers);
  groups.write(-1, 1, groupFrame());
  groups.closeBatch();
  groups.write(-2, 1, groupFrame());
  expect(groups.publication(groupFrame(0, 1))).toBeUndefined();
  groups.beginTask();
  groups.write(-2, 2, groupFrame(0, 1));
  expect(groups.progress(groupFrame(0, 1), waitingB)?.rule).toBe("G2");
});

test("temporal permission never excuses failure to publish after all work resolves", () => {
  const s = separateUpdates();
  const groups = new Groups(new Model(s), s.readers);
  groups.write(-1, 1, groupFrame());
  groups.closeBatch();
  groups.write(-2, 1, groupFrame());
  expect(groups.progress(groupFrame(), waitingB)).toBeUndefined();
  groups.beginTask(); // the possible join persists while both groups remain live
  expect(groups.progress(groupFrame(), waitingB)).toBeUndefined();
  expect(groups.progress(groupFrame(), [])?.rule).toBe("G2");
});

test("adjacency to an action with no writes yet can extend a deadline", () => {
  const s = separateUpdates();
  const groups = new Groups(new Model(s), s.readers);
  groups.startAction(0, groupFrame());
  groups.closeBatch();
  groups.write(-1, 1, groupFrame());
  expect(groups.progress(groupFrame(), [])).toBeUndefined();
  expect(groups.batchingHeld).toBe(1);
  groups.finishAction(0);
  expect(groups.progress(groupFrame(), [])?.rule).toBe("G2");
});

test("both orderings around the scheduled flush use possible, not proven, batching", async () => {
  for (const before of [false, true]) {
    const s = separateUpdates();
    const write = { op: "write" as const, source: -1, value: 1 };
    const queued = {
      op: "queue" as const,
      id: 0,
      via: "microtask" as const,
      step: { op: "write" as const, source: -2, value: 1 }
    };
    s.turns.splice(0, 2, { steps: before ? [queued, write] : [write, queued] });
    const r = await runScenario(s);
    expect(r.status, JSON.stringify(r)).toBe("pass");
    expect(r.groups?.events).toContain("groups 1 and 0 may join: adjacent microtasks");
    expect(r.groups?.events.some(e => e.includes("joins"))).toBe(false);
  }
});

test("the unused fulfilled memo's batch adoption is permitted and recorded", async () => {
  const s = separateUpdates();
  s.nodes.push({ id: 2, deps: [-1], factor: 1, offset: 0, delivery: "promise" });
  // B has no async dependency; A's unused memo can nevertheless absorb its write.
  s.nodes.splice(1, 1);
  s.readers = [{ id: 0, refs: [0], gated: false, boundary: "none" }];
  s.turns = [
    {
      steps: [
        { op: "write", source: -1, value: 1 },
        { op: "queue", id: 0, via: "microtask", step: { op: "write", source: -2, value: 1 } }
      ]
    }
  ];
  const r = await runScenario(s);
  expect(r.status, JSON.stringify(r)).toBe("pass");
  expect(r.groups?.batchingHeld).toBeGreaterThan(0);
  const replay = await runScenario(r.scenario);
  expect(replay.groups).toEqual(r.groups);
  expect(replay.frames).toEqual(r.frames);
});

test("a result from an older task records its new neighboring write through the landing hook", async () => {
  const s = separateUpdates();
  s.nodes = [
    { id: 0, deps: [-1], factor: 1, offset: 0, delivery: "manual" },
    { id: 2, deps: [-1], factor: 1, offset: 0, delivery: "manual" }
  ];
  s.readers = [{ id: 0, refs: [0], gated: false, boundary: "none" }];
  s.turns = [
    { steps: [{ op: "write", source: -1, value: 1 }] },
    {
      steps: [
        { op: "queue", id: 0, via: "microtask", step: { op: "write", source: -2, value: 1 } },
        { op: "resolve", node: 2, which: "newest" }
      ]
    }
  ];
  const r = await runScenario(s);
  expect(r.status, JSON.stringify(r)).toBe("pass");
  expect(r.groups?.events).toContain("groups 0 and 1 may join: adjacent microtasks");
  expect(r.groups?.batchingHeld).toBeGreaterThan(0);
  const disabled = await runScenario(r.scenario, { groupChecks: false });
  expect(disabled.frames).toEqual(r.frames);
});
