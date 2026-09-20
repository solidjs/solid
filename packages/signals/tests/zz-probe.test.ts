import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  untrack
} from "../src/index.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const Loading = <T>(fn: () => T, fallback: string) =>
  untrack(() => createLoadingBoundary(fn, () => fallback));
function show(accessor: () => unknown, cell: { value: unknown }) {
  createRenderEffect(accessor, v => {
    cell.value = v;
  });
}

test("probe: fresh boundary mounted in the same tick as the write that B holds", async () => {
  const [count, setCount] = createSignal(1);
  const [mount, setMount] = createSignal(false);
  const cells = {
    count: { value: undefined as unknown },
    B: { value: undefined as unknown },
    A: { value: undefined as unknown }
  };
  let data!: () => number;
  createRoot(() => {
    data = createMemo(async () => {
      const v = count();
      await sleep(1000);
      return v;
    });
    show(count, cells.count);
    show(
      Loading(() => data(), "Loading B"),
      cells.B
    );
    const gate = createMemo(() => (mount() ? Loading(() => data(), "Loading A") : () => "off"));
    show(() => gate()(), cells.A);
  });
  flush();
  await vi.advanceTimersByTimeAsync(1000);
  flush();
  expect([cells.count.value, cells.B.value, cells.A.value]).toEqual([1, 1, "off"]);
  setCount(2);
  setMount(true);
  flush();
  await Promise.resolve();
  flush();
  console.log("PROBE same-tick mount:", [cells.count.value, cells.B.value, cells.A.value]);
  await vi.advanceTimersByTimeAsync(1000);
  flush();
  console.log("PROBE after landing:", [cells.count.value, cells.B.value, cells.A.value]);
});
