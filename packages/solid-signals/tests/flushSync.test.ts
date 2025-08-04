import { createEffect, createRoot, createSignal, flush } from "../src/index.js";

afterEach(() => flush());

it("should batch updates", () => {
  const [$x, setX] = createSignal(10);
  const effect = vi.fn();

  createRoot(() => createEffect($x, effect));
  flush();

  setX(20);
  setX(30);
  setX(40);

  expect(effect).to.toHaveBeenCalledTimes(1);
  flush();
  expect(effect).to.toHaveBeenCalledTimes(2);
});

it("should wait for queue to flush", () => {
  const [$x, setX] = createSignal(10);
  const $effect = vi.fn();

  createRoot(() => createEffect($x, $effect));
  flush();

  expect($effect).to.toHaveBeenCalledTimes(1);

  setX(20);
  flush();
  expect($effect).to.toHaveBeenCalledTimes(2);

  setX(30);
  flush();
  expect($effect).to.toHaveBeenCalledTimes(3);
});

it("should not fail if called while flushing", () => {
  const [$a, setA] = createSignal(10);

  const effect = vi.fn(() => {
    flush();
  });

  createRoot(() => createEffect($a, effect));
  flush();

  expect(effect).to.toHaveBeenCalledTimes(1);

  setA(20);
  flush();
  expect(effect).to.toHaveBeenCalledTimes(2);
});
