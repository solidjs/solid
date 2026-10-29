/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// async-gen campaign 1 (seed 3289), E3 store twin, minimized case 34:
//   <Show when={isPending(m0)} fallback={…}><span>{m1()}</span></Show>
// with `m1` over `latest(m0)`, poisoned at the final input. A derived
// store's first landing is its first answer, not pending (F-9, D-30), as
// for the memo it copies: the Show never opens, so its child never meets
// `m1`'s error. The signals-side pin is
// `packages/signals/tests/derived-store-first-landing-verdict.test.ts`.
import { describe, expect, test } from "vitest";
import {
  createMemo,
  createSignal,
  createStore,
  Errored,
  isPending,
  latest,
  Loading,
  Show
} from "solid-js";
import { render } from "../src/index.js";

const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise(r => setTimeout(r, 0));
};

describe("a derived store's first landing is not pending", () => {
  for (const via of ["memo", "store"] as const)
    test(`${via}: the gate stays on its fallback`, async () => {
      const div = document.createElement("div");
      const flights: (() => void)[] = [];
      let set!: (v: number) => void;
      const dispose = render(() => {
        const [s, setS] = createSignal(0);
        set = setS;
        const m0 = createMemo(() => {
          const v = 1 + 2 * s();
          return new Promise<number>(r => flights.push(() => r(v)));
        });
        const m1 = createMemo(() => {
          const v = 1 + latest(m0) + s();
          if (v % 4 === 1) throw new Error("m1:" + v);
          return v;
        });
        let view0: () => number | undefined = m0;
        let view1: () => number | undefined = m1;
        if (via === "store") {
          const [st0] = createStore<{ v?: number }>(d => {
            d.v = m0();
          }, {});
          const [st1] = createStore<{ v?: number }>(d => {
            d.v = m1();
          }, {});
          view0 = () => st0.v;
          view1 = () => st1.v;
        }
        return (
          <Errored fallback={<b>error</b>}>
            <Loading fallback={<i>loading</i>}>
              <Show when={isPending(view0)} fallback={<u>idle</u>}>
                <span>{view1()}</span>
              </Show>
            </Loading>
          </Errored>
        );
      }, div);
      expect(div.innerHTML).toBe("<i>loading</i>");
      set(1);
      await settle();
      while (flights.length) {
        flights.splice(0, 1).forEach(f => f());
        await settle();
      }
      expect(div.innerHTML).toBe("<u>idle</u>");
      dispose();
    });
});
