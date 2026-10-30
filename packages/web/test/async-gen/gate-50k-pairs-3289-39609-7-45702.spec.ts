/**
 * @vitest-environment jsdom
 */
// Two generator cases the S1 M5 gate (50k × 3 seeds, design doc §4.10)
// found where S1 breaks an equivalence pair `next` @ 5e68925cc kept.
// Pinned as `test.fails` until traced: the law is the generator's (E8, E9),
// the fix is not ruled.
//
// seed 3289 #39609 (E8, remount — introduced at M3a, b6ea9ceb1): a reader
// born in the flush that applies the write (`remount`) ends with the inner
// `<Show when=m0()>` content missing from its final, quiet screen; the
// reader born before the write shows it. `next` shows it in both.
//   [s0=0 s1=2 m0=async(latest(s0) !%4=2)]
//   <span fx[m0()]></span><span>m0()</span><span>m0() s0()</span>
//   <Show when=m0() fb><Show when=latest(m0)><Loading><Show when=m0()>
//     <span fx[latest(m0)]></span></Show></Loading></Show></Show>
//   :: f t S2 S3 S7 A(s1=0) t S3 s0=2
//
// seed 7 #45702 (E9, latestDerive — introduced at M3b, 143d829bf): under
// `<Show when=latest(s0)><Show when=latest(m1) fb>`, `latest()` read through
// a memo shows the content frame (`<span></span><span></span>`) at the
// settle after `t` where the leaf form shows nothing; `next` shows nothing
// in both. Finals agree.
//   [s0=0 m0=async(s0 !%4=1) m1=async(s0 !%4=3) m2=async(m0 !%4=3)]
//   <Show when=latest(s0)><Show when=latest(m1) fb><span split[m1()]></span>
//     <span>latest(m2)</span></Show></Show>
//   :: s0=1 s0=0 s0=0 m S7 S0 s0=1 t s0=3
import { expect, test } from "vitest";
import fc from "fast-check";
import { runScenario } from "./run.js";
import { scenarioArb } from "./scenario.js";

test.fails(
  "3289 #39609 (E8): a reader remounted in the flush shows the same final screen as one born before it",
  async () => {
    const sc = fc.sample(scenarioArb(), { seed: 3289, numRuns: 39610 })[39609];
    const before = await runScenario(sc, {});
    const remount = await runScenario(sc, { remount: true });
    expect(remount.final).toBe(before.final);
  }
);

test.fails(
  "7 #45702 (E9): latest() through a memo and at the leaf show the same screens",
  async () => {
    const sc = fc.sample(scenarioArb(), { seed: 7, numRuns: 45703 })[45702];
    const leaf = await runScenario(sc, {});
    const memo = await runScenario(sc, { latestDerive: true });
    expect(memo.screens).toEqual(leaf.screens);
  }
);
