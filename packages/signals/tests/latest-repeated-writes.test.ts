/**
 * #2922: `latest()` only works once on memos.
 *
 * Interleaving plain signal writes with `latest(m)` reads (no flush in
 * between): the first `latest(m)` correctly computes the in-flight value, but
 * after a second write the shadow computed returned its cached speculative
 * value instead of recomputing against the newest pending write.
 */
import { createEffect, createMemo, createRoot, createSignal, flush, latest } from "../src/index.js";

it("latest(memo) recomputes after each unflushed write, not just the first (#2922)", () => {
  const [s, setS] = createSignal(0);
  let m!: () => number;
  createRoot(() => {
    m = createMemo(() => s() * 2 + 1);
  });
  flush();

  expect(m()).toBe(1);

  setS(1);
  expect(m()).toBe(1);
  expect(latest(m)).toBe(3);
  expect(m()).toBe(1);

  setS(2);
  expect(m()).toBe(1);
  expect(latest(m)).toBe(5);

  setS(3);
  expect(latest(m)).toBe(7);

  flush();
  expect(m()).toBe(7);
});

it("latest(memo) stays fresh across writes when an effect keeps the shadow subscribed (#2922)", () => {
  const [s, setS] = createSignal(0);
  let m!: () => number;
  const effectLog: number[] = [];
  createRoot(() => {
    m = createMemo(() => s() * 2 + 1);
    createEffect(
      () => latest(m),
      v => {
        effectLog.push(v);
      }
    );
  });
  flush();
  expect(effectLog).toEqual([1]);

  setS(1);
  expect(latest(m)).toBe(3);
  setS(2);
  expect(latest(m)).toBe(5);

  flush();
  expect(m()).toBe(5);
});

it("latest(signal) tracks each unflushed write (#2922)", () => {
  const [s, setS] = createSignal(0);
  flush();

  setS(1);
  expect(latest(s)).toBe(1);
  setS(2);
  expect(latest(s)).toBe(2);

  flush();
  expect(s()).toBe(2);
});
