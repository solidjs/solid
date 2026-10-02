// Transaction entanglement through an optimistic write (L2: `merge`). (The
// `next`-era pin on `_optimisticNodes` deduplication across
// `mergeTransitionState` was dropped with that representation.)

import { expect, it } from "vitest";
import {
  action,
  createRenderEffect,
  createSignal,
  createOptimistic,
  createRoot,
  flush
} from "../src/index.js";

it("runs parked render effects after their transition merges into another action", async () => {
  const rendered: number[] = [];
  let setValue!: (value: number) => void;
  let setOptimistic!: (value: number) => void;
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    const [value, write] = createSignal(0);
    setValue = write;
    [, setOptimistic] = createOptimistic(0);
    createRenderEffect(value, next => {
      rendered.push(next);
    });
  });
  flush();

  const firstGate = Promise.withResolvers<void>();
  const secondGate = Promise.withResolvers<void>();
  const first = action(function* () {
    setValue(1);
    yield firstGate.promise;
    setOptimistic(2); // Merge into the action that owns this optimistic write.
  });
  const second = action(function* () {
    setOptimistic(1);
    yield secondGate.promise;
  });
  const firstDone = first();
  flush();
  const secondDone = second();
  flush();
  firstGate.resolve();
  await firstDone;
  flush();
  expect.soft(rendered).toEqual([0]);

  secondGate.resolve();
  await secondDone;
  flush();
  expect.soft(rendered).toEqual([0, 1]);
  dispose();
  flush();
});
