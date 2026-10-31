/**
 * @vitest-environment jsdom
 */
// async-gen rerun on rc.20, E3 (a derived store `createStore(d => { d.v = m() })`
// reads like `m`): over a display-ahead memo (`m0 = memo(latest(s0))`), an
// action's write shows through `m0` at once (its verdict lane, D-25 / F-6),
// but the store's leaf was staged with the action and showed the old value
// until the action ended. The derive's pass is the lane's work; its write is
// now the lane's derivation.
import { expect, test } from "vitest";
import { runScenario } from "./run.js";

const cases: Record<string, any> = {
  // [s0=1 m0=memo(latest(s0))] <span split[m0()]></span> :: A(s0=0) t
  "an action's write shows through the store now": {
    signals: [1],
    memos: [{ async: false, deps: [{ src: { k: "s", i: 0 }, how: "latest" }], poison: null }],
    tree: { t: "leaf", text: [], attrs: [{ how: "plain", src: { k: "m", i: 0 } }], grouped: false },
    steps: [{ t: "action", s: 0, v: 0 }, { t: "task" }]
  },
  // [s0=3 m0=memo(latest(s0) !%4=1)] <span>m0()</span> :: A(s0=3) s0=2 t
  "a plain write beside an action shows through the store now": {
    signals: [3],
    memos: [{ async: false, deps: [{ src: { k: "s", i: 0 }, how: "latest" }], poison: 1 }],
    tree: { t: "leaf", text: [{ how: "plain", src: { k: "m", i: 0 } }], attrs: [], grouped: true },
    steps: [{ t: "action", s: 0, v: 3 }, { t: "write", s: 0, v: 2 }, { t: "task" }]
  }
};

for (const [name, sc] of Object.entries(cases))
  test(`E3: ${name}`, async () => {
    const memo = await runScenario(sc, {});
    const store = await runScenario(sc, { store: true });
    expect(store.screens).toEqual(memo.screens);
    expect(store.final).toBe(memo.final);
  });
