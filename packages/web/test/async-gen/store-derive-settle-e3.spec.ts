/**
 * @vitest-environment jsdom
 */
// async-gen rerun on rc.20, E3 (a derived store `createStore(d => { d.v = m() })`
// reads like `m`): two liveness failures with one cause. The derive went
// pending on m0's flight; the flight then settled (a rejection staged in its
// transaction, or a re-ask that returned to the committed question) without
// the derive re-running. The settle retired m0 from the derive, but the
// store's readers wait on the derive itself (projection.ts `wakeFamily`), and
// nothing retired that: `isPending` stayed true forever (F-9), and the staged
// rejection's transaction never landed, so the error never showed (F-12). The
// settle walk now settles the family with the derive (core
// `settlePendingSource` -> projection.ts `familyStatus`), as a memo's
// readers settle through its dependents.
import { expect, test } from "vitest";
import { runScenario } from "./run.js";

const cases: Record<string, any> = {
  // [s0=2 m0=async(s0)] <span fx[m0()]>isPending(m0)</span> :: S5 m A(s0=0) s0=2
  "isPending settles when the re-ask nets to the committed question": {
    signals: [2],
    memos: [{ async: true, deps: [{ src: { k: "s", i: 0 }, how: "plain" }], poison: null }],
    tree: {
      t: "leaf",
      text: [{ how: "pending", src: { k: "m", i: 0 } }],
      attrs: [{ how: "plain", src: { k: "m", i: 0 } }],
      grouped: true
    },
    steps: [
      { t: "settle", pick: 5 },
      { t: "micro" },
      { t: "action", s: 0, v: 0 },
      { t: "write", s: 0, v: 2 }
    ]
  },
  // [s0=2 s1=2 m0=async(s1 !%4=1)] <span>m0()</span> :: S4 m s1=0
  "a refetch's rejection reaches the store's readers": {
    signals: [2, 2],
    memos: [{ async: true, deps: [{ src: { k: "s", i: 1 }, how: "plain" }], poison: 1 }],
    tree: { t: "leaf", text: [{ how: "plain", src: { k: "m", i: 0 } }], attrs: [], grouped: true },
    steps: [{ t: "settle", pick: 4 }, { t: "micro" }, { t: "write", s: 1, v: 0 }]
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
