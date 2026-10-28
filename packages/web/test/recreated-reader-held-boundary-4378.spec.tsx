/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4378 (async-app generator, pair E8): a reader recreated in the flush that
// clears an upstream error ends with the async memo's error, as the reader
// that was not recreated does — not an empty hole. The signals-side pin is
// `packages/signals/tests/recreated-reader-held-boundary-4378.test.ts`.
import { describe, expect, test } from "vitest";
import { createMemo, createSignal, Errored, flush, latest, Loading, Show } from "solid-js";
import { render } from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise(r => setTimeout(r, 0));
  flush();
};

describe("a reader born in the flush that clears an upstream error (#4378)", () => {
  for (const recreate of [false, true])
    test(recreate ? "recreated in that flush" : "kept", async () => {
      const requests: Array<() => void> = [];
      const fetchM1 = (x: number) =>
        new Promise<number>((res, rej) =>
          requests.push(() => (x % 4 === 0 ? rej(new Error("m1:" + x)) : res(x)))
        );
      const div = document.createElement("div");
      let setS!: (v: number) => void, setEpoch!: (v: number) => void;
      const dispose = render(() => {
        const [s, _setS] = createSignal(3);
        setS = _setS;
        const m0 = createMemo(() => {
          const v = 1 + latest(s);
          if (v % 4 === 0) throw new Error("m0");
          return v;
        });
        const m1 = createMemo(() => fetchM1(1 + m0()));
        const [epoch, _setEpoch] = createSignal(1);
        setEpoch = _setEpoch;
        return (
          <Errored fallback={() => "[ERR]"}>
            <Loading fallback="[LOAD]">
              <Show when={epoch()} keyed>
                <span>{m1()}</span>
              </Show>
            </Loading>
          </Errored>
        );
      }, div);
      flush();
      await tick();
      expect(div.innerHTML).toBe("[ERR]");
      setS(2);
      if (recreate) setEpoch(2);
      flush();
      for (let i = 0; i < 5; i++) {
        while (requests.length) requests.shift()!();
        await tick();
      }
      expect(div.innerHTML).toBe("[ERR]");
      dispose();
    });
});
