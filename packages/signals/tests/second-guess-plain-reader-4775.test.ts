import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

describe("#4775", () => {
  it("a second guess held by its async consequence does not reach an unrelated rerun", async () => {
    const never = new Promise<number>(() => {});
    let pairShown = "",
      otherShown = "";
    let setTick!: (v: number) => void;
    let guess!: (v: number) => void;
    let run!: () => any;
    let release!: () => void;
    createRoot(() => {
      const [view, setView] = createOptimistic(() => 0);
      const [t, st] = createSignal(0);
      setTick = st;
      guess = setView;
      const derived = createMemo(() => (view() === 2 ? never : view()));
      const pair = createMemo(() => `${view()} / ${derived()}`);
      createRenderEffect(pair, v => {
        pairShown = v;
      });
      createRenderEffect(
        () => `${view()} (tick ${t()})`,
        v => {
          otherShown = v;
        }
      );
      run = action(function* () {
        guess(1);
        yield new Promise<void>(r => (release = r));
        guess(2);
        yield never;
      });
    });
    flush();
    expect([pairShown, otherShown]).toEqual(["0 / 0", "0 (tick 0)"]);
    run();
    await tick();
    expect([pairShown, otherShown]).toEqual(["1 / 1", "1 (tick 0)"]);
    release();
    await tick();
    expect([pairShown, otherShown]).toEqual(["1 / 1", "1 (tick 0)"]);
    setTick(1);
    flush();
    await tick();
    expect([pairShown, otherShown]).toEqual(["1 / 1", "1 (tick 1)"]);
  });
});
