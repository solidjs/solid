/**
 * #4165 let a cleanup write during teardown: a cleanup is teardown, not part
 * of whichever computation is disposing its owner. Invoking an action from a
 * cleanup is the same imperative act, so the action guard stands down there
 * too. Without it, removing a keyed row whose cleanup calls an action threw
 * ACTION_CALLED_IN_OWNED_SCOPE in development, while the same cleanup under a
 * branch switching away ran.
 */
import { afterEach, expect, it } from "vitest";
import {
  action,
  createEffect,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  mapArray,
  onCleanup,
  untrack
} from "../src/index.js";

afterEach(() => flush());

it("a removed row's onCleanup can call an action", async () => {
  const [rows, setRows] = createSignal([1, 2]);
  const [count, setCount] = createSignal(0);
  const release = action(function* () {
    setCount(n => n + 1);
  });
  const seen: unknown[] = [];
  createRoot(() => {
    const mapped = mapArray(rows, r => {
      onCleanup(() => void release());
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
  await Promise.resolve();
  flush();
  setRows([2, 3]);
  flush();
  expect(seen).toEqual([[1, 2], [2], [2, 3]]);
  expect(count()).toBe(1);
});

it("a removed row's effect-returned cleanup can call an action", async () => {
  const [rows, setRows] = createSignal([1, 2]);
  const [count, setCount] = createSignal(0);
  const release = action(function* () {
    setCount(n => n + 1);
  });
  createRoot(() => {
    const mapped = mapArray(rows, r => {
      createEffect(
        () => r,
        () => () => void release()
      );
      return r;
    });
    createRenderEffect(mapped, () => {});
  });
  flush();
  setRows([2]);
  flush();
  await Promise.resolve();
  flush();
  expect(count()).toBe(1);
});

it("a branch's cleanup can call an action when the branch switches away", async () => {
  const [on, setOn] = createSignal(true);
  const [count, setCount] = createSignal(0);
  const release = action(function* () {
    setCount(n => n + 1);
  });
  createRoot(() => {
    const branch = createMemo(() => {
      if (!on()) return null;
      return untrack(() => {
        onCleanup(() => void release());
        return 1;
      });
    });
    createRenderEffect(branch, () => {});
  });
  flush();
  setOn(false);
  flush();
  await Promise.resolve();
  flush();
  expect(count()).toBe(1);
});

it("still rejects an action called in a row's mapping body", () => {
  const [rows] = createSignal([1]);
  const noop = action(function* () {});
  let caught: unknown;
  createRoot(() => {
    const mapped = mapArray(rows, r => {
      try {
        noop();
      } catch (e) {
        caught = e;
      }
      return r;
    });
    createRenderEffect(mapped, () => {});
  });
  flush();
  expect(String(caught)).toMatch(/ACTION_CALLED_IN_OWNED_SCOPE/);
});
