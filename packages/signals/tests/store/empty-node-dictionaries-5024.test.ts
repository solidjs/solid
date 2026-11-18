import { expect, test } from "vitest";
import { createEffect, createRoot, createStore, flush } from "../../src/index.js";
import { storeLookup } from "../../src/store/target.js";

test("#5024: disposing the last property observer releases its node dictionary", () => {
  const raw = { x: 1 };
  const [store] = createStore(raw);
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    createEffect(
      () => store.x,
      () => {}
    );
  });
  flush();

  const target = storeLookup.get(raw)!;
  expect(target.n).not.toBeNull();
  dispose();
  flush();

  expect(target.nc).toBe(0);
  expect(target.n).toBeNull();
});
