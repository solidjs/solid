import { expect, it } from "vitest";
import {
  action,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  latest
} from "../src/index.js";

// A derived store over a display-ahead memo (`m = memo(1 + latest(s))`,
// `d.v = m()`) reads like the memo (async-gen E3, D-25 / F-6). An action
// writes `s` and stays open: `m` shows the action's value now (its verdict
// lane), and so must `store.v` — the derive's pass is that lane's work, so
// its write is the lane's derivation, not a staging held with the action.
for (const kind of ["memo", "store"] as const)
  it(`${kind}: a derive over latest() shows the action's value now`, () => {
    const [s, setS] = createSignal(1);
    let shown: unknown;
    createRoot(() => {
      const m = createMemo(() => 1 + latest(s));
      let view: () => unknown = m;
      if (kind === "store") {
        const [st] = createStore<{ v?: number }>(d => {
          d.v = m();
        }, {});
        view = () => st.v;
      }
      createRenderEffect(view, v => {
        shown = v;
      });
    });
    flush();
    expect(shown).toBe(2);
    const act = action(function* (n: number) {
      setS(n);
      yield new Promise(() => {});
    });
    act(0);
    flush();
    expect(shown).toBe(1);
  });
