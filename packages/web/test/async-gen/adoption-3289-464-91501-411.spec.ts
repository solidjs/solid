/**
 * @vitest-environment jsdom
 */
// Two generator cases the in-place re-derive (#4417; D-2's one re-derive,
// seated in the hold's verdict lane with the readers that derived from the
// staging adopted — `adoptReaders`, lanes.ts) changes against `next`. Both
// were `next` bugs the equivalence oracle had flagged.
//
// seed 3289 #464 (E9): `latest(s0)` read at the `<Show>` and through a memo
// of it showed different screens — the memo form revealed a torn frame
// mid-hold (`vm0:4` = s0 committed + latest(s0) staged, beside `vs0:0`):
//   [s0=0 m0=memo(s0+latest(s0)) m1=async(m0 !%4=3)]
//   <Show when=latest(s0)><span fx[m0(),s0()]>latest(m1) m0()</span></Show>
//   :: t s0=3 f t S1 s0=3 S4 s0=3 S1 A(s0=1)
//
// seed 91501 #411 (E3): under the display-ahead `<Show when=latest(s0)>`,
// the inner `<Show when=s0()>` is lane work — it sees the screen (D-37):
// s0 is 0 there, so the fallback shows. `next` showed `<span></span>`, the
// span of the hold's frame with its leaf never run. The store form agrees.
//   [s0=0 m0=async(s0 !%4=3)]
//   <Show when=m0()><Show when=latest(s0)><Show when=s0() fb>
//     <span fx[isPending(m0)]>s0()</span></Show></Show></Show>
//   :: S1 f t S4 S3 s0=1 t t s0=0 s0=2 t m
import { expect, test } from "vitest";
import fc from "fast-check";
import { runScenario } from "./run.js";
import { scenarioArb } from "./scenario.js";

test("3289 #464: latest() at the Show and through a memo show the same (empty) screens", async () => {
  const sc = fc.sample(scenarioArb(), { seed: 3289, numRuns: 465 })[464];
  const leaf = await runScenario(sc, {});
  const memo = await runScenario(sc, { latestDerive: true });
  expect(leaf.screens.every(s => s === "")).toBe(true);
  expect(memo.screens).toEqual(leaf.screens);
  expect(memo.final).toBe(leaf.final);
});

test("91501 #411: lane work under a display-ahead Show sees the screen — the fallback, never an empty span", async () => {
  const sc = fc.sample(scenarioArb(), { seed: 91501, numRuns: 412 })[411];
  const plain = await runScenario(sc, {});
  const store = await runScenario(sc, { store: true });
  expect(plain.screens.slice(7)).toEqual(Array(6).fill("[F]"));
  expect(store.screens).toEqual(plain.screens);
});
