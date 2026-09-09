// #3322: effects have one value slot and do not entangle transactions. When
// two live transactions (or a transaction and mainline) both recompute the
// same render effect, the later write overwrote the earlier owner's value and
// that owner's commit — silent, staging already notified — published it. The
// fix re-derives such effects against the committed world at each owed commit
// (Transition._contested), and masks a foreign transaction's staged signal
// from stale readers on the signal fast path as the slow path already did.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemo, createRenderEffect, createRoot, createSignal, flush } from "../src/index.js";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  flush();
  vi.useRealTimers();
});

describe("contested effects (#3322)", () => {
  it("two non-entangled transactions: a render effect reading both publishes a then b", async () => {
    const [a, setA] = createSignal(0);
    const [b, setB] = createSignal(0);
    const onlyA: number[] = [];
    const onlyB: number[] = [];
    const both: string[] = [];

    createRoot(() => {
      const dA = createMemo(async () => {
        const r = a();
        await sleep(400);
        return r;
      });
      const dB = createMemo(async () => {
        const r = b();
        await sleep(400);
        return r;
      });
      createRenderEffect(dA, () => {});
      createRenderEffect(dB, () => {});
      createRenderEffect(a, v => void onlyA.push(v));
      createRenderEffect(b, v => void onlyB.push(v));
      createRenderEffect(
        () => `${a()}:${b()}`,
        v => void both.push(v)
      );
    });
    flush();
    await vi.advanceTimersByTimeAsync(500);
    expect(both).toEqual(["0:0"]);

    setA(1); // transaction A, lands at +400
    flush();
    await vi.advanceTimersByTimeAsync(200);
    setB(1); // transaction B, lands at +400 — overwrites the effect's slot with "0:1"
    flush();

    await vi.advanceTimersByTimeAsync(100);
    expect(both.at(-1)).toBe("0:0");

    // A commits: the effect re-derives from the committed world, never "0:1"
    await vi.advanceTimersByTimeAsync(150);
    expect(onlyA.at(-1)).toBe(1);
    expect(onlyB.at(-1)).toBe(0);
    expect(both.at(-1)).toBe("1:0");

    // B commits: the effect re-derives again instead of being left stale
    await vi.advanceTimersByTimeAsync(250);
    expect(onlyB.at(-1)).toBe(1);
    expect(both).toEqual(["0:0", "1:0", "1:1"]);
  });

  it("mainline recompute of an effect a transaction computed: masks the staged write, re-derives at its commit", async () => {
    const [b, setB] = createSignal(0);
    const [c, setC] = createSignal(0);
    const seen: string[] = [];

    createRoot(() => {
      const dB = createMemo(async () => {
        const r = b();
        await sleep(400);
        return r;
      });
      createRenderEffect(dB, () => {});
      createRenderEffect(
        () => `${b()}:${c()}`,
        v => void seen.push(v)
      );
    });
    flush();
    await vi.advanceTimersByTimeAsync(500);
    expect(seen).toEqual(["0:0"]);

    setB(1); // transaction T holds; the effect computed "1:0" under it
    flush();
    await vi.advanceTimersByTimeAsync(100);

    // Mainline write: the effect recomputes as a zombie and must render the
    // committed b, not T's staged one.
    setC(1);
    flush();
    expect(seen.at(-1)).toBe("0:1");

    // T commits silently; the effect's slot held the mainline value, so it
    // must be re-derived here rather than left at "0:1".
    await vi.advanceTimersByTimeAsync(400);
    expect(seen).toEqual(["0:0", "0:1", "1:1"]);
  });

  it("a transaction whose writes never touch the effect does not re-run it", async () => {
    const [a, setA] = createSignal(0);
    const [b, setB] = createSignal(0);
    const runs = vi.fn();

    createRoot(() => {
      const dB = createMemo(async () => {
        const r = b();
        await sleep(400);
        return r;
      });
      createRenderEffect(dB, () => {});
      createRenderEffect(a, runs);
    });
    flush();
    await vi.advanceTimersByTimeAsync(500);
    expect(runs).toHaveBeenCalledTimes(1);

    setB(1); // transaction on b only
    flush();
    await vi.advanceTimersByTimeAsync(100);
    setA(1); // mainline write to a while the transaction is live
    flush();
    expect(runs).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(400);
    expect(runs).toHaveBeenCalledTimes(2);
  });
});
