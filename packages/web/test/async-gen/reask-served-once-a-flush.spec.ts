/**
 * @vitest-environment jsdom
 */
// async-gen 91501 #749, minimized (#4459 follow-up; D-22 amended 2026-10-30,
// F-9): `m0` is answered, then re-asked in one flush, and a boundary's
// children memo reads two `Show`s that both park on `m0`. Its first read of
// the first `Show`'s output is served the answer; its read of the second
// throws, so the pass parks on `m0` again with no value of its own. Served
// on every re-run, the missed-wake latch re-ran it in the same flush without
// end (a synchronous loop). One served pass a flush: the re-run throws and
// waits on `m0`.
import { expect, test } from "vitest";
import { runScenario } from "./run.js";
import type { Scenario } from "./scenario.js";

// [s0=3 m0=async(s0 !%4=2) m1=async(m0 !%4=1)]
//   <Show when=m1() fb><span></span></Show><Show when=m0() fb><span></span></Show>
//   :: s0=2 S1 t S0 s0=1
const sc: Scenario = {
  signals: [3],
  memos: [
    { async: true, deps: [{ src: { k: "s", i: 0 }, how: "plain" }], poison: 2 },
    { async: true, deps: [{ src: { k: "m", i: 0 }, how: "plain" }], poison: 1 }
  ],
  tree: {
    t: "group",
    kids: [
      {
        t: "show",
        when: { how: "plain", src: { k: "m", i: 1 } },
        child: { t: "leaf", text: [], attrs: [], grouped: false },
        fallback: true
      },
      {
        t: "show",
        when: { how: "plain", src: { k: "m", i: 0 } },
        child: { t: "leaf", text: [], attrs: [], grouped: false },
        fallback: true
      }
    ]
  },
  steps: [
    { t: "write", s: 0, v: 2 },
    { t: "settle", pick: 1 },
    { t: "task" },
    { t: "settle", pick: 0 },
    { t: "write", s: 0, v: 1 }
  ]
};

test("a reader served an answered-then-reasked first answer is served one pass a flush", async () => {
  for (const variant of [{}, { identity: true }, { store: true }, { split: true }]) {
    const r = await runScenario(sc, variant);
    expect(r.screens, JSON.stringify(variant)).toEqual(Array(6).fill("[ROOT-L]"));
  }
});
