/**
 * Invoking an action is a write for the owned-scope guard, and the guard goes
 * by the phase a cleanup belongs to (#4165, #5123). An effect's returned
 * cleanup belongs to the effect, so it can call an action when its row is
 * removed. An `onCleanup` belongs to its computation: calling an action from
 * it is ACTION_CALLED_IN_OWNED_SCOPE, under a removed row and under a branch
 * switching away alike.
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

it("a removed row's onCleanup that calls an action is an owned call", async () => {
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
  expect(() => flush()).toThrow(/ACTION_CALLED_IN_OWNED_SCOPE/);
  await Promise.resolve();
  flush();
  setRows([2, 3]);
  flush();
  // The row is gone and the list still updates.
  expect(seen).toEqual([[1, 2], [2], [2, 3]]);
  expect(count()).toBe(0);
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

it("a branch's onCleanup that calls an action is an owned call too", async () => {
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
  expect(() => flush()).toThrow(/ACTION_CALLED_IN_OWNED_SCOPE/);
  await Promise.resolve();
  flush();
  expect(count()).toBe(0);
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
