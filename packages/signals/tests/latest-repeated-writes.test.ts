/**
 * #2922 (superseded): `latest()` only works once on memos.
 *
 * The original ruling had `latest(m)` pull the memo current against each
 * unflushed write (`setS(1); latest(m) === 3`). That answer was per-node — a
 * signal read new, a sync derivation read new, an async derivation read old —
 * and depended on whether a companion already existed. Writes now become
 * visible at flush for every read channel: `latest()` reads the flushed
 * world, so nothing derives from a write before its flush, and after the
 * flush every latest() read — signal, memo, chained memo — agrees. Read your
 * own write by flushing first (`flush()` then `latest(m)`), which works the
 * same whether or not the write is held. See latest-held-till-flush.test.ts.
 *
 * What this file still pins from #2922: the shadow does not STALL. Once a
 * write flushes, `latest(m)` reflects it, for every write, whether or not an
 * effect keeps the shadow subscribed between them.
 */
import { createEffect, createMemo, createRoot, createSignal, flush, latest } from "../src/index.js";

it("latest(memo) reflects every flushed write, none of the unflushed ones", () => {
  const [s, setS] = createSignal(0);
  let m!: () => number;
  createRoot(() => {
    m = createMemo(() => s() * 2 + 1);
  });
  flush();

  expect(m()).toBe(1);

  setS(1);
  expect(m()).toBe(1);
  expect(latest(m)).toBe(1); // unflushed: not derived (was 3)
  flush();
  expect(latest(m)).toBe(3);
  expect(m()).toBe(3);

  setS(2);
  expect(latest(m)).toBe(3);
  flush();
  expect(latest(m)).toBe(5);

  setS(3);
  expect(latest(m)).toBe(5);
  flush();
  expect(latest(m)).toBe(7);
  expect(m()).toBe(7);
});

it("latest(memo) stays fresh across flushed writes when an effect keeps the shadow subscribed", () => {
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
  expect(latest(m)).toBe(1);
  flush();
  expect(latest(m)).toBe(3);
  setS(2);
  expect(latest(m)).toBe(3);
  flush();
  expect(latest(m)).toBe(5);

  expect(m()).toBe(5);
  expect(effectLog).toEqual([1, 3, 5]);
});

it("latest(signal) reflects each write once flushed", () => {
  const [s, setS] = createSignal(0);
  flush();

  setS(1);
  expect(latest(s)).toBe(0);
  flush();
  expect(latest(s)).toBe(1);
  setS(2);
  expect(latest(s)).toBe(1);
  flush();
  expect(latest(s)).toBe(2);
  expect(s()).toBe(2);
});

it("two unflushed writes in one tick: latest() skips the intermediate, the flush lands the last", () => {
  const [s, setS] = createSignal(0);
  let m!: () => number;
  createRoot(() => {
    m = createMemo(() => s() * 2 + 1);
  });
  flush();

  setS(1);
  setS(2);
  expect(latest(s)).toBe(0);
  expect(latest(m)).toBe(1);
  flush();
  expect(latest(s)).toBe(2);
  expect(latest(m)).toBe(5);
});
