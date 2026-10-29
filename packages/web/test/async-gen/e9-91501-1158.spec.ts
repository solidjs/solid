/**
 * @vitest-environment jsdom
 */
// async-gen seed 91501 #1158 (E9, F-6): `latest(x)` read at the leaf and the
// same read through a memo show the same screens, and the memo form is not
// left on a stuck `[ROOT-E]` (liveness). The flush's record of a transaction
// only `latest()` reads opened clears when the flush ends, not on a later
// join within it: clearing it there split the passes of one flush between
// the frame's read and the screen, and the memo form stuck on `[ROOT-E]`.
//   [s0=0 s1=2 m0=async(latest(s0) !%4=3) m1=memo(m0 !%4=2) m2=memo(latest(m0)+s1)]
//   <Show when=latest(m0)>…<span fx[s0(),m0()]>latest(m1) latest(s0)</span></Show>
//   :: t s1=0 S1 f t f f S2 f s0=3
import { expect, test } from "vitest";
import fc from "fast-check";
import { runScenario } from "./run.js";
import { scenarioArb } from "./scenario.js";

test("91501 #1158: the leaf and the memo form of latest() show the same screens", async () => {
  const sc = fc.sample(scenarioArb(), { seed: 91501, numRuns: 1159 })[1158];
  const leaf = await runScenario(sc, {});
  const memo = await runScenario(sc, { latestDerive: true });
  expect(memo.screens).toEqual(leaf.screens);
  expect(memo.final).toBe(leaf.final);
  expect(memo.final).not.toContain("[ROOT-E]");
});
