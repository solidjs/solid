// #5024: a target whose last node is released drops its emptied node
// dictionaries, so a store the app still holds keeps no per-target residue
// after its readers are disposed.
import { test, expect } from "vitest";
import { createEffect, createRoot, createStore, flush } from "../../src/index.js";
import { $TARGET } from "../../src/store/store.js";

test("#5024 releasing the last node of a target drops its dictionaries", () => {
  const [store] = createStore([
    { id: "a", x: 1 },
    { id: "b", x: 2 }
  ]);
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    createEffect(
      () => store.map(r => r.x + ("id" in r ? 1 : 0)),
      () => {}
    );
  });
  flush();
  const row = (store[0] as any)[$TARGET];
  expect(row.n).not.toBe(null);
  expect(row.h).not.toBe(null);
  dispose();
  flush();
  expect(row.nc).toBe(0);
  expect(row.n).toBe(null);
  expect(row.h).toBe(null);
  expect((store as any)[$TARGET].n).toBe(null);

  // a later reader makes fresh nodes and still sees writes
  const seen: number[] = [];
  createRoot(() =>
    createEffect(
      () => store[0].x,
      v => void seen.push(v)
    )
  );
  flush();
  expect(seen).toEqual([1]);
});
