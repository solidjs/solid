import { createMemo, createRenderEffect, createRoot, createSignal, flush } from "../src/index.js";

afterEach(() => flush());

it("should store and return value on read", () => {
  const [$x] = createSignal(1);
  expect($x).toBeInstanceOf(Function);
  expect($x()).toBe(1);
});

it("should update signal via setter", () => {
  const [$x, setX] = createSignal(1);
  setX(2);
  expect($x()).toBe(1);
  flush();
  expect($x()).toBe(2);
});

it("should update signal via update function", () => {
  const [$x, setX] = createSignal(1);
  setX(n => n + 1);
  expect($x()).toBe(1);
  flush();
  expect($x()).toBe(2);
});

it("should accept equals option", () => {
  const [$x, setX] = createSignal(1, {
    // Skip even numbers.
    equals: (prev, next) => prev + 1 === next
  });

  setX(11);
  expect($x()).toBe(1);
  flush();
  expect($x()).toBe(11);

  setX(12);
  flush();
  expect($x()).toBe(11);

  setX(13);
  flush();
  expect($x()).toBe(13);

  setX(14);
  flush();
  expect($x()).toBe(13);
});

it("should update signal with functional value", () => {
  const [$x, setX] = createSignal<() => number>(() => () => 10);
  expect($x()()).toBe(10);
  setX(() => () => 20);
  flush();
  expect($x()()).toBe(20);
});

it("should create signal derived from another signal", () => {
  const [$x, setX] = createSignal(1);
  const [$y, setY] = createSignal(() => $x() + 1);
  expect($y()).toBe(2);
  setY(1);
  flush();
  expect($y()).toBe(1);
  setX(2);
  flush();
  expect($y()).toBe(3);
});

it("should call unobserved callback when subscriber is disposed", () => {
  const unobserved = vi.fn();
  const [$x, setX] = createSignal(1, { unobserved });

  const disposer = createRoot(dispose => {
    createMemo(() => $x());
    return dispose;
  });

  expect(unobserved).not.toBeCalled();
  disposer();
  expect(unobserved).toBeCalledTimes(1);

  setX(2);
  flush();
  expect(unobserved).toBeCalledTimes(1);
});

it("should call unobserved callback when signal is unobserved", () => {
  const unobserved = vi.fn();
  const [$x, setX] = createSignal(true);
  const [$y, setY] = createSignal(1, { unobserved });

  createRoot(() => {
    createMemo(() => ($x() ? $y() : null));
  });

  expect(unobserved).not.toBeCalled();

  setX(false);
  flush();
  expect(unobserved).toBeCalledTimes(1);
});

describe("async computed transition entanglement", () => {
  it("async computed in an incomplete transition blocks entangled effects", async () => {
    const values: number[] = [];
    let setCounter!: (v: number | ((prev: number) => number)) => number;

    const dispose = createRoot(dispose => {
      const [counter, _setCounter] = createSignal(0);
      setCounter = _setCounter;

      // Never-resolving async signal read by a render effect.
      // This adds it to _asyncNodes, creating a permanently incomplete transition.
      const [os] = createSignal(async () => new Promise<string>(() => {}));
      createRenderEffect(
        () => os(),
        () => {}
      );

      // Async computed that reads counter and joins the same transition (same tick).
      // When counter changes, this node's recompute restores the incomplete transition,
      // causing flush to stash all effects — including counter's render effect.
      createSignal(async () => counter(), 0);

      createRenderEffect(
        () => counter(),
        v => {
          values.push(v);
        }
      );

      return dispose;
    });

    flush();
    await new Promise(r => setTimeout(r, 50));
    // Initial value is captured before the transition blocks
    expect(values).toContain(0);

    setCounter(1);
    flush();
    await new Promise(r => setTimeout(r, 50));
    // Updates are blocked: the incomplete transition stashes all entangled effects.
    // This is expected — use a <Loading> boundary to isolate async work.
    expect(values).not.toContain(1);

    setCounter(2);
    flush();
    await new Promise(r => setTimeout(r, 50));
    expect(values).not.toContain(2);

    dispose();
  });

  it("without the async computed, the sync effect is not entangled", async () => {
    const values: number[] = [];
    let setCounter!: (v: number | ((prev: number) => number)) => number;

    const dispose = createRoot(dispose => {
      const [counter, _setCounter] = createSignal(0);
      setCounter = _setCounter;

      // Same never-resolving async signal with render effect
      const [os] = createSignal(async () => new Promise<string>(() => {}));
      createRenderEffect(
        () => os(),
        () => {}
      );

      // No async computed bridging counter into the transition

      createRenderEffect(
        () => counter(),
        v => {
          values.push(v);
        }
      );

      return dispose;
    });

    flush();
    await new Promise(r => setTimeout(r, 50));
    expect(values).toContain(0);

    setCounter(1);
    flush();
    await new Promise(r => setTimeout(r, 50));
    // Without the async computed, counter's effect is independent and updates normally
    expect(values).toContain(1);

    setCounter(2);
    flush();
    await new Promise(r => setTimeout(r, 50));
    expect(values).toContain(2);

    dispose();
  });
});
