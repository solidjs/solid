/**
 * RUL-4 parity evidence (INTERNALS-STORE-STATE.md) — signal-form counterpart
 * of optimistic-store-refetch-hold.test.ts (#2951).
 *
 * The store fix's rationale claims signal-form createOptimistic rides an
 * in-flight refetch by construction (pending async + override cohabit one
 * node, so transitionBlocked sees both). No signal-form test pinned that —
 * this file does: a bare (transaction-less) optimistic write made while the
 * signal's own truth is in flight must hold until truth lands; with settled
 * truth it keeps flash semantics (reverts at plain flush end).
 */
import { expect, test } from "vitest";
import { createEffect, createOptimistic, createRoot, createSignal, flush } from "../src/index.js";

const tick = () => new Promise(r => setTimeout(r, 0));

function setup() {
  let setCount!: (v: number) => void;
  let setOpt!: (v: string) => void;
  let dispose!: () => void;
  const resolvers: ((v: string) => void)[] = [];
  const views: string[] = [];

  createRoot(d => {
    dispose = d;
    const [count, _setCount] = createSignal(0);
    setCount = _setCount;
    const [opt, _setOpt] = createOptimistic<string>(async () => {
      count();
      return await new Promise<string>(r => resolvers.push(r));
    });
    setOpt = _setOpt;
    createEffect(
      () => opt(),
      v => {
        views.push(v);
      }
    );
  });
  return { setCount, setOpt, resolvers, views, dispose };
}

test("signal parity: a bare optimistic write during an in-flight refetch holds until truth lands", async () => {
  const { setCount, setOpt, resolvers, views, dispose } = setup();
  flush();
  await tick();
  resolvers[0]("A");
  await tick();
  flush();
  expect(views.at(-1)).toBe("A");

  // Dep write starts a (slow) refetch; the bare optimistic write in the same
  // tick must survive the flush that starts it.
  setCount(1);
  setOpt("B*");
  flush();
  await tick();
  expect(views.at(-1)).toBe("B*");

  // A later tick's bare write during the same in-flight refetch also holds.
  setOpt("C*");
  flush();
  await tick();
  expect(views.at(-1)).toBe("C*");

  // Truth lands: replaces the optimism.
  resolvers[1]("B");
  await tick();
  flush();
  await tick();
  flush();
  expect(views.at(-1)).toBe("B");
  dispose();
});

test("signal parity: with settled truth a bare optimistic write keeps flash semantics", async () => {
  const { setOpt, resolvers, views, dispose } = setup();
  flush();
  await tick();
  resolvers[0]("A");
  await tick();
  flush();
  expect(views.at(-1)).toBe("A");

  // No refetch in flight: the ambient write reverts at plain flush end.
  setOpt("X*");
  flush();
  expect(views.at(-1)).toBe("A");
  dispose();
});
