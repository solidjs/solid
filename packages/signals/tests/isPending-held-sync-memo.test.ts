/**
 * #3413: a synchronous memo held by a downstream async memo must report
 * isPending() true, like the signal it derives from.
 *
 * The write lands in a plain flush; the sync memo recomputes and stages its
 * value before the async memo pends and turns the batch into a held
 * transaction. The staged recompute must still refresh the memo's verdict
 * companion, or the hold is invisible to isPending(memo) until it commits.
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

describe("isPending on a held sync memo (#3413)", () => {
  it("reports pending for the identity memo while the async memo holds the write", async () => {
    let setCount!: (v: number) => void;
    let countPending: boolean | undefined;
    let copyPending: boolean | undefined;
    let copyShown: number | undefined;
    createRoot(() => {
      const [count, set] = createSignal(0);
      setCount = set;
      const copy = createMemo(() => count());
      const details = createMemo(() => delay(20, copy()));
      createRenderEffect(
        () => copy(),
        v => {
          copyShown = v;
        }
      );
      createRenderEffect(
        () => details(),
        () => {}
      );
      createRenderEffect(
        () => isPending(count),
        v => {
          countPending = v;
        }
      );
      createRenderEffect(
        () => isPending(copy),
        v => {
          copyPending = v;
        }
      );
    });
    flush();
    await delay(40, 0);
    flush();
    expect(copyShown).toBe(0);
    expect(countPending).toBe(false);
    expect(copyPending).toBe(false);

    setCount(1);
    flush();
    // Held: both display the old value, both report pending.
    expect(copyShown).toBe(0);
    expect(countPending).toBe(true);
    expect(copyPending).toBe(true);

    await delay(60, 0);
    flush();
    expect(copyShown).toBe(1);
    expect(countPending).toBe(false);
    expect(copyPending).toBe(false);
  });
});
