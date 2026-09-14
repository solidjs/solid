import { runScenario } from "./runner.js";
import { chain, obsolete, reveal } from "./fixtures.js";
import { dataTrace } from "./rules.js";
import { HostTasks } from "./host.js";
import { generate } from "./generate.js";

test.each(["sync", "promise", "manual", "await"] as const)("settles a %s chain", async delivery => {
  const r = await runScenario(chain(delivery));
  expect(r.status, JSON.stringify(r, null, 2)).toBe("pass");
});

test.each(["none", "retain", "reset"] as const)(
  "late observation with %s boundary",
  async boundary => {
    const r = await runScenario(reveal(boundary));
    expect(r.status, JSON.stringify(r, null, 2)).toBe("pass");
  }
);

test("obsolete answers cannot replace the latest answer", async () => {
  const r = await runScenario(obsolete());
  expect(r.status, JSON.stringify(r, null, 2)).toBe("pass");
  expect(r.coverage).toContain("residual-completion");
  expect((await runScenario(r.scenario)).frames).toEqual(r.frames);
});

test("native nested microtasks finish before the next host task", async () => {
  const host = new HostTasks();
  const order: string[] = [];
  try {
    await host.run(() => {
      order.push("task");
      queueMicrotask(() => {
        order.push("microtask");
        Promise.resolve().then(() => queueMicrotask(() => order.push("nested")));
      });
      Promise.resolve().then(() => order.push("promise"));
    });
    await host.run(() => order.push("next task"));
    expect(order).toEqual(["task", "microtask", "promise", "nested", "next task"]);
  } finally {
    host.close();
  }
});

test("completion probes do not change the publication trace", async () => {
  const a = await runScenario(obsolete());
  const b = await runScenario(obsolete(), { completionProbes: false });
  expect(dataTrace(a.frames)).toEqual(dataTrace(b.frames));
});

test("initialization drains fulfilled promises before deciding no work remains", async () => {
  const s = chain("promise");
  s.nodes[1].delivery = "manual";
  s.turns = [];
  const r = await runScenario(s);
  expect(r.status, JSON.stringify(r)).toBe("pass");
  expect(r.frames[0].outputs[0]).toEqual([0, 4]);
});

test("malformed replay data is invalid, not a runtime error", async () => {
  const r = await runScenario(null as never);
  expect(r.status).toBe("invalid");
});

test("published fallback covers retained content work after a hide", async () => {
  const s = chain("await");
  s.readers[0].boundary = "reset";
  s.readers[0].gated = true;
  s.turns.push({ steps: [{ op: "show", value: false }] });
  const r = await runScenario(s);
  expect(r.status, JSON.stringify(r)).toBe("pass");
  expect(r.coverage).toContain("published-fallback");
  expect(r.frames.at(-1)!.outputs[0]).toBe("hidden");
});

test("completion probes preserve generated publication traces", async () => {
  for (const s of generate(3334, 50)) {
    const a = await runScenario(s);
    const b = await runScenario(s, { completionProbes: false });
    expect(dataTrace(a.frames)).toEqual(dataTrace(b.frames));
  }
});
