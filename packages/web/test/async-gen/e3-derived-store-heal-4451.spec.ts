/**
 * @vitest-environment jsdom
 */
// #4451, E3 (a derived store `createStore(d => { d.v = m() })` reads like
// `m`): `m` errors, an action heals it display-ahead (`latest(s)` in `m` —
// its pass is the action's verdict lane's, F-6) while the action stays open.
// The memo form's Errored heals at the flush; the store form stayed on the
// fallback (or showed nothing) until the action landed: the derive's lane
// pass wrote a key with no leaf yet, and the leaf born from that staging
// was a staging the park held with the frame, not the lane's derivation.
//
// The first two cases are the gap on `next`; the last two are the issue's
// generator cases (seed 3289 #36981, seed 7 #46850), whose memo form heals
// only once #4425 lands — the pair is the pin either way.
import { expect, test } from "vitest";
import { runScenario } from "./run.js";

const cases: Record<string, any> = {
  // [s0=1 m0=memo(latest(s0) !%4=2)] <Errored><Show when=m0()><span>m0()</span></Show></Errored> :: A(s0=3) t S0 t
  "an action heals the memo display-ahead; the Show over the store opens too": {
    signals: [1],
    memos: [{ async: false, deps: [{ src: { k: "s", i: 0 }, how: "latest" }], poison: 2 }],
    tree: {
      t: "errored",
      child: {
        t: "show",
        when: { how: "plain", src: { k: "m", i: 0 } },
        child: {
          t: "leaf",
          text: [{ how: "plain", src: { k: "m", i: 0 } }],
          attrs: [],
          grouped: true
        },
        fallback: false
      }
    },
    steps: [{ t: "action", s: 0, v: 3 }, { t: "task" }, { t: "settle", pick: 0 }, { t: "task" }]
  },
  // [s0=1 m0=memo(latest(s0) !%4=2) m1=async(m0)] <Errored><Show when=m0()><Loading><span>m0() m1()</span></Loading></Show></Errored> :: A(s0=3) t S1 t S0 t
  "with a nested Loading and an async leaf under it": {
    signals: [1],
    memos: [
      { async: false, deps: [{ src: { k: "s", i: 0 }, how: "latest" }], poison: 2 },
      { async: true, deps: [{ src: { k: "m", i: 0 }, how: "plain" }], poison: null }
    ],
    tree: {
      t: "errored",
      child: {
        t: "show",
        when: { how: "plain", src: { k: "m", i: 0 } },
        child: {
          t: "loading",
          child: {
            t: "leaf",
            text: [
              { how: "plain", src: { k: "m", i: 0 } },
              { how: "plain", src: { k: "m", i: 1 } }
            ],
            attrs: [],
            grouped: true
          }
        },
        fallback: false
      }
    },
    steps: [
      { t: "action", s: 0, v: 3 },
      { t: "task" },
      { t: "settle", pick: 1 },
      { t: "task" },
      { t: "settle", pick: 0 },
      { t: "task" }
    ]
  },
  // [s0=1 s1=1 m0=memo(latest(s1) !%4=2) m1=async(m0 !%4=2)] <Show when=m0() fb><Loading><span fx[latest(m0),m1()]>m1()</span></Loading></Show> :: S6 S5 f A(s1=3) t A(s0=0) S6 m S2 s1=2 S0
  "seed 3289 #36981": {
    signals: [1, 1],
    memos: [
      { async: false, deps: [{ src: { k: "s", i: 1 }, how: "latest" }], poison: 2 },
      { async: true, deps: [{ src: { k: "m", i: 0 }, how: "plain" }], poison: 2 }
    ],
    tree: {
      t: "show",
      when: { how: "plain", src: { k: "m", i: 0 } },
      child: {
        t: "loading",
        child: {
          t: "leaf",
          text: [{ how: "plain", src: { k: "m", i: 1 } }],
          attrs: [
            { how: "latest", src: { k: "m", i: 0 } },
            { how: "plain", src: { k: "m", i: 1 } }
          ],
          grouped: true
        }
      },
      fallback: true
    },
    steps: [
      { t: "settle", pick: 6 },
      { t: "settle", pick: 5 },
      { t: "flush" },
      { t: "action", s: 1, v: 3 },
      { t: "task" },
      { t: "action", s: 0, v: 0 },
      { t: "settle", pick: 6 },
      { t: "micro" },
      { t: "settle", pick: 2 },
      { t: "write", s: 1, v: 2 },
      { t: "settle", pick: 0 }
    ]
  },
  // [s0=2 m0=memo(latest(s0)+s0 !%4=3) m1=memo(m0 !%4=2) m2=async(s0 !%4=0)] <Errored><Show when=m1() fb><span fx[m0(),isPending(m0)]>latest(m1)</span><Loading><span fx[isPending(m0)]>m2() m1()</span></Loading><span>latest(m2)</span></Show></Errored> :: S3 f A(s0=3) A(s0=1) t m S4 f t m
  "seed 7 #46850": {
    signals: [2],
    memos: [
      {
        async: false,
        deps: [
          { src: { k: "s", i: 0 }, how: "latest" },
          { src: { k: "s", i: 0 }, how: "plain" }
        ],
        poison: 3
      },
      { async: false, deps: [{ src: { k: "m", i: 0 }, how: "plain" }], poison: 2 },
      { async: true, deps: [{ src: { k: "s", i: 0 }, how: "plain" }], poison: 0 }
    ],
    tree: {
      t: "errored",
      child: {
        t: "show",
        when: { how: "plain", src: { k: "m", i: 1 } },
        child: {
          t: "group",
          kids: [
            {
              t: "leaf",
              text: [{ how: "latest", src: { k: "m", i: 1 } }],
              attrs: [
                { how: "plain", src: { k: "m", i: 0 } },
                { how: "pending", src: { k: "m", i: 0 } }
              ],
              grouped: true
            },
            {
              t: "loading",
              child: {
                t: "leaf",
                text: [
                  { how: "plain", src: { k: "m", i: 2 } },
                  { how: "plain", src: { k: "m", i: 1 } }
                ],
                attrs: [{ how: "pending", src: { k: "m", i: 0 } }],
                grouped: true
              }
            },
            {
              t: "leaf",
              text: [{ how: "latest", src: { k: "m", i: 2 } }],
              attrs: [],
              grouped: false
            }
          ]
        },
        fallback: true
      }
    },
    steps: [
      { t: "settle", pick: 3 },
      { t: "flush" },
      { t: "action", s: 0, v: 3 },
      { t: "action", s: 0, v: 1 },
      { t: "task" },
      { t: "micro" },
      { t: "settle", pick: 4 },
      { t: "flush" },
      { t: "task" },
      { t: "micro" }
    ]
  }
};

for (const [name, sc] of Object.entries(cases))
  test(`E3: ${name}`, async () => {
    const memo = await runScenario(sc, {});
    const store = await runScenario(sc, { store: true });
    expect(store.screens).toEqual(memo.screens);
    expect(store.final).toBe(memo.final);
    expect(store.findings).toEqual([]);
  });

test("E3: the healed Show over the store shows the memo's value at the action's flush", async () => {
  const memo = await runScenario(
    cases["an action heals the memo display-ahead; the Show over the store opens too"],
    {}
  );
  expect(memo.screens).toEqual([
    "[E]",
    "[E]",
    "<span>vm0:4 </span>",
    "<span>vm0:4 </span>",
    "<span>vm0:4 </span>"
  ]);
});
