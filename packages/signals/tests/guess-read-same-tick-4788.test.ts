// #4788 review: a read by one action does not entangle another action's write
// made in the same tick (reads are the running action step's, D-33).
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
