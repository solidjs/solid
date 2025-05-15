import {
  createAsync,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  flushSync,
  isPending,
  latest,
  resolve
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

it("should should show stale state with `isPending`", async () => {
  const [s, set] = createSignal(1);
  const async1 = vi.fn(() => Promise.resolve(s()));
  const a = createRoot(() => createAsync(async1));
  const b = createMemo(() => (isPending(a) ? "stale" : "not stale"));
  expect(b).toThrow();
  await new Promise(r => setTimeout(r, 0));
  expect(b()).toBe("not stale");
  set(2);
  expect(b()).toBe("stale");
  flushSync();
  expect(b()).toBe("stale");
  await new Promise(r => setTimeout(r, 0));
  expect(b()).toBe("not stale");
});

it("should get latest value with `latest`", async () => {
  const [s, set] = createSignal(1);
  const async1 = vi.fn(() => Promise.resolve(s()));
  const a = createRoot(() => createAsync(async1));
  const b = createMemo(() => latest(a));
  expect(b).toThrow();
  await new Promise(r => setTimeout(r, 0));
  expect(b()).toBe(1);
  set(2);
  expect(b()).toBe(1);
  flushSync();
  expect(b()).toBe(1);
  await new Promise(r => setTimeout(r, 0));
  expect(b()).toBe(2);
});

it("should resolve to a value with resolveAsync", async () => {
  const [s, set] = createSignal(1);
  const async1 = vi.fn(() => Promise.resolve(s()));
  let value: number | undefined;
  createRoot(() => {
    const a = createAsync(async1);
    createEffect(
      () => {},
      () => {
        (async () => {
          value = await resolve(a);
        })();
      }
    );
  });
  expect(value).toBe(undefined);
  await new Promise(r => setTimeout(r, 0));
  expect(value).toBe(1);
  set(2);
  expect(value).toBe(1);
  flushSync();
  expect(value).toBe(1);
  await new Promise(r => setTimeout(r, 0));
  // doesn't update because not tracked
  expect(value).toBe(1);
});

it("should handle streams", async () => {
  const effect = vi.fn();
  createRoot(() => {
    const v = createAsync(async function* () {
      yield await Promise.resolve(1);
      yield await Promise.resolve(2);
      yield await Promise.resolve(3);
    });
    createEffect(v, v => effect(v));
  });
  flushSync();
  expect(effect).toHaveBeenCalledTimes(0);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(effect).toHaveBeenCalledTimes(1);
  expect(effect).toHaveBeenCalledWith(1);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(effect).toHaveBeenCalledTimes(2);
  expect(effect).toHaveBeenCalledWith(2);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(effect).toHaveBeenCalledTimes(3);
  expect(effect).toHaveBeenCalledWith(3);
});
