// https://github.com/preactjs/signals/blob/main/packages/core/test/signal.test.tsx#L1249

import { createMemo, createSignal } from "../src";

it("should drop X->B->X updates", () => {
  //     X
  //   / |
  //  A  | <- Looks like a flag doesn't it? :D
  //   \ |
  //     B
  //     |
  //     C

  const [$x, setX] = createSignal(2);

  const $a = createMemo(() => $x() - 1);
  const $b = createMemo(() => $x() + $a());

  const compute = vi.fn(() => "c: " + $b());
  const $c = createMemo(compute);

  expect($c()).toBe("c: 3");
  expect(compute).toHaveBeenCalledTimes(1);
  compute.mockReset();

  setX(4);
  $c();
  expect(compute).toHaveBeenCalledTimes(1);
});

it("should only update every signal once (diamond graph)", () => {
  // In this scenario "D" should only update once when "A" receive an update. This is sometimes
  // referred to as the "diamond" scenario.
  //     X
  //   /   \
  //  A     B
  //   \   /
  //     C

  const [$x, setX] = createSignal("a");
  const $a = createMemo(() => $x());
  const $b = createMemo(() => $x());

  const spy = vi.fn(() => $a() + " " + $b());
  const $c = createMemo(spy);

  expect($c()).toBe("a a");
  expect(spy).toHaveBeenCalledTimes(1);

  setX("aa");
  expect($c()).toBe("aa aa");
  expect(spy).toHaveBeenCalledTimes(2);
});

it("should only update every signal once (diamond graph + tail)", () => {
  // "D" will be likely updated twice if our mark+sweep logic is buggy.
  //     X
  //   /   \
  //  A     B
  //   \   /
  //     C
  //     |
  //     D

  const [$x, setX] = createSignal("a");

  const $a = createMemo(() => $x());
  const $b = createMemo(() => $x());
  const $c = createMemo(() => $a() + " " + $b());

  const spy = vi.fn(() => $c());
  const $d = createMemo(spy);

  expect($d()).toBe("a a");
  expect(spy).toHaveBeenCalledTimes(1);

  setX("aa");
  expect($d()).toBe("aa aa");
  expect(spy).toHaveBeenCalledTimes(2);
});

it("should bail out if result is the same", () => {
  // Bail out if value of "A" never changes
  // X->A->B

  const [$x, setX] = createSignal("a");

  const $a = createMemo(() => {
    $x();
    return "foo";
  });

  const spy = vi.fn(() => $a());
  const $b = createMemo(spy);

  expect($b()).toBe("foo");
  expect(spy).toHaveBeenCalledTimes(1);

  setX("aa");
  expect($b()).toBe("foo");
  expect(spy).toHaveBeenCalledTimes(1);
});

it("should only update every signal once (jagged diamond graph + tails)", () => {
  // "E" and "F" will be likely updated >3 if our mark+sweep logic is buggy.
  //     X
  //   /   \
  //  A     B
  //  |     |
  //  |     C
  //   \   /
  //     D
  //   /   \
  //  E     F

  const [$x, setX] = createSignal("a");

  const $a = createMemo(() => $x());
  const $b = createMemo(() => $x());
  const $c = createMemo(() => $b());

  const dSpy = vi.fn(() => $a() + " " + $c());
  const $d = createMemo(dSpy);

  const eSpy = vi.fn(() => $d());
  const $e = createMemo(eSpy);
  const fSpy = vi.fn(() => $d());
  const $f = createMemo(fSpy);

  expect($e()).toBe("a a");
  expect(eSpy).toHaveBeenCalledTimes(1);

  expect($f()).toBe("a a");
  expect(fSpy).toHaveBeenCalledTimes(1);

  setX("b");

  expect($d()).toBe("b b");
  expect(dSpy).toHaveBeenCalledTimes(2);

  expect($e()).toBe("b b");
  expect(eSpy).toHaveBeenCalledTimes(2);

  expect($f()).toBe("b b");
  expect(fSpy).toHaveBeenCalledTimes(2);

  setX("c");

  expect($d()).toBe("c c");
  expect(dSpy).toHaveBeenCalledTimes(3);

  expect($e()).toBe("c c");
  expect(eSpy).toHaveBeenCalledTimes(3);

  expect($f()).toBe("c c");
  expect(fSpy).toHaveBeenCalledTimes(3);
});

it("should ensure subs update even if one dep is static", () => {
  //     X
  //   /   \
  //  A     *B <- returns same value every time
  //   \   /
  //     C

  const [$x, setX] = createSignal("a");

  const $a = createMemo(() => $x());
  const $b = createMemo(() => {
    $x();
    return "c";
  });

  const spy = vi.fn(() => $a() + " " + $b());
  const $c = createMemo(spy);

  expect($c()).toBe("a c");

  setX("aa");

  expect($c()).toBe("aa c");
  expect(spy).toHaveBeenCalledTimes(2);
});

it("should ensure subs update even if two deps mark it clean", () => {
  // In this scenario both "B" and "C" always return the same value. But "D" must still update
  // because "X" marked it. If "D" isn't updated, then we have a bug.
  //     X
  //   / | \
  //  A *B *C
  //   \ | /
  //     D

  const [$x, setX] = createSignal("a");

  const $b = createMemo(() => $x());
  const $c = createMemo(() => {
    $x();
    return "c";
  });
  const $d = createMemo(() => {
    $x();
    return "d";
  });

  const spy = vi.fn(() => $b() + " " + $c() + " " + $d());
  const $e = createMemo(spy);

  expect($e()).toBe("a c d");

  setX("aa");

  expect($e()).toBe("aa c d");
  expect(spy).toHaveBeenCalledTimes(2);
});
