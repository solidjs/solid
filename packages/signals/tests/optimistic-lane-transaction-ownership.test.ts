// #2912: a shared subscriber merges LANES (scheduling affinity — correct: the
// shared effect needs consistent flushing), but that merge must not transfer
// TRANSACTION ownership of overrides. Ownership is stamped on the node at
// optimistic-write time (_overrideOwner, the node-level sibling of the store
// layer's STORE_OPTIMISTIC_OWNERS from #2899) and resolveTransition prefers
// it over the merged lane root's _transition. Same-key writes still entangle
// through the owner stamp; disjoint work settles independently.
import { describe, expect, it } from "vitest";
import {
  action,
  createOptimistic,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  flush
} from "../src/index.js";

function deferred<T = void>() {
  let resolve!: (v: T) => void, reject!: (e: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const microtasks = async (n = 5) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

describe("#2912: lane merge must not transfer transaction ownership", () => {
  it("repro 1: #2899 test-3 shape with B's writes swapped (disjoint first, same-key second)", async () => {
    const gA = deferred();
    const gB = deferred();

    const [s, setS] = createOptimisticStore({ a: 1, b: 2 });
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      createRenderEffect(
        () => s.a + s.b, // ONE effect reads both keys
        () => {}
      );
    });
    flush();

    const actA = action(function* () {
      setS(d => {
        d.a = 10;
      });
      yield gA.promise;
    });
    const actB = action(function* () {
      setS(d => {
        d.b = 20; // disjoint key FIRST — hijacks A's lane via the shared effect
      });
      setS(d => {
        d.a = 11; // same key as A — should merge the transactions
      });
      yield gB.promise;
    });

    const pA = actA();
    flush();
    expect([s.a, s.b]).toEqual([10, 2]);

    const pB = actB();
    flush();
    expect([s.a, s.b]).toEqual([11, 20]);

    // B settles first; A (merged via same-key a) is still in flight.
    gB.resolve();
    await microtasks();
    flush();

    // Same-key merge semantics: overrides hold until the LAST entangled action.
    expect([s.a, s.b]).toEqual([11, 20]);

    gA.resolve();
    await Promise.allSettled([pA, pB]);
    await microtasks();
    flush();
    expect([s.a, s.b]).toEqual([1, 2]); // both reverted after all actions settle
    dispose();
  });

  it("repro 2: three actions on plain createOptimistic signals", async () => {
    const gA = deferred();
    const gB = deferred();
    const gC = deferred();

    const [x, setX] = createOptimistic(1);
    const [y, setY] = createOptimistic(2);

    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      createRenderEffect(
        () => x() + y(), // shared subscriber
        () => {}
      );
    });
    flush();

    const actA = action(function* () {
      setX(10);
      yield gA.promise;
    });
    const actB = action(function* () {
      setY(20); // hijacks x's lane into B's transaction via the shared effect
      yield gB.promise;
    });
    const actC = action(function* () {
      setX(11); // same signal as A — C should entangle with A, not B
      yield gC.promise;
    });

    const pA = actA();
    flush();
    const pB = actB();
    flush();
    const pC = actC();
    flush();
    expect([x(), y()]).toEqual([11, 20]);

    // A settles; C still in flight and owns the live x override.
    gA.resolve();
    await microtasks();
    flush();
    expect(x()).toBe(11); // FAILS today: x reverts to 1 while C is in flight

    gB.resolve();
    await microtasks();
    flush();
    expect(y()).toBe(2); // B settled: y reverts
    expect(x()).toBe(11); // C still holds x

    gC.resolve();
    await Promise.allSettled([pA, pB, pC]);
    await microtasks();
    flush();
    expect([x(), y()]).toEqual([1, 2]);
    dispose();
  });
});
