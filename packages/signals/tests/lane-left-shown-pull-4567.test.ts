/**
 * LEFT_SHOWN (#3892) on a pulled pass. A memo the shown lane derived from a
 * guess re-passes without reading the guess, back to its committed value:
 * the equality gate sees no change, so nothing notifies, yet its readers
 * show the guess-derived value. The seam wakes them.
 *
 * Here the pass is pulled — a lower reader reads the memo before the heap
 * reaches it (`updateIfNecessary`). The mark is the node's notify stamp
 * (`_notifiedAt`), so it survives the pull's flag reset, as it survives a
 * heap pass: the reader that shows the memo re-runs and leaves the guess.
 * (Before #4567 the mark was a pass flag the pull path cleared, and the
 * reader kept showing the guess-derived value.)
 */
import { expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "../src/index.js";

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  flush();
};

for (const pulled of [false, true])
  it(`a ${pulled ? "pulled" : "heap"} pass leaving the shown lane wakes the memo's readers`, async () => {
    const [truth] = createSignal(0);
    const [guess, setGuess] = createOptimistic(truth);
    const [mode, setMode] = createSignal(true);
    const go = action(function* () {
      setGuess(5);
      yield new Promise<void>(() => {});
    });
    const shown: number[] = [];
    const pulls: number[] = [];
    createRoot(() => {
      // Created first and reading only `mode` until it flips: its height is
      // below `m`'s, so the flush runs it first and its read of `m` pulls.
      const reader = pulled ? createMemo(() => (mode() ? -1 : m())) : undefined;
      const m = createMemo(() => (mode() ? guess() : truth()));
      if (reader) createRenderEffect(reader, v => void pulls.push(v));
      createRenderEffect(m, v => void shown.push(v));
    });
    flush();
    expect(shown).toEqual([0]);

    go();
    await settle();
    // The guess shows.
    expect(shown).toEqual([0, 5]);

    setMode(false);
    await settle();
    // `m` is back on the truth (0, its committed value): the reader that
    // showed 5 shows 0.
    expect(shown).toEqual([0, 5, 0]);
    if (pulled) expect(pulls.at(-1)).toBe(0);
  });
