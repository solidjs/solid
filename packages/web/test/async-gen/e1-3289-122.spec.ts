/**
 * @vitest-environment jsdom
 */
// async-gen seed 3289 #122 (E1): `m1 = memo(m0 + latest(m0))` errors and the
// root Errored shows `[ROOT-E]`; `A(s0=1)` opens an action and `s0 = 0`,
// written in the same tick, is the action's (O1), so the recovery it brings
// is held with the action (D-39, D-41). `m1` reads `latest()`, so its
// recovery runs in the frame's verdict lane, and the Errored took its source
// as settled. The root Loading the recovery re-arms caught the leaf's pending
// effect (`m2` in flight), but its swap to `[ROOT-L]` was staged in the
// action's hold while the Errored's own swap ran mainline the next round:
// the leaf attached from the Loading's committed content, its effect's run
// parked — a bare `<span></span>` (F-1). The error now stays up until the
// action's hold reveals the Loading's fallback (#4627).
import { expect, test } from "vitest";
import fc from "fast-check";
import { runScenario } from "./run.js";
import { scenarioArb } from "./scenario.js";

test("the generated case: the error stays up through the action's tick, never a bare leaf", async () => {
  const sc = fc.sample(scenarioArb(), { seed: 3289, numRuns: 123 })[122];
  const r = await runScenario(sc, {});
  expect(r.findings).toEqual([]);
  expect(r.screens).toEqual(Array(12).fill("[ROOT-E]"));
  expect(r.final).toBe("<span data-a0=lm1:3  data-a1=vm2:1 ></span>");
});
