/**
 * A cleanup is teardown, so a setter in it is not a write in the owned scope
 * of whichever computation is tearing the owner down: a list pass removing a
 * row, or a branch memo switching away (#4165). The cleanup still runs under
 * its owner, so `getOwner` and context lookups keep working.
 *
 * @see https://github.com/solidjs/solid/issues/4165
 */
import { expect, it } from "vitest";
import {
  createContext,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  getContext,
  getOwner,
  mapArray,
  onCleanup,
  setContext,
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

it("a removed row's cleanup can write a store", () => {
  const [rows, setRows] = createSignal([1, 2]);
  const [state, setState] = createStore({ removed: [] as number[] });
  createRoot(() => {
    const mapped = mapArray(rows, r => {
      onCleanup(() => setState(s => void s.removed.push(r)));
      return r;
    });
    createRenderEffect(mapped, () => {});
  });
  flush();
  setRows([2]);
  flush();
  expect(state.removed).toEqual([1]);
});

it("a removed row's cleanup still sees its owner and context", () => {
  const Ctx = createContext("default");
  const [rows, setRows] = createSignal([1, 2]);
  const seen: unknown[] = [];
  createRoot(() => {
    setContext(Ctx, "provided");
    const mapped = mapArray(rows, r => {
      onCleanup(() => seen.push([r, !!getOwner(), getContext(Ctx)]));
      return r;
    });
    createRenderEffect(mapped, () => {});
  });
  flush();
  setRows([2]);
  flush();
  expect(seen).toEqual([[1, true, "provided"]]);
});
