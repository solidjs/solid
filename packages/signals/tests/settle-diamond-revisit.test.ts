/**
 * A pending source's settle walk reaches a diamond's join twice. The second
 * arrival still takes the walk's early-return branch (a verdict reader's
 * re-run, a staged error's mark): sharing the walk with the other dependent
 * walks (#4560) once skipped it, and the join re-showed its committed value
 * between the held error's staging and its commit (an extra "false:3").
 * Pins `next`'s diamond output.
 *
 * The chain (#4562): its join is reached once, and that single arrival used
 * to retire the pending state without the staged-error mark, so the view
 * re-showed `false:3` mid-hold. F-9: `isPending(D)` stays true while the
 * staged answer waits in the hold — no new answer has been committed; F-2:
 * the screen keeps `true:3` until the commit; D-41: the derivation of a
 * staged error carries it. Graph shape is not observable: the chain shows
 * the diamond's frames.
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

it("a chain's single arrival keeps the staged mark, as a diamond's second arrival does (#4562)", async () => {
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
    const C = createMemo(() => B() + 2);
    const D = createMemo(() => C());
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
  expect(log).toEqual(["false:3", "true:3", "E:boomA", "false:6"]);
  dispose();
});
