import { generate } from "./generate.js";
import { runScenario, type RunResult } from "./runner.js";
import { validate } from "./scenario.js";
import { chain } from "./fixtures.js";
import { dataTrace } from "./rules.js";
import { variants, compare } from "./equivalence.js";

test("seeded generation is reproducible and well formed", () => {
  const cases = generate(3289, 200);
  expect(generate(3289, 200)).toEqual(cases);
  for (const s of cases) expect(validate(s)).toBeUndefined();
});

test("sync, fulfilled promise and delayed answers preserve the single-write data trace", async () => {
  const traces: string[][] = [];
  for (const delivery of ["sync", "promise", "manual", "await"] as const) {
    const r = await runScenario(chain(delivery));
    expect(r.status).toBe("pass");
    traces.push(dataTrace(r.frames));
  }
  for (const trace of traces) expect(trace).toEqual(traces[0]);
});

test("generated runs are replayable and cleanup is order independent", async () => {
  const cases = generate(3305, 30);
  const first: RunResult[] = [];
  for (const s of cases) first.push(await runScenario(s));
  for (let i = cases.length - 1; i >= 0; i--) {
    const a = first[i];
    expect(["pass", "fail", "policy"], a.error).toContain(a.status);
    const b = await runScenario(a.scenario);
    expect(b.status).toBe(a.status);
    expect(b.failure).toEqual(a.failure);
    expect(b.waiting).toEqual(a.waiting);
    expect(b.frames).toEqual(a.frames);
  }
});

test("sync/async equivalence holds across generated graph shapes", async () => {
  for (const s of generate(3347, 100)) {
    const [sync, promise, delayed] = variants(s);
    const a = await runScenario(sync);
    for (const variant of [promise, delayed]) {
      const result = compare(a, await runScenario(variant));
      expect(result.status, JSON.stringify(result)).toBe("pass");
    }
  }
});
