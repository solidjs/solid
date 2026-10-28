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
import { runScenario } from "./async-gen/run.js";
import type { Scenario } from "./async-gen/scenario.js";

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

// The generator's E8 case at next @ 40cde2cd: the staging the hold built is
// superseded at every frame node up the chain (the inner Errored, the root
// Loading and Errored), each re-run from the heap outside its hold and back
// to its committed fallback.
test("the generator's E8 case: recreated readers under nested boundaries (#4378)", async () => {
  const sc: Scenario = {
    signals: [2, 3],
    memos: [
      { async: false, deps: [{ src: { k: "s", i: 1 }, how: "latest" }], poison: 0 },
      { async: true, deps: [{ src: { k: "m", i: 0 }, how: "plain" }], poison: 0 }
    ],
    tree: {
      t: "errored",
      child: {
        t: "leaf",
        text: [],
        attrs: [
          { how: "plain", src: { k: "s", i: 1 } },
          { how: "plain", src: { k: "m", i: 1 } }
        ],
        grouped: false
      }
    },
    steps: [
      { t: "settle", pick: 0 },
      { t: "task" },
      { t: "action", s: 1, v: 0 },
      { t: "write", s: 1, v: 1 },
      { t: "flush" },
      { t: "action", s: 1, v: 0 },
      { t: "write", s: 1, v: 2 },
      { t: "settle", pick: 3 }
    ]
  } as Scenario;
  const kept = await runScenario(sc);
  const recreated = await runScenario(sc, { remount: true });
  // Where nothing is in flight (the last step settles the last request).
  expect(recreated.screens.at(-1)).toBe("[E]");
  expect(recreated.final).toBe(kept.final);
  expect(recreated.final).toBe("[E]");
});
