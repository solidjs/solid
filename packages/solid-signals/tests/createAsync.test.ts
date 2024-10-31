import { createAsync, createEffect, createSignal, flushSync } from '../src';

it('diamond should not cause waterfalls on read', async () => {
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

  const b = createAsync(async1);
  const c = createAsync(async2);

  createEffect(
    () => [b(), c()],
    (v) => effect(...v),
  );

  expect(async1).toHaveBeenCalledTimes(1);
  expect(async2).toHaveBeenCalledTimes(1);
  expect(effect).toHaveBeenCalledTimes(0);
  await new Promise((r) => setTimeout(r, 0));
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
  await new Promise((r) => setTimeout(r, 0));
  expect(async1).toHaveBeenCalledTimes(2);
  expect(async2).toHaveBeenCalledTimes(2);
  expect(effect).toHaveBeenCalledTimes(2);
  expect(effect).toHaveBeenCalledWith(2, 2);
});

it('should waterfall when dependent on another async with shared source', async () => {
  //
  //    s
  //   /|
  //  a |
  //   \|
  //    b
  //    |
  //    e
  //
  const [s, set] = createSignal(1);
  const effect = vi.fn();
  const async1 = vi.fn(() => Promise.resolve(s()));
  const async2 = vi.fn(() => Promise.resolve(s() + a()));

  const a = createAsync(async1);
  const b = createAsync(async2);

  createEffect(() => b(), v => effect(v));

  expect(async1).toHaveBeenCalledTimes(1);
  expect(async2).toHaveBeenCalledTimes(1);
  expect(effect).toHaveBeenCalledTimes(0);
  await new Promise((r) => setTimeout(r, 0));
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
  await new Promise((r) => setTimeout(r, 0));
  expect(async1).toHaveBeenCalledTimes(2);
  expect(async2).toHaveBeenCalledTimes(4);
  expect(effect).toHaveBeenCalledTimes(2);
  expect(effect).toHaveBeenCalledWith(4);
});
