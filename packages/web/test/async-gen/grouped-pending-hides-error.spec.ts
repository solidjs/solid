/**
 * @vitest-environment jsdom
 */
// async-gen rerun 2026-10-30, E1: one grouped effect `fx[m1(), m0()]`, where
// `m1` is a first load still in flight and `m0` a sync memo that throws. The
// pending read ended the pass before `m0` was read, so the grouped leaf showed
// `[ROOT-L]` while the split leaf, and the same group in the other order,
// showed `[ROOT-E]`. Grouping never changes the screen (#4284), and an error
// nothing holds publishes at the flush that finds it (D-41): `[ROOT-E]`.
//   [s0=0 m0=memo(s0 !%4=1) m1=async(s0 !%4=2)] <span fx[m1(),m0()]></span> :: S2
import { expect, test } from "vitest";
import { runScenario } from "./run.js";

const minimized = {
  signals: [0],
  memos: [
    { async: false, deps: [{ src: { k: "s", i: 0 }, how: "plain" }], poison: 1 },
    { async: true, deps: [{ src: { k: "s", i: 0 }, how: "plain" }], poison: 2 }
  ],
  tree: {
    t: "leaf",
    text: [],
    attrs: [
      { how: "plain", src: { k: "m", i: 1 } },
      { how: "plain", src: { k: "m", i: 0 } }
    ],
    grouped: true
  },
  steps: [{ t: "settle", pick: 2 }]
} as any;

const reversed = {
  ...minimized,
  tree: { ...minimized.tree, attrs: [...minimized.tree.attrs].reverse() }
};

test("a pending read in a grouped effect does not hide a later binding's error", async () => {
  const grouped = await runScenario(minimized, { grouped: true });
  const split = await runScenario(minimized, { split: true });
  const other = await runScenario(reversed, { grouped: true });
  expect(split.screens[0]).toBe("[ROOT-E]");
  expect(grouped.screens).toEqual(split.screens);
  expect(other.screens).toEqual(split.screens);
  expect(grouped.findings).toEqual([]);
});
