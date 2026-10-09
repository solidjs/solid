/**
 * #3895: awaiting refresh() of an optimistic accessor inside the action that
 * wrote the override delivers the source's re-ask, not the caller's guess.
 *
 * refresh-await.test.ts pins the sibling case: refresh the UNDERLYING memo
 * while a separate optimistic reads it, and the promise delivers the staged
 * landing. Here the refreshed target IS the optimistic accessor.
 */
import { expect, test } from "vitest";
import { action, createOptimistic, createRoot, flush, refresh, resolve } from "../src/index.js";

function gate<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("awaited refresh of an optimistic accessor returns the source, not the caller override (#3895)", async () => {
  let dispose!: () => void;
  let value!: () => number;
  let setValue!: (v: number) => void;
  createRoot(d => {
    dispose = d;
    const [v, set] = createOptimistic(() => Promise.resolve(2) as unknown as number);
    value = v;
    setValue = set;
  });
  flush();
  await resolve(value);
  expect(value()).toBe(2);

  const save = action(function* () {
    setValue(99); // the caller's optimistic guess, not server truth
    return yield refresh(value);
  });
  await expect(save()).resolves.toBe(2);
  flush();
  expect(value()).toBe(2);
  dispose();
});

test("awaited refresh of an optimistic accessor delivers the re-ask, not the pre-refresh commit", async () => {
  const loads: ReturnType<typeof gate<number>>[] = [];
  let dispose!: () => void;
  let value!: () => number;
  let setValue!: (v: number) => void;
  createRoot(d => {
    dispose = d;
    const [v, set] = createOptimistic(() => {
      const g = gate<number>();
      loads.push(g);
      return g.promise as unknown as number;
    });
    value = v;
    setValue = set;
  });
  flush();
  loads[0].resolve(2);
  await resolve(value);
  expect(value()).toBe(2);

  const save = action(function* () {
    setValue(99);
    return yield refresh(value);
  });
  const done = save();
  await Promise.resolve();
  flush();
  expect(loads).toHaveLength(2);
  // Still in flight: the override is what the screen shows, and the promise
  // has not settled on it.
  expect(value()).toBe(99);
  loads[1].resolve(5);
  await expect(done).resolves.toBe(5);
  flush();
  expect(value()).toBe(5);
  dispose();
});

test("awaited refresh settles when the re-ask confirms the override", async () => {
  const loads: ReturnType<typeof gate<number>>[] = [];
  let dispose!: () => void;
  let value!: () => number;
  let setValue!: (v: number) => void;
  createRoot(d => {
    dispose = d;
    const [v, set] = createOptimistic(() => {
      const g = gate<number>();
      loads.push(g);
      return g.promise as unknown as number;
    });
    value = v;
    setValue = set;
  });
  flush();
  loads[0].resolve(2);
  await resolve(value);

  const save = action(function* () {
    setValue(5);
    return yield refresh(value);
  });
  const done = save();
  await Promise.resolve();
  flush();
  loads[1].resolve(5);
  await expect(done).resolves.toBe(5);
  flush();
  expect(value()).toBe(5);
  dispose();
});

test("awaited refresh of an optimistic accessor rejects when the re-ask fails", async () => {
  const loads: ReturnType<typeof gate<number>>[] = [];
  let dispose!: () => void;
  let value!: () => number;
  let setValue!: (v: number) => void;
  createRoot(d => {
    dispose = d;
    const [v, set] = createOptimistic(() => {
      const g = gate<number>();
      loads.push(g);
      return g.promise as unknown as number;
    });
    value = v;
    setValue = set;
  });
  flush();
  loads[0].resolve(2);
  await resolve(value);

  const save = action(function* () {
    setValue(99);
    return yield refresh(value);
  });
  const done = save();
  await Promise.resolve();
  flush();
  loads[1].reject(new Error("refetch failed"));
  await expect(done).rejects.toThrow("refetch failed");
  dispose();
});
