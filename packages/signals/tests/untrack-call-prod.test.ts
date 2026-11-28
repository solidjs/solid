// The fast path only exists in production, so this runs against the prod dist.
import { createMemo, createRoot, createSignal, flush, untrackCall } from "../dist/prod/index.js";

it("does not subscribe a tracking scope to reads inside the call", () => {
  let runs = 0;
  const [read, write] = createSignal(1);
  const [other, writeOther] = createSignal(10);
  const memo = createRoot(() =>
    createMemo(() => {
      runs++;
      return untrackCall((n: number) => read() + n, 1) + other();
    })
  );
  expect(memo()).toBe(12);
  write(2);
  flush();
  expect(memo()).toBe(12);
  expect(runs).toBe(1);
  writeOther(20);
  flush();
  expect(memo()).toBe(23);
  expect(runs).toBe(2);
});

it("passes the argument and returns the result outside a tracking scope", () => {
  const [read, write] = createSignal(1);
  const memo = createRoot(() =>
    untrackCall((offset: number) => createMemo(() => read() + offset), 5)
  );
  expect(memo()).toBe(6);
  write(2);
  flush();
  expect(memo()).toBe(7);
});

it("leaves tracking intact after the call throws", () => {
  let runs = 0;
  const [read, write] = createSignal(1);
  const memo = createRoot(() =>
    createMemo(() => {
      runs++;
      try {
        untrackCall(() => {
          throw new Error("boom");
        }, undefined);
      } catch {}
      return read();
    })
  );
  expect(memo()).toBe(1);
  write(2);
  flush();
  expect(memo()).toBe(2);
  expect(runs).toBe(2);
});

it("calls the function without a receiver on both paths", () => {
  function receiver(this: unknown) {
    return this;
  }
  const tracked = createRoot(() => createMemo(() => untrackCall(receiver, 0)));
  expect(tracked()).toBe(undefined);
  expect(untrackCall(receiver, 0)).toBe(undefined);
});
