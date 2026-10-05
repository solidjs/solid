import { chain } from "./fixtures.js";
import { generate } from "./generate.js";
import { runScenario } from "./runner.js";
import { checkFinal, checkFrame } from "./rules.js";
import { validate, type Scenario } from "./scenario.js";

test("an owned reader can mount, unmount and remount with the current value", async () => {
  const s = chain("sync");
  s.version = 2;
  s.sources = [-1];
  s.readers[0].mounted = false;
  s.turns = [
    { steps: [{ op: "mount", reader: 0, value: true }] },
    { steps: [{ op: "mount", reader: 0, value: false }] },
    { steps: [{ op: "write", value: 2 }] },
    { steps: [{ op: "mount", reader: 0, value: true }] }
  ];
  const r = await runScenario(s);
  expect(r.status, JSON.stringify(r)).toBe("pass");
  expect(r.frames.findLast(f => f.at === "turn 1")?.outputs[0]).toBe("absent");
  expect(r.frames.at(-1)?.outputs[0]).toEqual([2, 8]);
  expect(r.coverage).toContain("owned-reader-created");
});

test("mounting an async reader with already settled inputs succeeds", async () => {
  const s = chain();
  s.version = 2;
  s.sources = [-1];
  s.readers[0].mounted = false;
  s.turns = [
    { steps: [{ op: "write", value: 2 }] },
    { steps: [{ op: "resolve", node: 0, which: "newest" }] },
    { steps: [{ op: "mount", reader: 0, value: true }] }
  ];
  const r = await runScenario(s);
  expect(r.status, JSON.stringify(r)).toBe("pass");
  expect(r.frames.at(-1)?.outputs[0]).toEqual([2, 8]);
});

test("a missed owned mount cannot remove the final-state obligation", () => {
  const s = chain("sync");
  s.version = 2;
  s.sources = [-1];
  s.readers[0].mounted = false;
  const frame = {
    at: "final",
    input: 0,
    show: true,
    mounts: { 0: false },
    outputs: { 0: "absent" as const }
  };
  expect(checkFinal(s, frame, 0, true, undefined, { 0: true })?.rule).toBe("L1");
  expect(checkFrame(s, { ...frame, mounts: { 0: true } })?.rule).toBe("S2");
});

test("generated mounting scenarios validate and replay", async () => {
  for (const s of generate(3347, 30, "mounts")) {
    expect(validate(s)).toBeUndefined();
    const a = await runScenario(s);
    const b = await runScenario(a.scenario);
    expect(["pass", "fail", "policy"]).toContain(a.status);
    expect(b.status).toBe(a.status);
    expect(b.frames).toEqual(a.frames);
    expect(b.failure).toEqual(a.failure);
  }
});

test("a detached child fallback is not publication of its parent mount", async () => {
  const s: Scenario = {
    version: 2,
    show: false,
    nodes: [
      {
        id: 0,
        deps: [-1],
        factor: 1,
        offset: 0,
        delivery: "manual"
      },
      {
        id: 1,
        deps: [0],
        factor: 1,
        offset: 0,
        delivery: "manual"
      },
      {
        id: 2,
        deps: [0],
        factor: 1,
        offset: 0,
        delivery: "promise"
      }
    ],
    readers: [
      {
        refs: [0, 1, 2],
        gated: false,
        id: 0,
        boundary: "retain",
        mounted: false
      },
      {
        refs: [1, -1, 2],
        gated: false,
        id: 1,
        boundary: "none"
      }
    ],
    turns: [
      {
        steps: [
          {
            op: "queue",
            id: 0,
            via: "promise",
            steps: [
              {
                op: "write",
                value: 2
              }
            ]
          }
        ]
      },
      {
        steps: [
          {
            op: "queue",
            id: 3,
            via: "await",
            steps: [
              {
                op: "mount",
                reader: 0,
                value: true
              }
            ]
          },
          {
            op: "write",
            value: 0
          }
        ]
      }
    ],
    sources: [-1],
    strict: true
  };
  const r = await runScenario(s);
  expect(r.status, JSON.stringify(r)).toBe("pass");
  expect(r.events.some(e => e.includes('prepared reader 0: "loading"'))).toBe(true);
  expect(r.frames.every(f => f.mounts?.[0] || f.outputs[0] === "absent")).toBe(true);
});
