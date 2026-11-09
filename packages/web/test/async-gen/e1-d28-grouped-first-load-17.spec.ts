/**
 * @vitest-environment jsdom
 */
// async-gen #17 (E1, D-28): one grouped attribute effect reads `m1` (a first
// load in flight), then `m0` (throws). Minimized from seed 3289 (E1, 6,000
// cases; seed 91501 minimizes to the same shape, `mined91501`):
//   [s0=0 m0=memo(s0 !%4=1) m1=async(s0 !%4=2)] <span fx[m1(),m0()]></span> :: S2
// Grouped, m1's NotReady ends the pass before m0 is read: `[ROOT-L]`. Split,
// m0's binding throws on its own: `[ROOT-E]`. Both passes throw; D-28: "a
// throw ends the pass … Order is not irrelevant … What must not depend on
// order is the throw." So E1 accepts the grouped fallback while the earlier
// binding is a first load and the error is a later binding's of the same
// group. Once m1 lands the grouped pass reads m0 and shows `[ROOT-E]` too;
// a grouped form that still differs there is reported.
import { expect, test } from "vitest";
import { comparePair } from "./pairs.js";
import { runScenario, type Result } from "./run.js";

const mined3289 = {
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
//   [s0=1 m0=memo(s0+s0 !%4=1) m1=async(s0)] <span fx[m1(),m0()]></span> :: s0=2 t
const mined91501 = {
  signals: [1],
  memos: [
    {
      async: false,
      deps: [
        { src: { k: "s", i: 0 }, how: "plain" },
        { src: { k: "s", i: 0 }, how: "plain" }
      ],
      poison: 1
    },
    { async: true, deps: [{ src: { k: "s", i: 0 }, how: "plain" }], poison: null }
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
  steps: [{ t: "write", s: 0, v: 2 }, { t: "task" }]
} as any;
// The 3289 case with a task after the landing, so the settled screen after
// m1 lands is compared too.
const sc = { ...mined3289, steps: [...mined3289.steps, { t: "task" }] };

const runs = async () => ({
  grouped: await runScenario(sc, { grouped: true }),
  split: await runScenario(sc, { split: true })
});
const tamper = (r: Result, f: (r: Result) => void) => {
  const c = structuredClone(r);
  f(c);
  return c;
};

test("#17: the grouped form shows [ROOT-L] until m1 lands, split [ROOT-E]; E1 accepts it (D-28)", async () => {
  const { grouped, split } = await runs();
  expect(grouped.findings).toEqual([]);
  expect(split.findings).toEqual([]);
  // First render, the settle (not a settle point), the task after it.
  expect(grouped.screens).toEqual(["[ROOT-L]", "[ROOT-L]", "[ROOT-E]"]);
  expect(split.screens).toEqual(["[ROOT-E]", "[ROOT-E]", "[ROOT-E]"]);
  // The group's pass ended on m1's first load, before m0; m0 throws.
  expect(grouped.passes[0].held).toEqual({ r: [0] });
  expect(split.passes[0].memos).toEqual({ 0: "error", 1: "pending" });
  expect(grouped.final).toBe("[ROOT-E]");
  expect(split.final).toBe("[ROOT-E]");
  expect(comparePair("E1", grouped, split)).toBeNull();
});

test("#17 as mined (seeds 3289 and 91501): E1 accepts it, and the settled end states agree", async () => {
  for (const mined of [mined3289, mined91501]) {
    const grouped = await runScenario(mined, { grouped: true });
    const split = await runScenario(mined, { split: true });
    expect(grouped.screens).not.toEqual(split.screens);
    expect(grouped.final).toBe("[ROOT-E]");
    expect(split.final).toBe("[ROOT-E]");
    expect(comparePair("E1", grouped, split)).toBeNull();
  }
});

test("contrast: a grouped form whose settled end state differs is still reported", async () => {
  const { grouped, split } = await runs();
  const stuck = tamper(grouped, r => (r.final = "[ROOT-L]"));
  expect(comparePair("E1", stuck, split)).toMatchObject({
    law: "E1",
    step: sc.steps.length,
    detail: expect.stringMatching(/^loading vs error :: /)
  });
});

test("contrast: the fallback after m1 landed is still reported", async () => {
  const { grouped, split } = await runs();
  // The last task step: m1 has landed, the group read m0 and threw.
  const stuck = tamper(grouped, r => (r.screens[2] = "[ROOT-L]"));
  expect(stuck.passes[2].held).toEqual({});
  expect(comparePair("E1", stuck, split)).toMatchObject({ law: "E1", step: 1 });
});

test("contrast: no first load ending the group's pass, or no later binding's error, is still reported", async () => {
  const { grouped, split } = await runs();
  // The pass ended on something other than a first load (or not at all).
  const unheld = tamper(grouped, r => (r.passes[0].held = {}));
  expect(comparePair("E1", unheld, split)).toMatchObject({ law: "E1", step: -1 });
  // The error comes from elsewhere: the group's later binding does not throw.
  const elsewhere = tamper(split, r => (r.passes[0].memos[0] = "value"));
  expect(comparePair("E1", grouped, elsewhere)).toMatchObject({ law: "E1", step: -1 });
  // The other direction: split loading where grouped shows the error.
  expect(comparePair("E1", split, grouped)).toMatchObject({ law: "E1", step: -1 });
  // Only E1 (grouped vs split) takes D-28.
  expect(comparePair("E2", grouped, split)).toMatchObject({ law: "E2", step: -1 });
  // Nor any other grouping difference: content where split shows the error.
  const shown = tamper(grouped, r => (r.screens[0] = '<span data-a0="vm1:1 "></span>'));
  expect(comparePair("E1", shown, split)).toMatchObject({ law: "E1", step: -1 });
});

test("the other order agrees with split at every screen", async () => {
  const rev = { ...sc, tree: { ...sc.tree, attrs: [...sc.tree.attrs].reverse() } };
  const grouped = await runScenario(rev, { grouped: true });
  const split = await runScenario(rev, { split: true });
  expect(grouped.screens).toEqual(split.screens);
  expect(grouped.screens.every(s => s === "[ROOT-E]")).toBe(true);
});
