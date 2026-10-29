/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// async-gen campaign 1 (seed 3289), E3 store twin, minimized case 1: a
// derived store over an async memo that reads an errored memo through
// `latest()`. After the recovery lands, a hole reading the store shows the
// value, as a hole reading the memo does — an attribute or a text hole
// (JSX grouping never changes the result). The signals-side pin is
// `packages/signals/tests/derived-store-recovery-wake.test.ts`.
import { describe, expect, test } from "vitest";
import { createMemo, createSignal, createStore, Errored, latest, Loading } from "solid-js";
import { render } from "../src/index.js";

const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise(r => setTimeout(r, 0));
};

describe("a derived store's reader recovers from its error", () => {
  for (const via of ["memo", "store"] as const)
    for (const hole of ["attribute", "text"] as const)
      test(`${via}, ${hole} hole: the recovered value shows`, async () => {
        const div = document.createElement("div");
        const flights: (() => void)[] = [];
        let set!: (v: number) => void;
        const dispose = render(() => {
          const [s, setS] = createSignal(0);
          set = setS;
          const m0 = createMemo(() => {
            const v = 1 + s();
            if (v % 4 === 1) throw new Error("m0:" + v);
            return v;
          });
          const m1 = createMemo(() => {
            const v = 1 + latest(m0);
            return new Promise<number>(r => flights.push(() => r(v)));
          });
          let view: () => number | undefined = m1;
          if (via === "store") {
            const [state] = createStore<{ v?: number }>(d => {
              d.v = m1();
            }, {});
            view = () => state.v;
          }
          return (
            <Errored fallback={<b>error</b>}>
              <Loading fallback={<i>loading</i>}>
                {hole === "attribute" ? <span data-v={view()} /> : <span>{view()}</span>}
              </Loading>
            </Errored>
          );
        }, div);
        expect(div.innerHTML).toBe("<b>error</b>");
        set(3);
        await settle();
        flights.splice(0).forEach(f => f());
        await settle();
        expect(div.innerHTML).toBe(
          hole === "attribute" ? '<span data-v="5"></span>' : "<span>5</span>"
        );
        dispose();
      });
});
