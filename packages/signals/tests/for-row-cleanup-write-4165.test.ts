/**
 * A cleanup runs with no owner, so a setter in it is not a write in the
 * owned scope of whichever computation is tearing the owner down: a list pass
 * removing a row, or a branch memo switching away (#4165).
 *
 * @see https://github.com/solidjs/solid/issues/4165
 */
import { expect, it } from "vitest";
import {
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  mapArray,
  onCleanup,
  untrack
} from "../src/index.js";

it("a removed row's cleanup can write a signal", () => {
  const [rows, setRows] = createSignal([1, 2]);
  const [count, setCount] = createSignal(0);
  const seen: unknown[] = [];
  createRoot(() => {
    const mapped = mapArray(rows, r => {
      onCleanup(() => setCount(n => n + 1));
      return r;
    });
    createRenderEffect(
      () => mapped(),
      v => void seen.push([...v])
    );
  });
  flush();
  setRows([2]);
  flush();
  setRows([2, 3]);
  flush();
  expect(seen).toEqual([[1, 2], [2], [2, 3]]);
  expect(count()).toBe(1);
});

it("a branch's cleanup can write a signal when the branch switches away", () => {
  const [on, setOn] = createSignal(true);
  const [count, setCount] = createSignal(0);
  createRoot(() => {
    const branch = createMemo(() => {
      if (!on()) return null;
      return untrack(() => {
        onCleanup(() => setCount(n => n + 1));
        return 1;
      });
    });
    createRenderEffect(branch, () => {});
  });
  flush();
  setOn(false);
  flush();
  expect(count()).toBe(1);
});
