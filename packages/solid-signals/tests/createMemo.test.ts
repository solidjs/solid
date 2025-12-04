import {
  createEffect,
  createErrorBoundary,
  createMemo,
  createRoot,
  createSignal,
  flush,
  // hasUpdated
} from "../src/index.js";

afterEach(() => flush());

it("should store and return value on read", () => {
  const [$x] = createSignal(1);
  const [$y] = createSignal(1);

  const $a = createMemo(() => $x() + $y());

  expect($a()).toBe(2);
  flush();

  // Try again to ensure state is maintained.
  expect($a()).toBe(2);
});

it("should update when dependency is updated", () => {
  const [$x, setX] = createSignal(1);
  const [$y, setY] = createSignal(1);

  const $a = createMemo(() => $x() + $y());

  setX(2);
  flush();
  expect($a()).toBe(3);

  setY(2);
  flush();
  expect($a()).toBe(4);
});

it("should update when deep dependency is updated", () => {
  const [$x, setX] = createSignal(1);
  const [$y] = createSignal(1);

  const $a = createMemo(() => $x() + $y());
  const $b = createMemo(() => $a());

  setX(2);
  flush();
  expect($b()).toBe(3);
});

it("should update when deep computed dependency is updated", () => {
  const [$x, setX] = createSignal(10);
  const [$y] = createSignal(10);

  const $a = createMemo(() => $x() + $y());
  const $b = createMemo(() => $a());
  const $c = createMemo(() => $b());

  setX(20);
  flush();
  expect($c()).toBe(30);
});

it("should only re-compute when needed", () => {
  const computed = vi.fn();

  const [$x, setX] = createSignal(10);
  const [$y, setY] = createSignal(10);

  const $a = createMemo(() => computed($x() + $y()));
  expect(computed).toHaveBeenCalledTimes(1);
  expect(computed).toHaveBeenCalledWith(20);

  $a();
  expect(computed).toHaveBeenCalledTimes(1);

  setX(20);
  expect(computed).toHaveBeenCalledTimes(1);
  flush();
  expect(computed).toHaveBeenCalledTimes(2);

  setY(20);
  flush();
  expect(computed).toHaveBeenCalledTimes(3);

  $a();
  expect(computed).toHaveBeenCalledTimes(3);
});

it("should only re-compute whats needed", () => {
  const memoA = vi.fn(n => n);
  const memoB = vi.fn(n => n);

  const [$x, setX] = createSignal(10);
  const [$y, setY] = createSignal(10);

  const $a = createMemo(() => memoA($x()));
  const $b = createMemo(() => memoB($y()));
  const $c = createMemo(() => $a() + $b());

  expect(memoA).toHaveBeenCalledTimes(1);
  expect(memoB).toHaveBeenCalledTimes(1);
  expect($c()).toBe(20);

  setX(20);
  flush();

  expect(memoA).toHaveBeenCalledTimes(2);
  expect(memoB).toHaveBeenCalledTimes(1);
  expect($c()).toBe(30);

  setY(20);
  flush();

  expect(memoA).toHaveBeenCalledTimes(2);
  expect(memoB).toHaveBeenCalledTimes(2);
  expect($c()).toBe(40);
});

it("should discover new dependencies", () => {
  const [$x, setX] = createSignal(1);
  const [$y, setY] = createSignal(0);

  const $c = createMemo(() => {
    if ($x()) {
      return $x();
    } else {
      return $y();
    }
  });

  expect($c()).toBe(1);

  setX(0);
  flush();
  expect($c()).toBe(0);

  setY(10);
  flush();
  expect($c()).toBe(10);
});

it("should accept equals option", () => {
  const [$x, setX] = createSignal(0);

  const $a = createMemo(() => $x(), 0, {
    // Skip even numbers.
    equals: (prev, next) => prev + 1 === next
  });

  const effectA = vi.fn();
  createRoot(() => createEffect($a, effectA));
  flush();

  expect($a()).toBe(0);
  expect(effectA).toHaveBeenCalledTimes(1);

  setX(2);
  flush();
  expect($a()).toBe(2);
  expect(effectA).toHaveBeenCalledTimes(2);

  // no-change
  setX(3);
  flush();
  expect($a()).toBe(2);
  expect(effectA).toHaveBeenCalledTimes(2);
});

it("should use fallback if error is thrown during init", () => {
  createRoot(() => {
    createErrorBoundary(
      () => {
        const $a = createMemo(() => {
          if (1) throw Error();
          return "";
        }, "foo");

        expect($a()).toBe("foo");
      },
      () => {}
    )();
  });
});

// it("should detect which signal triggered it", () => {
//   const [$x, setX] = createSignal(0);
//   const [$y, setY] = createSignal(0);

//   const $a = createMemo(() => {
//     const uX = hasUpdated($x);
//     const uY = hasUpdated($y);
//     return uX && uY ? "both" : uX ? "x" : uY ? "y" : "neither";
//   });
//   createRoot(() => createEffect($a, () => {}));
//   expect($a()).toBe("neither");
//   flush();
//   expect($a()).toBe("neither");

//   setY(1);
//   flush();
//   expect($a()).toBe("y");

//   setX(1);
//   flush();
//   expect($a()).toBe("x");

//   setY(2);
//   flush();
//   expect($a()).toBe("y");

//   setX(2);
//   setY(3);
//   flush();
//   expect($a()).toBe("both");
// });
