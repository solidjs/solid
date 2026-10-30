/**
 * #4429 — a memo's pass pulled inside a verdict window is its own (A31),
 * whoever woke it.
 *
 * `verdictValue` pulls a dirty memo with the dispatch closed
 * (`setVerdict(null)`), so the memo's plain reads are its own. It left the
 * probe's state set, though: `probing` stayed on for the pulled pass, so a
 * `latest()` the memo calls itself re-entered the window as the outer probe:
 *
 * - `latest()` of a node born held (no committed value, staged) took the
 *   probe's `joinPass` arm: the pulled memo joined the hold, and a memo it
 *   created during that pass was born held (D-27) — where the same pass
 *   pulled by a plain read leaves it mainline (F-vworld: a verdict read
 *   raises no world);
 * - `probeFound` was set from inside the pulled pass (a flight its
 *   `latest()` read), so the outer `isPending` answered for the memo's
 *   reads rather than for the memo.
 *
 * Each case compares the pull inside the window with the same pass woken by
 * a plain read: the memo's pass, its value and what it creates are the same.
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

describe("#4429: a memo pulled inside a verdict window computes as its own pass", () => {
  for (const pull of ["isPending", "plain"] as const)
    it(`latest() of a born-held node in the pulled pass joins nothing (pulled ${pull})`, async () => {
      const [x, setX] = createSignal(0);
      const [s, setS] = createSignal(0);
      const [on, setOn] = createSignal(false);
      let born: (() => number) | null = null;
      let child!: () => number;
      const m1 = createRoot(() => {
        createRenderEffect(x, () => {});
        // Deeper than the reader below: the reader's pass pulls it.
        const sa = createMemo(() => s());
        const m1 = createMemo(() => {
          const v = sa();
          const l = born ? latest(born) : -1;
          // Reads nothing held: born held only if its creator joined.
          child = createMemo(() => v * 100);
          return l * 10 + v;
        });
        createRenderEffect(m1, () => {});
        createRenderEffect(
          () => on() && (pull === "isPending" ? isPending(() => m1()) : m1()),
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

      // Born held: no committed value, its staging (1) its only value.
      createRoot(() => {
        born = createMemo(() => x());
      });
      expect(peek(born!)).toBe("NotReadyError");
      setS(1);
      setOn(true);
      flush();
      // The pulled pass read `latest(born)` = 1 (D-22) and made its child
      // from the screen's s: mainline — not the hold's.
      expect(peek(m1)).toBe(11);
      expect(peek(child)).toBe(100);
      release();
      await settle();
      expect(peek(m1)).toBe(11);
      expect(peek(child)).toBe(100);
    });

  for (const pull of ["isPending", "plain"] as const)
    it(`a flight the pulled pass's latest() reads is not the probe's answer (pulled ${pull})`, async () => {
      const [q, setQ] = createSignal(1);
      const [s, setS] = createSignal(0);
      const [on, setOn] = createSignal(false);
      let resolve!: () => void;
      const seen: unknown[] = [];
      const m1 = createRoot(() => {
        const a = createMemo(async () => {
          const v = q();
          if (v > 1) await new Promise<void>(r => (resolve = r));
          return v;
        });
        createRenderEffect(a, () => {});
        const sa = createMemo(() => s());
        const m1 = createMemo(() => sa() + latest(a) * 10);
        createRenderEffect(m1, () => {});
        createRenderEffect(
          () => on() && (pull === "isPending" ? isPending(() => m1()) : (m1(), isPending(m1))),
          v => {
            seen.push(v);
          }
        );
        return m1;
      });
      await settle();
      expect(peek(m1)).toBe(10);
      setQ(2);
      flush();
      // a is in flight over its committed 1.
      setS(1);
      setOn(true);
      flush();
      // m1 is a settled sync memo of `latest(a)` — the committed 1 while the
      // flight is up: nothing m1 shows is waiting on it.
      expect(peek(m1)).toBe(11);
      expect(seen).toEqual([false, false]);
      resolve();
      await settle();
      expect(peek(m1)).toBe(21);
    });
});
