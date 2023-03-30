import { createEffect, createSignal, flushSync } from "../src";

afterEach(() => flushSync());

it("should batch updates", () => {
  const [$x, setX] = createSignal(10);
  const effect = vi.fn($x);

  createEffect(effect);

  setX(20);
  setX(30);
  setX(40);

  expect(effect).to.toHaveBeenCalledTimes(1);
  flushSync();
  expect(effect).to.toHaveBeenCalledTimes(2);
});

it("should wait for queue to flush", () => {
  const [$x, setX] = createSignal(10);
  const $effect = vi.fn($x);

  createEffect($effect);

  expect($effect).to.toHaveBeenCalledTimes(1);

  setX(20);
  flushSync();
  expect($effect).to.toHaveBeenCalledTimes(2);

  setX(30);
  flushSync();
  expect($effect).to.toHaveBeenCalledTimes(3);
});

it("should not fail if called while flushing", () => {
  const [$a, setA] = createSignal(10);

  const effect = vi.fn(() => {
    $a();
    flushSync();
  });

  createEffect(effect);

  expect(effect).to.toHaveBeenCalledTimes(1);

  setA(20);
  flushSync();
  expect(effect).to.toHaveBeenCalledTimes(2);
});
