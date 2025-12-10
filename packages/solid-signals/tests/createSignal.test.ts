import { createMemo, createRoot, createSignal, flush } from "../src/index.js";

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

  const disposer = createRoot((dispose) => {
    createMemo(() => $x());
    return dispose
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
    createMemo(() => $x() ? $y() : null);
  });

  expect(unobserved).not.toBeCalled();

  setX(false);
  flush();
  expect(unobserved).toBeCalledTimes(1);
});
