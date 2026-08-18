/**
 * #3009: `latest()` is not pure when the memo itself uses `latest()`.
 *
 * A memo whose compute reads `latest(count)` subscribes to count's shadow
 * companion, so a plain `setCount()` wakes it through the optimistic channel
 * (the companion's wake-only lane) and marks it OPTIMISTIC_DIRTY. A subsequent
 * `latest(m)` pull then recomputed `m` under lane posture, which direct-commits
 * `_value` — leaking the queued plain write into committed reads before the
 * flush: `m()` returned the latest value instead of the committed one.
 *
 * The fix demotes wake-only-lane recomputes pulled outside the flush to plain
 * staged recomputes, so `latest()` stays a pure probe.
 */
import { createEffect, createMemo, createRoot, createSignal, flush, latest } from "../src/index.js";
import { isPending } from "../src/index.js";

it("latest(m) does not change what plain m() returns before the flush (#3009)", () => {
  let m!: () => number;
  let setCount!: (v: number) => void;
  createRoot(() => {
    const [count, set] = createSignal(0);
    setCount = set;
    m = createMemo(() => latest(count) * 2);
  });
  flush();

  setCount(4);
  expect(m()).toBe(0); // A
  expect(latest(m)).toBe(8); // B
  expect(m()).toBe(0); // C — was 8 before the fix
  expect(latest(m)).toBe(8); // probe repeats stay consistent
  expect(m()).toBe(0);
});

it("the demoted recompute still commits at flush and notifies effects (#3009)", () => {
  let m!: () => number;
  let setCount!: (v: number) => void;
  const effectLog: number[] = [];
  createRoot(() => {
    const [count, set] = createSignal(0);
    setCount = set;
    m = createMemo(() => latest(count) * 2);
    createEffect(m, v => void effectLog.push(v));
  });
  flush();
  expect(effectLog).toEqual([0]);

  setCount(4);
  expect(latest(m)).toBe(8);
  flush();
  expect(m()).toBe(8);
  expect(latest(m)).toBe(8);
  expect(effectLog).toEqual([0, 8]);

  // Later writes keep flowing normally after the demoted pull.
  setCount(10);
  flush();
  expect(m()).toBe(20);
  expect(effectLog).toEqual([0, 8, 20]);
});

it("chained memos over latest() stay pure through the pull (#3009)", () => {
  let m!: () => number;
  let m2!: () => number;
  let setCount!: (v: number) => void;
  createRoot(() => {
    const [count, set] = createSignal(1);
    setCount = set;
    m = createMemo(() => latest(count) * 2);
    m2 = createMemo(() => m() + 1);
  });
  flush();
  expect(m2()).toBe(3);

  setCount(5);
  // Pulling through the chain must not commit any intermediate node.
  expect(latest(m2)).toBe(11);
  expect(m()).toBe(2);
  expect(m2()).toBe(3);

  flush();
  expect(m()).toBe(10);
  expect(m2()).toBe(11);
});

it("an isPending probe on the same shape does not pollute committed reads (#3009)", () => {
  let m!: () => number;
  let setCount!: (v: number) => void;
  createRoot(() => {
    const [count, set] = createSignal(0);
    setCount = set;
    m = createMemo(() => latest(count) * 2);
  });
  flush();

  setCount(4);
  isPending(m);
  expect(m()).toBe(0);
  flush();
  expect(m()).toBe(8);
});
