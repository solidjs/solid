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
import { afterEach, describe, expect, it } from "vitest";
import {
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending
} from "../src/index.js";

afterEach(() => flush());

const delay = <T>(ms: number, value: T) => new Promise<T>(r => setTimeout(r, ms, value));

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
    await delay(40, 0);
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
    await delay(5, 0);
    flush();
    expect(slowShown).toBe(0);
    expect(direct).toBe(true);
    expect(viaMemo).toBe(true);

    await delay(60, 0);
    flush();
    expect(slowShown).toBe(1);
    expect(direct).toBe(false);
    expect(viaMemo).toBe(false);
  });
});
