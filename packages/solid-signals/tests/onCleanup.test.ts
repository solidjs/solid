import { createEffect, createRoot, flushSync, onCleanup } from "../src";

afterEach(() => flushSync());

it("should be invoked when computation is disposed", () => {
  const disposeA = vi.fn();
  const disposeB = vi.fn();
  const disposeC = vi.fn();

  const stopEffect = createEffect(() => {
    onCleanup(disposeA);
    onCleanup(disposeB);
    onCleanup(disposeC);
  });

  stopEffect();

  expect(disposeA).toHaveBeenCalled();
  expect(disposeB).toHaveBeenCalled();
  expect(disposeC).toHaveBeenCalled();
});

it("should not trigger wrong onCleanup", () => {
  const dispose = vi.fn();

  createRoot(() => {
    createEffect(() => {
      onCleanup(dispose);
    });

    const stop = createEffect(() => {});
    stop();
    flushSync();

    expect(dispose).toHaveBeenCalledTimes(0);
  });
});

it("should clean up in reverse order", () => {
  const disposeParent = vi.fn();
  const disposeA = vi.fn();
  const disposeB = vi.fn();

  let calls = 0;

  const stopEffect = createEffect(() => {
    onCleanup(() => disposeParent(++calls));

    createEffect(() => {
      onCleanup(() => disposeA(++calls));
    });

    createEffect(() => {
      onCleanup(() => disposeB(++calls));
    });
  });

  stopEffect();

  expect(disposeB).toHaveBeenCalled();
  expect(disposeA).toHaveBeenCalled();
  expect(disposeParent).toHaveBeenCalled();

  expect(disposeB).toHaveBeenCalledWith(1);
  expect(disposeA).toHaveBeenCalledWith(2);
  expect(disposeParent).toHaveBeenCalledWith(3);
});
