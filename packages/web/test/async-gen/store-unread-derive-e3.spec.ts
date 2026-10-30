/**
 * @vitest-environment jsdom
 */
// async-gen rerun on rc.20, E3 (a derived store `createStore(d => { d.v = m() })`
// reads like `m`): a store nobody reads, over an async memo whose input reads
// `latest()`. Its derive stays live (the store keeps its data unobserved), and
// reading a verdict memo makes its pass a verdict reader, so at the re-ask it
// observed the flight as a frame reader and held the flush with it: a plain
// write to `s0` beside it waited for `m1`'s answer. A derive whose store has
// no reader is no display and holds nothing (F-3, D-11); the memo form, whose
// `m1` nobody reads either, shows the write at once.
import { expect, test } from "vitest";
import { runScenario } from "./run.js";

// [s0=1 m0=memo(latest(s0)+s0 !%4=2) m1=async(m0 !%4=1)] <span split[s0()]></span> :: S1 t s0=0 t
const sc: any = {
  signals: [1],
  memos: [
    {
      async: false,
      deps: [
        { src: { k: "s", i: 0 }, how: "latest" },
        { src: { k: "s", i: 0 }, how: "plain" }
      ],
      poison: 2
    },
    { async: true, deps: [{ src: { k: "m", i: 0 }, how: "plain" }], poison: 1 }
  ],
  tree: { t: "leaf", text: [], attrs: [{ how: "plain", src: { k: "s", i: 0 } }], grouped: false },
  steps: [{ t: "settle", pick: 1 }, { t: "task" }, { t: "write", s: 0, v: 0 }, { t: "task" }]
};

test("E3: an unread store's derive does not hold a plain write", async () => {
  const memo = await runScenario(sc, {});
  const store = await runScenario(sc, { store: true });
  expect(store.screens).toEqual(memo.screens);
  expect(store.final).toBe(memo.final);
});
