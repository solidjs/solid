import { chain } from "./fixtures.js";
import { generate } from "./generate.js";
import { runScenario } from "./runner.js";
import { runEquivalence } from "./equivalence.js";
import { checkFinal, checkFrame } from "./rules.js";
import { validate, type Scenario } from "./scenario.js";
import { withWorker } from "./worker-fixture.js";

function held(delivery: "sync" | "manual"): Scenario {
  return {
    version: 2,
    sources: [-1, -2],
    show: true,
    optimistic: { kind: "latest", proposals: [1], authoritative: 1, hold: true },
    nodes: [{ id: 0, deps: [-2], factor: 2, offset: 0, delivery }],
    readers: [{ id: 0, refs: [-2, 0], gated: false, boundary: "none" }],
    turns: [{ steps: [{ op: "start-action" }] }]
  };
}

test.each(["sync", "manual"] as const)(
  "tracked latest %s derives while authority remains held",
  async delivery => {
    const r = await runScenario(held(delivery));
    expect(r.status, JSON.stringify(r)).toBe("pass");
    expect(r.frames.at(-1)?.inputs).toEqual({ [-1]: 0, [-2]: 1 });
    expect(r.frames.at(-1)?.outputs[0]).toEqual([1, 2]);
  }
);

test.each(["sync", "manual"] as const)(
  "latest of a shared upstream memo supports %s derivations",
  async delivery => {
    const s = held(delivery);
    s.optimistic!.viaMemo = true;
    const pair = await runEquivalence(s, runScenario, "latest");
    expect(pair.result.status, JSON.stringify(pair)).toBe("pass");
    expect(pair.pair.every(r => r.frames.at(-1)?.outputs[0]?.[1] === 2)).toBe(true);
  }
);

test("removing source anchors narrows intermediate checks but preserves final and tuple checks", async () => {
  const s = chain("sync");
  s.version = 2;
  s.sources = [-1];
  s.anchors = [];
  s.anchorShow = false;
  const r = await runScenario(s);
  expect(r.status, JSON.stringify(r)).toBe("pass");
  expect(r.frames.at(-1)?.inputs).toEqual({});
  expect(r.frames.at(-1)?.outputs[0]).toEqual([1, 6]);
  const frame = r.frames.at(-1)!;
  expect(checkFrame(s, frame)).toBeUndefined();
  expect(checkFinal(s, { ...frame, outputs: { 0: [0, 4] } }, 1, true, { [-1]: 1 })?.rule).toBe(
    "L1"
  );
  expect(r.coverage).toContain("partial-source-observation");
});

test.each(["latest", "observation"] as const)(
  "generated %s cases have deterministic canonical replays",
  async cohort => {
    await withWorker(async client => {
      for (const s of generate(3347, 40, cohort)) {
        expect(validate(s)).toBeUndefined();
        const a = await client.run(s);
        const b = await client.run(a.scenario);
        expect(["pass", "fail", "policy", "error"], JSON.stringify(a)).toContain(a.status);
        expect(b.status).toBe(a.status);
        expect(b.failure).toEqual(a.failure);
        expect(b.frames).toEqual(a.frames);
        expect(b.error?.split("\n")[0]).toBe(a.error?.split("\n")[0]);
      }
    });
  }
);
