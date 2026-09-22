/**
 * #3457: a memo wrapping isPending(copy) must agree with a direct
 * isPending(copy) read while a sibling async memo holds the write.
 *
 * `slow` pends first and opens the transaction; `copy` then stages its value
 * straight into the transaction's batch, unstamped until the flush stashes
 * the hold. The wrapper memo recomputes on the companion flip, reads copy's
 * fresh staged value, and the A10 pairing rule must not mute the verdict:
 * the transaction's async source is still computing (#3028), stamp or not.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending
} from "../src/index.js";

// Fake timers: the test asserts that `slow` has NOT landed 5 ms into a 20 ms
// flight. On the wall clock that window is a race a loaded CI runner lost
// (the +5 checkpoint saw the +20 landing); on the fake clock every step
// below advances exactly the ms it says.
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  flush();
  vi.useRealTimers();
});

const delay = <T>(ms: number, value: T) => new Promise<T>(r => setTimeout(r, ms, value));
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

describe("memo-wrapped isPending agrees with a direct read through a hold (#3457)", () => {
  it("A10 / #3457 isPending(copy) inside a memo reports the hold like the direct probe", async () => {
    let setCount!: (v: number) => void;
    let direct: boolean | undefined;
    let viaMemo: boolean | undefined;
    let slowShown: number | undefined;
    createRoot(() => {
      const [count, set] = createSignal(0);
      setCount = set;
      const slow = createMemo(() => delay(20, count()));
      const copy = createMemo(() => count());
      const pending = createMemo(() => isPending(copy));
      createRenderEffect(
        () => count(),
        () => {}
      );
      createRenderEffect(
        () => slow(),
        v => {
          slowShown = v;
        }
      );
      createRenderEffect(
        () => isPending(copy),
        v => {
          direct = v;
        }
      );
      createRenderEffect(
        () => pending(),
        v => {
          viaMemo = v;
        }
      );
    });
    flush();
    await advance(40);
    flush();
    expect(slowShown).toBe(0);
    expect(direct).toBe(false);
    expect(viaMemo).toBe(false);

    setCount(1);
    flush();
    // Held: the old value displays, both probes report pending.
    expect(slowShown).toBe(0);
    expect(direct).toBe(true);
    expect(viaMemo).toBe(true);
    // +5 ms: still mid-flight (the 20 ms timer has not fired), still held.
    await advance(5);
    flush();
    expect(slowShown).toBe(0);
    expect(direct).toBe(true);
    expect(viaMemo).toBe(true);

    // +60 ms: the flight landed at +20; the hold committed.
    await advance(60);
    flush();
    expect(slowShown).toBe(1);
    expect(direct).toBe(false);
    expect(viaMemo).toBe(false);
  });
});
