// A stale (render) reader that lands on an async memo which is pending in a
// DIFFERENT transition normally keeps showing that memo's committed value
// (no entanglement). An UNINITIALIZED memo has no committed value to show:
// falling through served `undefined` as if settled and left the reader
// stamped into neither transaction, so it never re-ran when either landed.
//
//   effA: a -> memo("foo" + a)          setA(1) opens T1 (memo foo1 in flight)
//   effB: b -> memo("foo" + b)          setB(1) opens T2; effB now reads foo1,
//   effC: b -> memo("bar" + b)            held in T1, while bar1 holds T2
//
// Memos are cached by key so effB picks up the very instance effA created.
// Repro shape from the s.olid.uk playground report (cached async memo +
// staggered clicks); regression bisected to 7d4d0c3a, whose needsPendingCommit
// gate removed the accidental pending-node stamp that used to entangle effB.
import { describe, expect, it } from "vitest";
import {
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "../src/index.js";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  flush();
}

describe("stale reader of an uninitialized memo held by another transition", () => {
  it("suspends and entangles instead of serving undefined and stranding the reader", async () => {
    const [a, setA] = createSignal(0);
    const [b, setB] = createSignal(0);
    const gates: Record<string, ReturnType<typeof deferred<void>>> = {};
    const cache: Record<string, () => string> = {};
    const get = (k: string) =>
      (cache[k] ??= createMemo(async () => {
        await (gates[k] ??= deferred<void>()).promise;
        return k;
      }));

    const outA: unknown[] = [];
    const outB: unknown[] = [];
    const outC: unknown[] = [];
    createRoot(() => {
      createLoadingBoundary(
        () => {
          createRenderEffect(
            () => get("foo" + a())(),
            v => void outA.push(v)
          );
          createRenderEffect(
            () => get("foo" + b())(),
            v => void outB.push(v)
          );
          createRenderEffect(
            () => get("bar" + b())(),
            v => void outC.push(v)
          );
        },
        () => "fallback"
      );
    });
    flush();
    gates.foo0.resolve();
    gates.bar0.resolve();
    await settle();
    expect([outA, outB, outC]).toEqual([["foo0"], ["foo0"], ["bar0"]]);

    // T1: effA moves onto the in-flight foo1 memo.
    setA(1);
    flush();
    // T2: effC moves onto bar1; effB moves onto foo1 — uninitialized, held by T1.
    setB(1);
    flush();
    // No "settled undefined" leaks out of the hold.
    expect([outA, outB, outC]).toEqual([["foo0"], ["foo0"], ["bar0"]]);

    // foo1 lands while bar1 still holds: effB is entangled, nothing reveals yet.
    gates.foo1.resolve();
    await settle();
    expect([outA, outB, outC]).toEqual([["foo0"], ["foo0"], ["bar0"]]);

    gates.bar1.resolve();
    await settle();
    expect(outA).toEqual(["foo0", "foo1"]);
    expect(outB).toEqual(["foo0", "foo1"]);
    expect(outC).toEqual(["bar0", "bar1"]);
  });

  it("still shows the committed value (no entanglement) when the held memo is initialized", async () => {
    // Control: the reader's new dependency already has a committed value, so
    // the stale-read rule applies and the transitions stay independent.
    const [a, setA] = createSignal(0);
    const [pick, setPick] = createSignal(0);
    const gate = deferred<void>();
    let resolveNow = true;
    const shared = createMemo(async () => {
      const v = a();
      if (!resolveNow) await gate.promise;
      return "v" + v;
    });
    const other = createMemo(() => "other");

    const out: unknown[] = [];
    createRoot(() => {
      createLoadingBoundary(
        () =>
          createRenderEffect(
            () => (pick() ? shared() : other()),
            v => void out.push(v)
          ),
        () => "fallback"
      );
    });
    flush();
    expect(out).toEqual(["other"]);
    // Initialize `shared` by reading it once through a reader.
    createRoot(() =>
      createRenderEffect(
        () => shared(),
        () => {}
      )
    );
    await settle();

    resolveNow = false;
    setA(1); // T1: shared goes pending (in flight) holding "v0".
    flush();
    setPick(1); // T2: reader switches onto shared — shows committed "v0", no suspend.
    flush();
    expect(out).toEqual(["other", "v0"]);

    gate.resolve();
    await settle();
    expect(out).toEqual(["other", "v0", "v1"]);
  });
});
