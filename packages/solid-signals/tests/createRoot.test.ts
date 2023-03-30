import {
  Accessor,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  flushSync,
  getOwner,
  onCleanup,
  Signal,
} from "../src";
import { Computation } from "../src/types";

afterEach(() => flushSync());

it("should dispose of inner computations", () => {
  let $x: Signal<number>;
  let $y: Accessor<number>;

  const memo = vi.fn(() => $x[0]() + 10);

  createRoot((dispose) => {
    $x = createSignal(10);
    $y = createMemo(memo);
    $y();
    dispose();
  });

  expect($y!()).toBe(20);
  expect(memo).toHaveBeenCalledTimes(1);

  flushSync();

  $x![1](50);
  flushSync();

  expect($y!()).toBe(20);
  expect(memo).toHaveBeenCalledTimes(1);
});

it("should return result", () => {
  const result = createRoot((dispose) => {
    dispose();
    return 10;
  });

  expect(result).toBe(10);
});

it("should create new tracking scope", () => {
  const [$x, setX] = createSignal(0);
  const effect = vi.fn();

  const stopEffect = createRoot((dispose) => {
    createEffect(() => {
      $x();
      createRoot(() => void createEffect(() => effect($x())));
    });

    return dispose;
  });

  expect(effect).toHaveBeenCalledWith(0);
  expect(effect).toHaveBeenCalledTimes(1);

  stopEffect();

  setX(10);
  flushSync();
  expect(effect).not.toHaveBeenCalledWith(10);
  expect(effect).toHaveBeenCalledTimes(1);
});

it("should not be reactive", () => {
  let $x: Signal<number>;

  const root = vi.fn();

  createRoot(() => {
    $x = createSignal(0);
    $x[0]();
    root();
  });

  expect(root).toHaveBeenCalledTimes(1);

  $x![1](1);
  flushSync();
  expect(root).toHaveBeenCalledTimes(1);
});

it("should hold parent tracking", () => {
  createRoot(() => {
    const parent = getOwner();
    createRoot(() => {
      expect(getOwner()!._parent).toBe(parent);
    });
  });
});

it("should not observe", () => {
  const [$x] = createSignal(0);
  createRoot(() => {
    $x();
    const owner = getOwner() as Computation;
    expect(owner._sources).toBeUndefined();
    expect(owner._observers).toBeUndefined();
  });
});

it("should not throw if dispose called during active disposal process", () => {
  createRoot((dispose) => {
    onCleanup(() => dispose());
    dispose();
  });
});
