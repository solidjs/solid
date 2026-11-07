import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  flush,
  isPending
} from "../src/index.js";

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
};

describe("#4685 isPending over an unrevealed lane landing", () => {
  it("stays true until the changed lane value is revealed", async () => {
    const [opt, setOpt] = createOptimistic(0);
    const left = deferred<number>();
    const right = deferred<number>();
    const screen = { left: "", pending: "", total: "" };
    const frames: string[] = [];
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const leftMemo = createMemo(async () => {
        const v = opt();
        if (v === 0) return 0;
        await left.promise;
        return 10;
      });
      const rightMemo = createMemo(async () => {
        const v = opt();
        if (v === 0) return 0;
        await right.promise;
        return 20;
      });
      const total = createMemo(() => leftMemo() + rightMemo());
      const bind = (k: keyof typeof screen, fn: () => unknown) =>
        createRenderEffect(fn, v => {
          screen[k] = String(v);
        });
      bind("left", leftMemo);
      bind("pending", () => isPending(leftMemo));
      bind("total", total);
    });
    flush();
    const snap = () =>
      frames.push(`left ${screen.left} | pending ${screen.pending} | total ${screen.total}`);
    await tick();
    snap();

    const act = action(function* () {
      setOpt(1);
      yield new Promise(() => {});
    });
    act();
    await tick();
    snap();

    left.resolve(10);
    await tick();
    snap();

    right.resolve(20);
    await tick();
    snap();

    expect(frames).toEqual([
      "left 0 | pending false | total 0",
      "left 0 | pending true | total 0",
      "left 0 | pending true | total 0",
      "left 10 | pending false | total 30"
    ]);
    dispose();
  });
});
