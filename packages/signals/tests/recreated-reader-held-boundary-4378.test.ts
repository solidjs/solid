/**
 * #4378: a reader created in the flush that clears an upstream error, under
 * `Errored > Loading > Show keyed`, ends with the async memo's error, as the
 * reader that was not recreated does. The new reader waits on `m1`'s flight,
 * so the frame holds and the boundary's output stages its content with it.
 * The rejection then re-derives the output outside that transaction's flush:
 * it publishes mainline (#3404), back to the fallback it had committed — an
 * unchanged value, so nothing re-derived its reader, and the landing applied
 * the reader's held run of the superseded content: an empty hole.
 */
import { describe, expect, it } from "vitest";
import {
  createErrorBoundary,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  latest
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise(r => setTimeout(r, 0));
  flush();
};

describe("a reader born in the flush that clears an upstream error (#4378)", () => {
  for (const recreate of [false, true])
    it(recreate ? "recreated in that flush" : "kept", async () => {
      const requests: Array<() => void> = [];
      const fetchM1 = (x: number) =>
        new Promise<number>((res, rej) =>
          requests.push(() => (x % 4 === 0 ? rej(new Error("m1:" + x)) : res(x)))
        );
      const [s, setS] = createSignal(3);
      const [epoch, setEpoch] = createSignal(1);
      let slot: unknown = "";
      let screen: unknown;
      createRoot(() => {
        const m0 = createMemo(() => {
          const v = 1 + latest(s);
          if (v % 4 === 0) throw new Error("m0"); // throws at s = 3
          return v;
        });
        const m1 = createMemo(() => fetchM1(1 + m0())); // at s = 2 asks for 4: rejects
        // <Errored fallback="[ERR]"><Loading fallback="[LOAD]">
        //   <Show when={epoch()} keyed><span>{m1()}</span></Show>
        // </Loading></Errored>
        const out = createErrorBoundary(
          () =>
            createLoadingBoundary(
              () =>
                createMemo(() => {
                  epoch();
                  createRenderEffect(m1, v => void (slot = v));
                  return "span";
                }),
              () => "[LOAD]"
            ),
          () => "[ERR]"
        );
        createRenderEffect(
          () => {
            let v: unknown = out();
            while (typeof v === "function") v = v();
            return v;
          },
          v => void (screen = v)
        );
      });
      flush();
      await tick();
      expect(screen).toBe("[ERR]");
      setS(2);
      if (recreate) setEpoch(2);
      flush();
      for (let i = 0; i < 5; i++) {
        while (requests.length) requests.shift()!();
        await tick();
      }
      expect([screen, slot]).toEqual(["[ERR]", ""]);
    });
});
