/**
 * A plain write an action makes after a `yield` is held with the action
 * (F-2, D-7) — also for a render effect that reads a guess the same action
 * made in an earlier slice. The guess shows now (F-6, F-11); the held write
 * does not (F-7, D-37: a lane sees the screen plus its own guesses).
 */
import { describe, expect, it } from "vitest";
import {
  action,
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
const defer = () => {
  let res!: () => void;
  const p = new Promise<void>(a => (res = a));
  return { p, res };
};

describe("a held write beside a guess from an earlier slice", () => {
  for (const order of ["write first", "guess first"] as const)
    it(`one render effect reading both keeps the held write off screen (${order})`, async () => {
      const frames: string[] = [];
      let setOther!: (v: number) => void;
      let setG!: (v: string) => void;
      createRoot(() => {
        const [other, so] = createSignal(0);
        const [g, sg] = createOptimistic("a");
        setOther = so;
        setG = sg;
        createRenderEffect(
          () =>
            order === "write first"
              ? `${other()} ${g()}`
              : `${g()} ${other()}`.split(" ").reverse().join(" "),
          v => void frames.push(v)
        );
      });
      flush();
      const go = defer();
      const done = defer();
      action(function* () {
        setG("b");
        yield go.p;
        setOther(1);
        yield done.p;
      })();
      await tick();
      expect(frames).toEqual(["0 a", "0 b"]);
      go.res();
      await tick();
      expect(frames.at(-1)).toBe("0 b");
      done.res();
      await tick();
      expect(frames.at(-1)).toBe("1 a");
      // The held write never shows before the commit.
      expect(frames.slice(0, -1).filter(f => f.startsWith("1"))).toEqual([]);
    });

  it("split render effects agree", async () => {
    const left: number[] = [];
    const right: string[] = [];
    let setOther!: (v: number) => void;
    let setG!: (v: string) => void;
    createRoot(() => {
      const [other, so] = createSignal(0);
      const [g, sg] = createOptimistic("a");
      setOther = so;
      setG = sg;
      createRenderEffect(other, v => void left.push(v));
      createRenderEffect(g, v => void right.push(v));
    });
    flush();
    const go = defer();
    const done = defer();
    action(function* () {
      setG("b");
      yield go.p;
      setOther(1);
      yield done.p;
    })();
    await tick();
    go.res();
    await tick();
    expect([left.at(-1), right.at(-1)]).toEqual([0, "b"]);
    done.res();
    await tick();
    expect([left.at(-1), right.at(-1)]).toEqual([1, "a"]);
  });
});
