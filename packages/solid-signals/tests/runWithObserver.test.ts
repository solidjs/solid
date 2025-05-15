import {
  createEffect,
  createRoot,
  createSignal,
  flushSync,
  getObserver,
  runWithObserver,
  type Computation
} from "../src/index.js";

it("should return value", () => {
  let observer!: Computation | null;

  createRoot(() => {
    createEffect(
      () => {
        observer = getObserver()!;
      },
      () => {}
    );
  });
  expect(runWithObserver(observer!, () => 100)).toBe(100);
});

it("should add dependencies to no deps", () => {
  let count = 0;

  const [a, setA] = createSignal(0);
  createRoot(() => {
    createEffect(
      () => getObserver()!,
      o => {
        runWithObserver(o, () => {
          a();
          count++;
        });
      }
    );
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
  createRoot(() => {
    createEffect(
      () => (a(), getObserver()!),
      o => {
        runWithObserver(o, () => {
          b();
          count++;
        });
      }
    );
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
