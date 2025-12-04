import {
  createAsync,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  // createTrackedEffect,
  flush,
  isPending,
  pending,
  resolve,
  untrack
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
  flush();
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
  flush();
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
  flush();
  expect(b()).toBe("stale");
  await new Promise(r => setTimeout(r, 0));
  expect(b()).toBe("not stale");
});

// TODO fix pending timing
it.skip("should handle refreshes", async () => {
  let n = 1;
  const a = createRoot(() => createAsync(() => Promise.resolve(n++)));
  const b = createMemo(() => (isPending(a) ? "stale" : a()));
  expect(b).toThrow();
  await new Promise(r => setTimeout(r, 0));
  expect(b()).toBe(1);
  a.refresh();
  expect(b()).toBe("stale");
  await new Promise(r => setTimeout(r, 0));
  expect(b()).toBe(2);
  a.refresh();
  expect(b()).toBe("stale");
  await new Promise(r => setTimeout(r, 0));
  expect(b()).toBe(3);
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
  flush();
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
  flush();
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

it("should still resolve in untracked scopes", async () => {
  const [s, set] = createSignal(1);
  const async1 = vi.fn(() => Promise.resolve(s()));
  const effect = vi.fn();
  createRoot(() => {
    const a = createAsync(async1);
    createEffect(
      () => untrack(a),
      v => effect(v)
    );
  });
  expect(effect).toHaveBeenCalledTimes(0);
  flush();
  expect(effect).toHaveBeenCalledTimes(0);
  await Promise.resolve();
  expect(effect).toHaveBeenCalledTimes(1);
  expect(effect).toHaveBeenCalledWith(1);
  set(2);
  flush();
  expect(effect).toHaveBeenCalledTimes(1);
  await Promise.resolve();
  expect(effect).toHaveBeenCalledTimes(1);
  set(3);
  flush();
  expect(effect).toHaveBeenCalledTimes(1);
  await Promise.resolve();
  expect(effect).toHaveBeenCalledTimes(1);
});

// it("should still resolve in deferred untracked scopes", async () => {
//   const [s, set] = createSignal(1);
//   const async1 = vi.fn(() => Promise.resolve(s()));
//   const effect = vi.fn();
//   createRoot(() => {
//     const a = createAsync(async1);
//     createTrackedEffect(() => untrack(() => effect(a())));
//   });
//   expect(effect).toHaveBeenCalledTimes(0);
//   flush();
//   expect(effect).toHaveBeenCalledTimes(0);
//   await Promise.resolve();
//   expect(effect).toHaveBeenCalledTimes(1);
//   expect(effect).toHaveBeenCalledWith(1);
//   set(2);
//   flush();
//   expect(effect).toHaveBeenCalledTimes(1);
//   await Promise.resolve();
//   expect(effect).toHaveBeenCalledTimes(1);
//   set(3);
//   flush();
//   expect(effect).toHaveBeenCalledTimes(1);
//   await Promise.resolve();
//   expect(effect).toHaveBeenCalledTimes(1);
// });
