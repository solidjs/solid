/**
 * @vitest-environment jsdom
 */
// #4474 (D-22: laziness is never observable), the generator's forms. The
// default variant releases a memo nobody reads at its source's landing
// (#2934) and wakes it at the next mount that reads it; the `owned` variant
// keeps every memo alive (the eager twin, E7); `identity` reads each memo
// through an identity memo (E2). The three must show the same screens: a
// memo nobody read has still produced what the flushes it missed would have
// given it, so its wake computes on the committed world (core.ts `wake`)
// and re-derives over this flush's staging or verdict lane after.
//
// Before the fix the woken memo had no value where the eager one had the
// landing's: a verdict reader's wake was marked pending on the flight it
// was served (seed 7 #15285 — `m2 = m0() + latest(m0)` missing from the
// leaf, E3/E7), a wake under an action read the staging and committed it
// (seed 7 #21333 — `vm2` empty, E7), a nested `Show` on `latest(m1)` of a
// woken memo stayed closed (seed 91501 #42673 — content vs ""). The E2
// identity cases (seed 7 #20408, seed 3289 #4421) are the same mechanism
// through an identity memo.
import { expect, test } from "vitest";
import fc from "fast-check";
import { runScenario } from "./run.js";
import { scenarioArb } from "./scenario.js";

const s0 = { k: "s", i: 0 };
const s1 = { k: "s", i: 1 };
const m0 = { k: "m", i: 0 };
const m1 = { k: "m", i: 1 };
const m2 = { k: "m", i: 2 };

// seed 7 #15285: a verdict reader (`m2 = m0() + latest(m0)`) nobody reads is
// released at `m0`'s landing and woken by the leaf that mounts when the
// write re-asks `m0`. Its wake is served `m0`'s landed value and, a verdict
// reader, re-derives rather than being marked pending (A19): the leaf shows
// `vm2:11 lm2:11` beside `ps0:true`, as with the eager twin.
const verdictReader = {
  signals: [2],
  memos: [
    {
      async: true,
      deps: [
        { src: s0, how: "plain" },
        { src: s0, how: "plain" }
      ],
      poison: null
    },
    { async: false, deps: [{ src: m0, how: "plain" }], poison: 2 },
    {
      async: false,
      deps: [
        { src: m0, how: "plain" },
        { src: m0, how: "latest" }
      ],
      poison: null
    }
  ],
  tree: {
    t: "show",
    when: { how: "pending", src: m0 },
    child: {
      t: "leaf",
      text: [
        { how: "pending", src: s0 },
        { how: "pending", src: m0 }
      ],
      attrs: [
        { how: "plain", src: m2 },
        { how: "latest", src: m2 }
      ],
      grouped: false
    },
    fallback: true
  },
  steps: [
    { t: "settle", pick: 5 },
    { t: "task" },
    { t: "settle", pick: 6 },
    { t: "settle", pick: 4 },
    { t: "task" },
    { t: "write", s: 0, v: 1 },
    { t: "settle", pick: 2 },
    { t: "write", s: 0, v: 0 },
    { t: "task" },
    { t: "settle", pick: 2 }
  ]
} as any;

// seed 7 #21333: `m2 = m0() + latest(m1)` wakes in the flush of a plain write
// that follows an action's hold. The catch-up reads the screen (`s0`'s
// committed value, not the write's staging) and re-derives over the staging
// after: `vm2:5`, the eager twin's. Reading the staging committed a value
// the eager memo never had, and the leaf showed nothing.
const stagingAsScreen = {
  signals: [0],
  memos: [
    { async: true, deps: [{ src: s0, how: "plain" }], poison: null },
    {
      async: false,
      deps: [
        { src: m0, how: "plain" },
        { src: s0, how: "latest" }
      ],
      poison: null
    },
    {
      async: false,
      deps: [
        { src: m0, how: "plain" },
        { src: m1, how: "latest" }
      ],
      poison: null
    }
  ],
  tree: {
    t: "show",
    when: { how: "pending", src: s0 },
    child: {
      t: "leaf",
      text: [{ how: "plain", src: m2 }],
      attrs: [
        { how: "plain", src: s0 },
        { how: "plain", src: m0 }
      ],
      grouped: false
    },
    fallback: false
  },
  steps: [
    { t: "settle", pick: 2 },
    { t: "task" },
    { t: "task" },
    { t: "action", s: 0, v: 1 },
    { t: "task" },
    { t: "micro" },
    { t: "micro" },
    { t: "write", s: 0, v: 1 },
    { t: "task" }
  ]
} as any;

// seed 91501 #42673: a nested `Show` whose condition is `latest(m1)` of a
// woken memo over an errored async memo. The condition's catch-up computes
// on the committed world and the branch opens as the eager twin's does.
const nestedShowOnLatest = {
  signals: [1, 2],
  memos: [
    {
      async: true,
      deps: [
        { src: s1, how: "plain" },
        { src: s1, how: "plain" }
      ],
      poison: 3
    },
    { async: false, deps: [{ src: m0, how: "plain" }], poison: 0 }
  ],
  tree: {
    t: "show",
    when: { how: "pending", src: s1 },
    child: {
      t: "show",
      when: { how: "latest", src: m1 },
      child: {
        t: "leaf",
        text: [
          { how: "plain", src: m1 },
          { how: "plain", src: m1 }
        ],
        attrs: [
          { how: "plain", src: m0 },
          { how: "plain", src: s0 }
        ],
        grouped: false
      },
      fallback: false
    },
    fallback: false
  },
  steps: [
    { t: "settle", pick: 6 },
    { t: "task" },
    { t: "write", s: 1, v: 1 },
    { t: "action", s: 1, v: 1 },
    { t: "settle", pick: 6 },
    { t: "settle", pick: 6 },
    { t: "micro" }
  ]
} as any;

// seed 91501 #15992 (E8, open): `m1 = latest(s0) + m0` over an async `m0`
// that never landed on the screen. One flush carries `m0`'s first landing,
// an action's write of `s0` and the remount that reads `m1`. The eager
// memo computes once, in the lane (`s0`'s staging + the landing — poisoned,
// status ERROR|NO_VALUE), and the remounted leaf reads the errored memo
// through `isPending`: `pm1:false`. The lazy memo's catch-up reads `s0`'s
// committed value beside the first landing (a world the eager memo never
// computed) and its re-derive, pulled under the leaf's lane pass, errors
// after the leaf subscribed — `propagateStatus` reaches a reader with no
// value, and the root Errored shows. Which answer the lazy memo owes is
// the eager twin's; the mechanism is not this fix's (a catch-up whose
// sources have no committed value has no screen to read).
const firstLandingUnderLane = {
  signals: [2, 1],
  memos: [
    { async: true, deps: [{ src: s1, how: "plain" }], poison: 0 },
    {
      async: false,
      deps: [
        { src: s0, how: "latest" },
        { src: m0, how: "plain" }
      ],
      poison: 3
    }
  ],
  tree: {
    t: "show",
    when: { how: "plain", src: m0 },
    child: { t: "leaf", text: [{ how: "pending", src: m1 }], attrs: [], grouped: false },
    fallback: false
  },
  steps: [
    { t: "write", s: 0, v: 2 },
    { t: "action", s: 0, v: 0 }
  ]
} as any;

// seed 3289 #46440 (E9): `lm0 = memo(latest(m0))` nobody reads is released
// at `m0`'s first landing, which shares its flush with an action's write;
// the outer `Show` opens on the landing and wakes `lm0`. The catch-up has no
// screen to read — `m0` has no committed value, its staging is its only one
// — so the window is a verdict read of the staging as the eager memo's pass
// was: display-ahead of the hold, the inner `Show` opens with the landing.
// Read as a screen, `lm0`'s value was plain, the frame hold swept the inner
// `Show` and the content waited for the action.
const windowOnFirstLanding = {
  signals: [2],
  memos: [{ async: true, deps: [{ src: s0, how: "plain" }], poison: 2 }],
  tree: {
    t: "show",
    when: { how: "plain", src: m0 },
    child: {
      t: "show",
      when: { how: "latest", src: m0 },
      child: { t: "leaf", text: [], attrs: [], grouped: false },
      fallback: true
    },
    fallback: false
  },
  steps: [{ t: "task" }, { t: "settle", pick: 3 }, { t: "action", s: 0, v: 2 }, { t: "task" }]
} as any;

async function eagerTwin(sc: any) {
  const lazy = await runScenario(sc, {});
  const eager = await runScenario(sc, { owned: true });
  const identity = await runScenario(sc, { identity: true });
  expect(lazy.findings).toEqual([]);
  expect(lazy.screens).toEqual(eager.screens);
  expect(lazy.final).toBe(eager.final);
  expect(identity.screens).toEqual(eager.screens);
  return lazy;
}

test("a verdict reader's wake is served the landing and re-derives, never marked (seed 7 #15285)", async () => {
  const r = await eagerTwin(verdictReader);
  expect(r.screens.at(-1)).toBe("<span data-a0=vm2:11  data-a1=lm2:11 >ps0:true pm0:true </span>");
  // The store form (E3) agrees too — it disagreed before the fix.
  expect((await runScenario(verdictReader, { store: true })).screens).toEqual(r.screens);
});

test("a catch-up under a write reads the screen, then re-derives over the staging (seed 7 #21333)", async () => {
  const r = await eagerTwin(stagingAsScreen);
  expect(r.screens.at(-1)).toBe("<span>vm2:5 </span>");
});

test("a nested Show on latest() of a woken memo opens as the eager one does (seed 91501 #42673)", async () => {
  const r = await eagerTwin(nestedShowOnLatest);
  expect(r.screens.at(-1)).toBe("<span data-a1=vs0:1 ></span>");
});

test("a catch-up's window on a first landing is a verdict read of it, display-ahead (seed 3289 #46440, E9)", async () => {
  const lazy = await runScenario(windowOnFirstLanding, { latestDerive: true });
  const eager = await runScenario(windowOnFirstLanding, { latestDerive: true, owned: true });
  expect(eager.screens.at(-1)).toBe("<span></span>");
  expect(lazy.screens).toEqual(eager.screens);
  expect((await runScenario(windowOnFirstLanding, {})).screens).toEqual(eager.screens);
});

// The default variant agrees with the eager twin; the remount (E8) does not
// yet. Flips when the catch-up over sources with no committed value is ruled.
test("a remount reading a lazy memo over a first landing under a lane (seed 91501 #15992)", async () => {
  const lazy = await runScenario(firstLandingUnderLane, {});
  const eager = await runScenario(firstLandingUnderLane, { owned: true });
  expect(eager.final).toBe("<span>pm1:false </span>");
  expect(lazy.final).toBe(eager.final);
});

test.fails(
  "a remount reading a lazy memo over a first landing under a lane, remounted (seed 91501 #15992, E8)",
  async () => {
    const lazy = await runScenario(firstLandingUnderLane, { remount: true });
    const eager = await runScenario(firstLandingUnderLane, { owned: true, remount: true });
    expect(eager.final).toBe("<span>pm1:false </span>");
    expect(lazy.final).toBe(eager.final);
  }
);

test("the generated cases: default, eager (E7) and identity (E2) agree", async () => {
  const seed7 = fc.sample(scenarioArb(), { seed: 7, numRuns: 21334 });
  const seed3289 = fc.sample(scenarioArb(), { seed: 3289, numRuns: 4422 });
  for (const sc of [seed7[15285], seed7[21333], seed7[20408], seed3289[4421]]) await eagerTwin(sc);
});
