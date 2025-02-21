import {
  createEffect,
  runWithObserver,
  getObserver,
  type Computation,
  createMemo,
  createSignal,
  flushSync
} from "../src/index.js";

it("should return value", () => {
  let observer!: Computation | null;

  createEffect(() => {
    observer = getObserver()!;
  }, () => {});
  expect(runWithObserver(observer!, () => 100)).toBe(100);
});

it("should add dependencies to no deps", () => {
  let count = 0;

  const [a, setA] = createSignal(0);
  createEffect(() => getObserver()!, (o) => {
    runWithObserver(o, () => {
      a();
      count++;
    })
  });
  expect(count).toBe(0);
  flushSync();
  expect(count).toBe(1);
  setA(1);
  flushSync();
  expect(count).toBe(2);
});

it("should add dependencies to existing deps", () => {
  let count = 0;

  const [a, setA] = createSignal(0);
  const [b, setB] = createSignal(0);
  createEffect(() => (a(), getObserver()!), (o) => {
    runWithObserver(o, () => {
      b();
      count++;
    })
  });
  expect(count).toBe(0);
  flushSync();
  expect(count).toBe(1);
  setB(1);
  flushSync();
  expect(count).toBe(2);
  setA(1);
  flushSync();
  expect(count).toBe(3);
});