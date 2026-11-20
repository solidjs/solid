import { expect, it } from "vitest";
import { createEffect, createRoot, createStore, flush } from "../../src/index.js";

// #5120: disposing an observer of a tracked array iteration is O(K^2) in the
// array's length. A tracked `filter` asks HasProperty per index, so one pass
// makes K presence nodes on the array's target; releasing them calls
// `Reflect.ownKeys` on the presence dictionary once per node while it shrinks
// by one key each time. Counted at the primitive (key copies, not a
// stopwatch): the value-node branch next to it keeps a counter (#5024).
it("#5120: releasing K presence nodes copies O(K) keys, not O(K^2)", () => {
  const K = 2000;
  const [store] = createStore(Array.from({ length: K }, (_, i) => ({ id: i, on: i % 2 === 0 })));
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    createEffect(
      () => store.filter(x => x.on).length,
      () => {}
    );
  });
  flush();

  const ownKeys = Reflect.ownKeys;
  let keyCopies = 0;
  let calls = 0;
  (Reflect as any).ownKeys = function (target: object) {
    const keys = ownKeys.call(Reflect, target);
    calls++;
    keyCopies += keys.length;
    return keys;
  };
  try {
    dispose();
    flush();
  } finally {
    (Reflect as any).ownKeys = ownKeys;
  }

  // Linear release copies ~K keys; the quadratic path copies ~K^2/2.
  expect(keyCopies).toBeLessThan(4 * K);
});
