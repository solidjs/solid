/**
 * A pending source's settle walk reaches a diamond's join twice. The second
 * arrival still takes the walk's early-return branch (a verdict reader's
 * re-run, a staged error's mark): sharing the walk with the other dependent
 * walks (#4560) once skipped it, and the join re-showed its committed value
 * between the held error's staging and its commit (an extra "false:3").
 * Pins `next`'s diamond output. The chain's extra "false:3" is the separate
 * graph-shape question (#4562), not pinned here.
 */
import { afterEach, expect, it } from "vitest";
import {
  action,
  createErrorBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  resetErrorHalt
} from "../src/index.js";

afterEach(() => resetErrorHalt());

const tick = async () => {
  await new Promise(r => setTimeout(r, 0));
  flush();
};

it("a diamond's join revisited by the settle walk keeps the early-return branch", async () => {
  const [s, setS] = createSignal(0);
  const log: unknown[] = [];
  let release!: () => void;
  const dispose = createRoot(d => {
    const A = createMemo(async () => {
      const v = s();
      await Promise.resolve();
      if (v === 2) throw new Error("boomA");
      return v;
    });
    const B = createMemo(() => A() + 1);
    const C = createMemo(() => A() + 2);
    const D = createMemo(() => B() + C());
    const view = createErrorBoundary(
      () => `${isPending(D)}:` + D(),
      e => `E:${(e() as Error).message}`
    );
    createRenderEffect(view, v => void log.push(v));
    return d;
  });
  await tick();
  setS(1);
  flush();
  action(function* () {
    setS(2);
    yield new Promise<void>(r => (release = r));
  })();
  await tick();
  release();
  await tick();
  await tick();
  setS(3);
  flush();
  await tick();
  await tick();
  expect(log).toEqual(["false:3", "true:3", "E:boomA", "false:9"]);
  dispose();
});
