/**
 * What a cleanup may write goes by the phase it belongs to, not by where the
 * engine runs it. An `onCleanup` belongs to the computation that registered
 * it, so a setter in it is an owned write, the same under a list pass removing
 * a row and a branch memo switching away (#4165 reported the two disagreeing).
 * The teardown itself is whole, and `ownedWrite` is the declared way out. An
 * effect's returned cleanup belongs to the effect and writes freely. The
 * cleanup still runs under its owner, so `getOwner` and context lookups work.
 *
 * @see https://github.com/solidjs/solid/issues/4165
 */
import { expect, it } from "vitest";
import {
  createContext,
  createEffect,
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

it("a removed row's onCleanup that writes a signal is an owned write", () => {
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
  expect(() => flush()).toThrow(/REACTIVE_WRITE_IN_OWNED_SCOPE/);
  setRows([2, 3]);
  flush();
  // The row is gone and the list still updates.
  expect(seen).toEqual([[1, 2], [2], [2, 3]]);
  expect(count()).toBe(0);
});

for (const [label, register, options] of [
  [
    "effect-returned cleanup",
    (fn: () => void) =>
      createEffect(
        () => 1,
        () => fn
      ),
    undefined
  ],
  ["onCleanup, to an `ownedWrite` signal", (fn: () => void) => onCleanup(fn), { ownedWrite: true }]
] as const)
  it(`a removed row's ${label} can write a signal`, () => {
    const [rows, setRows] = createSignal([1, 2]);
    const [count, setCount] = createSignal(0, options);
    createRoot(() => {
      const mapped = mapArray(rows, r => {
        register(() => setCount(n => n + 1));
        return r;
      });
      createRenderEffect(mapped, () => {});
    });
    flush();
    setRows([2]);
    flush();
    expect(count()).toBe(1);
  });

it("a branch's onCleanup that writes a signal is an owned write too", () => {
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
  expect(() => flush()).toThrow(/REACTIVE_WRITE_IN_OWNED_SCOPE/);
  expect(count()).toBe(0);
});

it("a removed row's onCleanup that writes a store is an owned write", () => {
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
  expect(() => flush()).toThrow(/REACTIVE_WRITE_IN_OWNED_SCOPE/);
  expect(state.removed).toEqual([]);
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
