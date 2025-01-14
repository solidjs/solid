import {
  createAsync,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  flushSync,
  isPending,
  latest
} from "../src/index.js";

it("diamond should not cause waterfalls on read", async () => {
  //
  //     s
  //    / \
  //   /   \
  //  b     c
  //   \   /
  //    \ /
  //     e
  //
  const [s, set] = createSignal(1);
  const effect = vi.fn();
  const async1 = vi.fn(() => Promise.resolve(s()));
  const async2 = vi.fn(() => Promise.resolve(s()));

  createRoot(() => {
    const b = createAsync(async1);
    const c = createAsync(async2);
    createEffect(
      () => [b(), c()],
      v => effect(...v)
    );
  });

  expect(async1).toHaveBeenCalledTimes(1);
  expect(async2).toHaveBeenCalledTimes(1);
  expect(effect).toHaveBeenCalledTimes(0);
  await new Promise(r => setTimeout(r, 0));
  expect(async1).toHaveBeenCalledTimes(1);
  expect(async2).toHaveBeenCalledTimes(1);
  expect(effect).toHaveBeenCalledTimes(1);
  expect(effect).toHaveBeenCalledWith(1, 1);
  set(2);
  expect(async1).toHaveBeenCalledTimes(1);
  expect(async2).toHaveBeenCalledTimes(1);
  expect(effect).toHaveBeenCalledTimes(1);
  flushSync();
  expect(async1).toHaveBeenCalledTimes(2);
  expect(async2).toHaveBeenCalledTimes(2);
  expect(effect).toHaveBeenCalledTimes(1);
  await new Promise(r => setTimeout(r, 0));
  expect(async1).toHaveBeenCalledTimes(2);
  expect(async2).toHaveBeenCalledTimes(2);
  expect(effect).toHaveBeenCalledTimes(2);
  expect(effect).toHaveBeenCalledWith(2, 2);
});

it("should waterfall when dependent on another async with shared source", async () => {
  //
  //    s
  //   /|
  //  a |
  //   \|
  //    b
  //    |
  //    e
  //
  let a;
  const [s, set] = createSignal(1);
  const effect = vi.fn();
  const async1 = vi.fn(() => Promise.resolve(s()));
  const async2 = vi.fn(() => Promise.resolve(s() + a()));

  createRoot(() => {
    a = createAsync(async1);
    const b = createAsync(async2);

    createEffect(
      () => b(),
      v => effect(v)
    );
  });

  expect(async1).toHaveBeenCalledTimes(1);
  expect(async2).toHaveBeenCalledTimes(1);
  expect(effect).toHaveBeenCalledTimes(0);
  await new Promise(r => setTimeout(r, 0));
  expect(async1).toHaveBeenCalledTimes(1);
  expect(async2).toHaveBeenCalledTimes(2);
  expect(effect).toHaveBeenCalledTimes(1);
  expect(effect).toHaveBeenCalledWith(2);
  set(2);
  expect(async1).toHaveBeenCalledTimes(1);
  expect(async2).toHaveBeenCalledTimes(2);
  expect(effect).toHaveBeenCalledTimes(1);
  flushSync();
  expect(async1).toHaveBeenCalledTimes(2);
  expect(async2).toHaveBeenCalledTimes(3);
  expect(effect).toHaveBeenCalledTimes(1);
  await new Promise(r => setTimeout(r, 0));
  expect(async1).toHaveBeenCalledTimes(2);
  expect(async2).toHaveBeenCalledTimes(4);
  expect(effect).toHaveBeenCalledTimes(2);
  expect(effect).toHaveBeenCalledWith(4);
});

it("should not throw with isPending guard", async () => {
  const [s, set] = createSignal(1);
  const async1 = vi.fn(() => Promise.resolve(s()));
  const a = createRoot(() => createAsync(async1));
  const b = createMemo(() => (isPending(a) ? "pending" : a()));
  expect(b()).toBe("pending");
  await new Promise(r => setTimeout(r, 0));
  expect(b()).toBe(1);
  set(2);
  expect(b()).toBe("pending");
  flushSync();
  expect(b()).toBe("pending");
  await new Promise(r => setTimeout(r, 0));
  expect(b()).toBe(2);
});

it("should not throw with latest guard", async () => {
  const [s, set] = createSignal(1);
  const async1 = vi.fn(() => Promise.resolve(s()));
  const a = createRoot(() => createAsync(async1));
  const b = createMemo(() => latest(a));
  expect(b()).toBe(undefined);
  await new Promise(r => setTimeout(r, 0));
  expect(b()).toBe(1);
  set(2);
  expect(b()).toBe(1);
  flushSync();
  expect(b()).toBe(1);
  await new Promise(r => setTimeout(r, 0));
  expect(b()).toBe(2);
});
