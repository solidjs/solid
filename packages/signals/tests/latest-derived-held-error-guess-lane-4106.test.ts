/**
 * #4106 follow-up: a derivation inside an optimistic guess lane that is not
 * itself a written guess has no override of its own to show. When a mainline
 * source it reads errors, the error is its answer (D-41: "a derivation that
 * reads a staged error throws it, as it would read a staged value"), so its
 * reads throw the error its effect receives. Serving the lane's pre-error
 * value to reads while the effect gets the error would tear (F-1).
 */
import { expect, it } from "vitest";
import {
  action,
  createEffect,
  createMemo,
  createOptimistic,
  createRoot,
  createSignal,
  flush,
  latest
} from "../src/index.js";

const tick = async () => {
  await new Promise(r => setTimeout(r, 0));
  flush();
};
const read = (fn: () => unknown) => {
  try {
    return fn();
  } catch (e) {
    return e instanceof Error ? e.message : e;
  }
};

it("a guess-lane derivation's reads throw the mainline error its effect receives", async () => {
  const [fail, setFail] = createSignal(false);
  const log: unknown[] = [];
  let derived!: () => number;
  let guess!: (v: number) => void;
  createRoot(() => {
    const [count, setCount] = createOptimistic(10);
    guess = v => setCount(v);
    const mainline = createMemo(() => {
      if (fail()) throw new Error("boom");
      return 1;
    });
    derived = createMemo(() => count() + mainline());
    createEffect(derived, {
      effect: v => void log.push(v),
      error: e => void log.push((e as Error).message)
    });
  });
  flush();
  expect(log).toEqual([11]);

  let release!: () => void;
  const save = action(function* () {
    guess(20);
    yield new Promise<void>(r => (release = r));
  });
  const done = save();
  flush();
  expect(read(derived)).toBe(21);

  setFail(true);
  flush();
  expect(log.at(-1)).toBe("boom");
  expect(read(derived)).toBe("boom");
  expect(read(() => latest(derived))).toBe("boom");

  release();
  await done;
  await tick();
  expect(read(derived)).toBe("boom");
});
