/**
 * @vitest-environment jsdom
 */
// async-gen seed 3289 #1831 (E1, E9): a grouped and a split leaf, and a
// leaf reading `latest()` through a memo, show the same screen (F-1, F-12).
// `m2 = memo(latest(m0) + m1)` has no value yet when `m0`'s first load
// lands in a flush whose transaction only `latest()` reads opened; its
// first answer is nobody's hold (D-6), so it reads `m1`'s screen, not the
// staging (D-22's frame read is for a pass that has a value to re-derive
// on). Reading the staging there committed an answer that threw later, and
// the grouped leaf ended on `[ROOT-E]` where the split one shows `[F]`.
import { expect, test } from "vitest";
import fc from "fast-check";
import { runScenario } from "./run.js";
import { scenarioArb } from "./scenario.js";

const minimized = {
  signals: [0],
  memos: [
    { async: true, deps: [{ src: { k: "s", i: 0 }, how: "plain" }], poison: null },
    {
      async: false,
      deps: [
        { src: { k: "s", i: 0 }, how: "plain" },
        { src: { k: "m", i: 0 }, how: "latest" }
      ],
      poison: 0
    },
    {
      async: false,
      deps: [
        { src: { k: "m", i: 0 }, how: "latest" },
        { src: { k: "m", i: 1 }, how: "plain" }
      ],
      poison: 1
    }
  ],
  tree: {
    t: "show",
    when: { how: "pending", src: { k: "m", i: 0 } },
    child: {
      t: "leaf",
      text: [],
      attrs: [
        { how: "latest", src: { k: "m", i: 2 } },
        { how: "plain", src: { k: "m", i: 0 } }
      ],
      grouped: true
    },
    fallback: true
  },
  steps: [{ t: "settle", pick: 5 }, { t: "task" }, { t: "write", s: 0, v: 1 }, { t: "task" }]
} as any;

test("minimized: grouped and split attributes show the same screens, ending on [F]", async () => {
  const grouped = await runScenario(minimized, { grouped: true });
  const split = await runScenario(minimized, { split: true });
  expect(grouped.screens).toEqual(split.screens);
  expect(grouped.screens.at(-1)).toBe("[F]");
});

test("the generated case: grouped, split, default and latest-through-a-memo agree", async () => {
  const sc = fc.sample(scenarioArb(), { seed: 3289, numRuns: 1832 })[1831];
  const base = await runScenario(sc, {});
  for (const v of [{ grouped: true }, { split: true }, { latestDerive: true }])
    expect((await runScenario(sc, v)).screens).toEqual(base.screens);
});
