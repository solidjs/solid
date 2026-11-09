/**
 * @vitest-environment jsdom
 */
// async-gen rerun on rc.20, E3 (a derived store `createStore(d => { d.v = m() })`
// reads like `m`): an action makes the derive's source stage an error. The
// staged error reaches a memo's derivations (D-41), but a derive was skipped:
// its leaves' readers learn its status through its family, and nothing told
// the family. `latest(store.v)` kept the old value where `latest(m)` throws,
// and `isPending` over the store read false where over a memo it reads true.
import { expect, test } from "vitest";
import { runScenario } from "./run.js";

const cases: Record<string, any> = {
  // [s0=1 s1=2 m0=memo(s1 !%4=1)] <Show when=s1()><span fx[latest(m0)]></span></Show> :: A(s1=0) t
  "latest of the store throws the staged error": {
    signals: [1, 2],
    memos: [{ async: false, deps: [{ src: { k: "s", i: 1 }, how: "plain" }], poison: 1 }],
    tree: {
      t: "show",
      when: { how: "plain", src: { k: "s", i: 1 } },
      child: {
        t: "leaf",
        text: [],
        attrs: [{ how: "latest", src: { k: "m", i: 0 } }],
        grouped: true
      },
      fallback: false
    },
    steps: [{ t: "action", s: 1, v: 0 }, { t: "task" }]
  },
  // [s0=0 m0=memo(s0 !%4=2) m1=memo(m0+m0 !%4=3)] <span fx[isPending(m1)]></span> :: A(s0=2) t
  "isPending of a store over the staged error is true": {
    signals: [0],
    memos: [
      { async: false, deps: [{ src: { k: "s", i: 0 }, how: "plain" }], poison: 2 },
      {
        async: false,
        deps: [
          { src: { k: "m", i: 0 }, how: "plain" },
          { src: { k: "m", i: 0 }, how: "plain" }
        ],
        poison: 3
      }
    ],
    tree: {
      t: "leaf",
      text: [],
      attrs: [{ how: "pending", src: { k: "m", i: 1 } }],
      grouped: true
    },
    steps: [{ t: "action", s: 0, v: 2 }, { t: "task" }]
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
