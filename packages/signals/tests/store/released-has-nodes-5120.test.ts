// #5120: releasing a target's presence nodes is O(1) per node. A tracked
// array method makes one presence node per index, so a per-release key scan
// made disposing its reader quadratic in the array's length.
import { test, expect, vi } from "vitest";
import { createEffect, createRoot, createStore, flush } from "../../src/index.js";
import { $TARGET } from "../../src/store/store.js";

test("#5120 disposing a reader of a tracked array iteration scans no keys per release", () => {
  const N = 2000;
  const [store] = createStore(Array.from({ length: N }, (_, i) => ({ id: i })));
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    createEffect(
      () => store.some(r => r.id < 0),
      () => {}
    );
  });
  flush();
  const t = (store as any)[$TARGET];
  expect(t.h).not.toBe(null);
  expect(Object.keys(t.h).length).toBeGreaterThanOrEqual(N);

  const has = t.h;
  const ownKeys = vi.spyOn(Reflect, "ownKeys");
  try {
    dispose();
    flush();
    const scansOfHas = ownKeys.mock.calls.filter(([o]) => o === has).length;
    expect(scansOfHas).toBe(0);
  } finally {
    ownKeys.mockRestore();
  }
  expect(t.h).toBe(null);
});

test("#5120 a target keeps its presence dictionary until its last presence node is released", () => {
  const [store] = createStore<Record<string, number>>({ a: 1, b: 2 });
  let disposeA!: () => void;
  let disposeB!: () => void;
  createRoot(d => {
    disposeA = d;
    createEffect(
      () => "a" in store,
      () => {}
    );
  });
  createRoot(d => {
    disposeB = d;
    createEffect(
      () => "b" in store,
      () => {}
    );
  });
  flush();
  const t = (store as any)[$TARGET];
  disposeA();
  flush();
  expect(t.h).not.toBe(null);
  expect("b" in t.h).toBe(true);
  disposeB();
  flush();
  expect(t.h).toBe(null);

  const seen: boolean[] = [];
  createRoot(() =>
    createEffect(
      () => "a" in store,
      v => void seen.push(v)
    )
  );
  flush();
  expect(seen).toEqual([true]);
});
