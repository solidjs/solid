/**
 * A memo's pass pulled inside a `latest()` window is its own (A31), whoever
 * woke it: the sibling of #4429 for the window's kind.
 *
 * `verdictValue` pulls a dirty memo with the dispatch closed, so the memo's
 * plain reads are its own. It left `latestActive` set, though, so an
 * `isPending` the memo calls itself ran as a probe inside the outer
 * `latest()`: for a held write still in the air (`x`), it answered `false`
 * — final — where the same pass pulled by a plain read answers `true`
 * (F-vworld: a verdict read raises no world; D-23).
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest,
  untrack
} from "../src/index.js";

const peek = (fn: () => unknown) => {
  try {
    return untrack(fn);
  } catch (e) {
    return (e as Error).constructor.name;
  }
};

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  flush();
};

describe("a memo pulled inside latest() computes as its own pass", () => {
  for (const pull of ["latest", "plain"] as const)
    it(`isPending() in the pulled pass answers for the memo, not the outer latest window (pulled ${pull})`, async () => {
      const [x, setX] = createSignal(0);
      const [s, setS] = createSignal(0);
      const [on, setOn] = createSignal(false);
      const m1 = createRoot(() => {
        createRenderEffect(x, () => {});
        const sa = createMemo(() => s());
        const m1 = createMemo(() => (sa(), isPending(x)));
        createRenderEffect(m1, () => {});
        createRenderEffect(
          () => on() && (pull === "latest" ? latest(() => m1()) : m1()),
          () => {}
        );
        return m1;
      });
      flush();
      let release!: () => void;
      action(function* () {
        setX(1);
        yield new Promise<void>(r => (release = r));
      })();
      flush();
      expect(peek(m1)).toBe(true);
      setS(1);
      setOn(true);
      flush();
      // x's held write has not landed: the memo's own probe says so.
      expect(peek(m1)).toBe(true);
      release();
      await settle();
      expect(peek(m1)).toBe(false);
    });
});
