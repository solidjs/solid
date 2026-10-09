import { chain } from "./fixtures.js";
import { runScenario } from "./runner.js";
import { runEquivalence, shrinkEquivalence, variants } from "./equivalence.js";
import { generate } from "./generate.js";
import { validate, type Scenario } from "./scenario.js";

test("explicit ordinary reads see publication before and after the scheduled flush", async () => {
  const s = chain("sync");
  s.turns = [
    {
      steps: [
        { op: "write", value: 1 },
        { op: "read", mode: "plain", ref: -1 }
      ]
    },
    {
      steps: [
        { op: "read", mode: "plain", ref: -1 },
        { op: "read", mode: "plain", ref: 1 }
      ]
    }
  ];
  const r = await runScenario(s);
  expect(r.status, JSON.stringify(r)).toBe("pass");
  expect(r.reads?.map(r => r.value)).toEqual([0, 1, 6]);
});

test("early latest warming adds no live reader and agrees after an unblocked update", async () => {
  const s = chain("sync");
  s.turns.push({ steps: [{ op: "read", ref: -1, mode: "latest" }] });
  const r = await runEquivalence(s, runScenario, "latest");
  expect(r.result.status, JSON.stringify(r)).toBe("pass");
  expect(r.pair[0].scenario.readers).toEqual(r.pair[1].scenario.readers);
  expect(r.pair[0].scenario.warmLatest).toEqual([]);
  expect(r.pair[1].scenario.warmLatest).toEqual([-1]);
});

test("an unobserved async memo is not required to have its source's new value", async () => {
  const s = chain("manual");
  s.readers = [];
  s.turns.push({ steps: [{ op: "read", mode: "plain", ref: 0 }] });
  const r = await runScenario(s);
  expect(r.status, JSON.stringify(r)).toBe("pass");
  expect(r.coverage).toContain("imperative-read-without-published-witness");
});

test("paired latest reduction preserves the read that exposes the difference", async () => {
  const s = chain("sync");
  s.turns.push({ steps: [{ op: "read", ref: -1, mode: "latest" }] });
  const run = async (scenario: Scenario) => {
    const r = await runScenario(scenario);
    // Deliberately wrong returned sample, only for calibrating paired reduction.
    if (scenario.warmLatest?.length && r.reads?.length) r.reads[0].value = 99;
    return r;
  };
  const original = await runEquivalence(s, run, "latest");
  expect(original.signature).toContain("E4");
  const reduced = await shrinkEquivalence(s, run, 50, "latest");
  expect(reduced.accepted).toBeGreaterThan(0);
  expect((await runEquivalence(reduced.scenario, run, "latest")).signature).toBe(
    original.signature
  );
  expect((await runEquivalence(reduced.scenario, runScenario, "latest")).result.status).toBe(
    "pass"
  );
});

test("generated imperative reads preserve canonical scheduling and replay", async () => {
  for (const s of generate(3336, 30, "reads")) {
    expect(validate(s)).toBeUndefined();
    const a = await runScenario(s);
    const b = await runScenario(a.scenario);
    expect(["pass", "fail", "policy"]).toContain(a.status);
    expect(b.status).toBe(a.status);
    expect(b.reads).toEqual(a.reads);
    expect(b.frames).toEqual(a.frames);
  }
});

test("paired replay keeps each side's request choice, including a missing request", () => {
  const s = chain();
  s.turns.push({
    steps: [
      { op: "resolve", node: 0, which: "newest", variantKeys: ["0:[1]#1", null] },
      { op: "read", ref: -1, mode: "latest" }
    ]
  });
  const [cold, warm] = variants(s, "latest");
  expect(cold.strict).toBe(true);
  expect(cold.turns.at(-1)).toEqual({
    steps: [
      { op: "resolve", node: 0, which: "newest", key: "0:[1]#1" },
      { op: "read", ref: -1, mode: "latest" }
    ]
  });
  expect(warm.turns.at(-1)).toMatchObject({ steps: [{ op: "noop" }, { op: "read" }] });
  expect(() =>
    variants(
      {
        ...s,
        turns: [{ steps: [{ op: "resolve", node: 0, which: "newest", variantKeys: ["0:[1]#1"] }] }]
      },
      "latest"
    )
  ).toThrow("Missing paired request identity");
});

test("plain getters and memo reads through latest leave the outside-read contract provisional", async () => {
  const s: Scenario = {
    version: 2,
    sources: [-1, -2],
    show: true,
    optimistic: { kind: "latest", proposals: [1], authoritative: 1, hold: true },
    nodes: [
      { id: 0, deps: [-2], factor: 1, offset: 0, delivery: "sync" },
      { id: 1, deps: [0], factor: 1, offset: 0, delivery: "manual" }
    ],
    readers: [{ id: 0, refs: [-2, 0, 1], gated: false, boundary: "none" }],
    turns: [
      { steps: [{ op: "start-action" }] },
      {
        steps: [
          { op: "read", mode: "plain", ref: -2 },
          { op: "read", mode: "plain", ref: 0 },
          { op: "read", mode: "plain", ref: -1 }
        ]
      }
    ]
  };
  const r = await runScenario(s);
  expect(r.status, JSON.stringify(r)).toBe("pass");
  expect(r.coverage).toContain("imperative-latest-contract-provisional");
  expect(r.reads).toHaveLength(3);
  // Retain latest samples as evidence without asserting staged or published.
  expect(r.reads![2].value).toBe(0);
  expect(r.frames.at(-1)?.outputs[0]).toEqual([1, 1, 1]);
});
