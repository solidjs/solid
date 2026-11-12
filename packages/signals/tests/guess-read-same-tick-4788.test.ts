// #4788 review: a read is the reading action's (D-33): it does not entangle
// another action's write in the same tick, and it lasts across the reader's
// own yields.
import { expect, it } from "vitest";
import { action, createOptimistic, createRenderEffect, createRoot, flush } from "../src/index.js";
const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};
it("a read-only action in the same tick does not entangle another action's write", async () => {
  const ends: Record<string, () => void> = {};
  const wait = (k: string) => new Promise<void>(r => (ends[k] = r));
  const seen: string[] = [];
  let A!: () => any, B!: () => any, C!: () => any;
  createRoot(() => {
    const [a, setA] = createOptimistic(0);
    const [b, setB] = createOptimistic(0);
    createRenderEffect(
      () => `a=${a()} b=${b()}`,
      v => void seen.push(v)
    );
    A = action(function* () {
      setA(1);
      yield wait("A");
    });
    C = action(function* () {
      const x = a();
      yield wait("C");
    });
    B = action(function* () {
      setB(5);
      yield wait("B");
    });
  });
  flush();
  A();
  await tick();
  C();
  B();
  await tick();
  ends.A();
  await tick();
  const afterA = seen[seen.length - 1];
  ends.B();
  ends.C();
  await tick();
  expect(afterA).toBe("a=0 b=5");
});

it("a read before a yield entangles a guess written after it", async () => {
  const ends: Record<string, () => void> = {};
  const wait = (k: string) => new Promise<void>(r => (ends[k] = r));
  const seen: string[] = [];
  let A!: () => any, B!: () => any;
  createRoot(() => {
    const [a, setA] = createOptimistic(0);
    const [b, setB] = createOptimistic(0);
    createRenderEffect(
      () => `a=${a()} b=${b()}`,
      v => void seen.push(v)
    );
    A = action(function* () {
      setA(1);
      yield wait("A");
    });
    B = action(function* () {
      const x = a();
      yield Promise.resolve();
      setB(x + 1);
      yield wait("B");
    });
  });
  flush();
  A();
  await tick();
  B();
  await tick();
  ends.A();
  await tick();
  expect(seen[seen.length - 1]).toBe("a=1 b=2");
  ends.B();
  await tick();
  expect(seen[seen.length - 1]).toBe("a=0 b=0");
});
