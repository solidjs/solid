// #4142: a lazy async memo whose only reader is a child memo that an
// unfinished pass rebuilds. The pass tears the old child down before it
// creates the new one, so the lazy memo briefly had no subscriber and was
// released on the spot; the new child's read then re-ran it, it went pending
// again, and the cycle repeated forever.
import { expect, it } from "vitest";
import {
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  onCleanup
} from "../src/index.js";

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

it("a lazy async memo read only through a rebuilt child memo runs once", async () => {
  let runs = 0;
  const seen: string[] = [];
  const dispose = createRoot(d => {
    const user = createMemo(
      async () => {
        runs++;
        await wait(5);
        return { name: "admin" };
      },
      { lazy: true }
    );
    createRenderEffect(
      () => {
        const cond = createMemo(() => !!user());
        return cond() ? "yes" : "no";
      },
      v => {
        seen.push(v);
      }
    );
    return d;
  });
  flush();
  for (let i = 0; i < 10; i++) await wait(5);
  expect(runs).toBe(1);
  expect(seen).toEqual(["yes"]);
  dispose();
});

it("a lazy memo the rebuilt pass stops reading is released when the pass ends", () => {
  let released = 0;
  let setTick!: (v: number) => void;
  const dispose = createRoot(d => {
    const [tick, _setTick] = createSignal(0);
    setTick = _setTick;
    const lazy = createMemo(
      () => {
        onCleanup(() => released++);
        return 1;
      },
      { lazy: true }
    );
    // A pass that never settles: each new pass tears down the last one's
    // children on the spot.
    const held = createMemo(() => {
      if (tick() === 0) createMemo(() => lazy())();
      return new Promise<number>(() => {});
    });
    createRenderEffect(held, () => {});
    return d;
  });
  flush();
  expect(released).toBe(0);
  setTick(1);
  flush();
  expect(released).toBe(1);
  dispose();
});
