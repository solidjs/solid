import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  flushSync,
  onCleanup,
  untrack,
} from "../src";

afterEach(() => flushSync());

it("should not create dependency", () => {
  const effect = vi.fn();
  const memo = vi.fn();

  const [$x, setX] = createSignal(10);

  const $a = createMemo(() => $x() + 10);
  const $b = createMemo(() => {
    memo();
    return untrack($a) + 10;
  });

  createEffect(() => {
    effect();
    expect(untrack($x)).toBe(10);
    expect(untrack($a)).toBe(20);
    expect(untrack($b)).toBe(30);
  });

  expect(effect).toHaveBeenCalledTimes(1);
  expect(memo).toHaveBeenCalledTimes(1);

  setX(20);
  flushSync();
  expect(effect).toHaveBeenCalledTimes(1);
  expect(memo).toHaveBeenCalledTimes(1);
});

it("should not affect deep dependency being created", () => {
  const effect = vi.fn();
  const memo = vi.fn();

  const [$x, setX] = createSignal(10);
  const [$y, setY] = createSignal(10);
  const [$z, setZ] = createSignal(10);

  const $a = createMemo(() => {
    memo();
    return $x() + untrack($y) + untrack($z) + 10;
  });

  createEffect(() => {
    effect();
    expect(untrack($x)).toBe(10);
    expect(untrack($a)).toBe(40);
  });

  expect(effect).toHaveBeenCalledTimes(1);
  expect($a()).toBe(40);
  expect(memo).toHaveBeenCalledTimes(1);

  setX(20);
  flushSync();
  expect(effect).toHaveBeenCalledTimes(1);
  expect($a()).toBe(50);
  expect(memo).toHaveBeenCalledTimes(2);

  setY(20);
  flushSync();
  expect(effect).toHaveBeenCalledTimes(1);
  expect($a()).toBe(50);
  expect(memo).toHaveBeenCalledTimes(2);

  setZ(20);
  flushSync();
  expect(effect).toHaveBeenCalledTimes(1);
  expect($a()).toBe(50);
  expect(memo).toHaveBeenCalledTimes(2);
});

it("should track owner across peeks", () => {
  const [$x, setX] = createSignal(0);

  const childCompute = vi.fn();
  const childDispose = vi.fn();

  function createChild() {
    const $a = createMemo(() => $x() * 2);
    createEffect(() => {
      childCompute($a());
      onCleanup(childDispose);
    });
  }

  const dispose = createRoot((dispose) => {
    untrack(() => createChild());
    return dispose;
  });

  setX(1);
  flushSync();
  expect(childCompute).toHaveBeenCalledWith(2);
  expect(childDispose).toHaveBeenCalledTimes(1);

  dispose();
  expect(childDispose).toHaveBeenCalledTimes(2);

  setX(2);
  flushSync();
  expect(childCompute).not.toHaveBeenCalledWith(4);
  expect(childDispose).toHaveBeenCalledTimes(2);
});
