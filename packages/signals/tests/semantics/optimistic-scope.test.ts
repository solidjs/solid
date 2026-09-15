import { checkFinal, checkOptimistic, type Frame } from "./rules.js";
import type { Scenario } from "./scenario.js";
import { runScenario } from "./runner.js";

const scenario: Scenario = {
  version: 2,
  sources: [-1, -2],
  show: true,
  optimistic: { kind: "latest", viaMemo: true, proposals: [0, 0], authoritative: 0 },
  nodes: [{ id: 0, deps: [-2], factor: 1, offset: 0, delivery: "promise" }],
  readers: [{ id: 0, refs: [0], gated: false, boundary: "retain", mounted: true }],
  anchors: [],
  anchorShow: false,
  turns: [
    { steps: [{ op: "start-action" }] },
    { steps: [{ op: "resume-action" }, { op: "mount", reader: 0, value: false }] }
  ]
};

test("an ordinary unmount may remain held until the action ends without failing O1", async () => {
  const r = await runScenario(scenario);
  expect(r.status, JSON.stringify(r)).toBe("pass");
  expect(r.frames.at(-1)?.outputs[0]).toBe("absent");
});

test("O1 checks optimistic data without imposing ordinary source or mount completion", () => {
  const s: Scenario = {
    ...scenario,
    anchors: [-1, -2],
    readers: [...scenario.readers, { id: 1, refs: [-2, 0], gated: false, boundary: "none" }]
  };
  const frame: Frame = {
    at: "action open",
    input: 0,
    inputs: { [-1]: 0, [-2]: 1 },
    show: true,
    mounts: { 0: true },
    outputs: { 0: [0], 1: [1, 1] }
  };
  const desired = { [-1]: 2, [-2]: 1 };
  expect(checkOptimistic(s, frame, desired)).toBeUndefined();
  expect(checkOptimistic(s, { ...frame, outputs: { 0: [0], 1: [1, 0] } }, desired)).toMatchObject({
    rule: "O1",
    reader: 1
  });
  expect(checkOptimistic(s, { ...frame, inputs: { [-1]: 0, [-2]: 0 } }, desired)).toMatchObject({
    rule: "O1"
  });
  // The unmount still must complete once all work settles.
  expect(checkFinal(s, frame, 0, true, frame.inputs, { 0: false })).toMatchObject({
    rule: "L1",
    reader: 0
  });
});
