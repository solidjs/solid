import { corpus } from "./corpus.js";
import { runScenario } from "./runner.js";
import { chain } from "./fixtures.js";
import { checkFinal } from "./rules.js";
import { retainedObservations } from "./policy.js";

const disposed = () => structuredClone(corpus.find(c => c.name === "disposed-reader")!.scenario);

test("disposal publishes without waiting under every timing policy", async () => {
  for (const waitingPolicy of ["review", "required-only", "retain-disposed"] as const) {
    const r = await runScenario(disposed(), { waitingPolicy });
    expect(r.status, JSON.stringify(r)).toBe("pass");
    expect(r.waiting).toBeUndefined();
    expect(r.frames.findLast(f => f.at === "turn 1")?.input).toBe(2);
  }
});

test.each(["stale-reader", "stuck-hidden"])(
  "%s publishes its final view under every waiting policy",
  async name => {
    const s = corpus.find(c => c.name === name)!.scenario;
    for (const waitingPolicy of ["review", "required-only", "retain-disposed"] as const) {
      const r = await runScenario(s, { waitingPolicy });
      expect(r.status, JSON.stringify(r)).toBe("pass");
      expect(r.failure).toBeUndefined();
      expect(
        checkFinal(s, r.frames.at(-1)!, name === "stale-reader" ? 2 : 0, true)
      ).toBeUndefined();
    }
  }
);

test("a waiting policy cannot turn missing final publication into success", () => {
  const s = chain("sync");
  expect(
    checkFinal(s, { at: "final completion", input: 0, show: true, outputs: { 0: [0, 4] } }, 1, true)
  ).toMatchObject({ rule: "L1" });
});

test("a retained permission requires a pending observation and matching write", () => {
  expect(retainedObservations([], 1)).toEqual([]);
  expect(retainedObservations([{ reader: 0, write: 1, at: "observed" }], 1)).toEqual([]);
  expect(
    retainedObservations([{ reader: 0, write: 1, at: "observed", disposedAt: "removed" }], 2)
  ).toEqual([]);
});

test("disposing after a request settles creates no retained permission", async () => {
  const s = disposed();
  s.turns.splice(1, 0, { steps: [{ op: "resolve", node: 0, which: "newest" }] });
  const r = await runScenario(s, { waitingPolicy: "retain-disposed" });
  expect(r.status, JSON.stringify(r)).toBe("pass");
  expect(r.waiting).toBeUndefined();
  expect(r.work.flatMap(w => w.observations).some(o => o.disposedAt)).toBe(false);
});

test("a later write is not covered by an earlier write's disposed observer", async () => {
  const s = disposed();
  s.turns.push({ steps: [{ op: "write", value: 3 }] });
  const r = await runScenario(s, { waitingPolicy: "retain-disposed" });
  if (r.waiting) {
    expect(r.waiting.retained).toEqual([]);
    expect(r.waiting.disposition).toBe("out-of-scope");
    expect(r.status).not.toBe("pass");
  }
  expect(r.work.flatMap(w => w.observations).some(o => o.write === 2 && o.disposedAt)).toBe(false);
});

test("returning to the same inputs leaves the obsolete occurrence for residual completion", async () => {
  const s = chain();
  s.turns = [1, 2, 1].map(value => ({ steps: [{ op: "write", value }] }));
  const result = await runScenario(s, { completionProbes: false });
  expect(result.status, JSON.stringify(result)).toBe("pass");
  expect(result.events).toContain("required completion: required 0:[1]#2");
  expect(result.events).not.toContain("required completion: required 0:[1]#1");
  expect(result.events).toContain("residual completion: residual 0:[1]#1");
  expect(result.frames.at(-1)?.outputs[0]).toEqual([1, 6]);
});
