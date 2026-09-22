import { createEffect, createRoot, flush, onCleanup } from "../src/index.js";

afterEach(() => flush());

it("should be invoked when computation is disposed", () => {
  const disposeA = vi.fn();
  const disposeB = vi.fn();
  const disposeC = vi.fn();

  const stopEffect = createRoot(dispose => {
    createEffect(
      () => {
        onCleanup(disposeA);
        onCleanup(disposeB);
        onCleanup(disposeC);
      },
      () => {}
    );

    return dispose;
  });
  flush();

  stopEffect();

  expect(disposeA).toHaveBeenCalled();
  expect(disposeB).toHaveBeenCalled();
  expect(disposeC).toHaveBeenCalled();
});

it("should not trigger wrong onCleanup", () => {
  const dispose = vi.fn();

  createRoot(() => {
    createEffect(
      () => {
        onCleanup(dispose);
      },
      () => {}
    );

    const stopEffect = createRoot(dispose => {
      createEffect(
        () => {},
        () => {}
      );
      return dispose;
    });

    stopEffect();
    flush();

    expect(dispose).toHaveBeenCalledTimes(0);
  });
});

it("should clean up in reverse order", () => {
  const disposeParent = vi.fn();
  const disposeA = vi.fn();
  const disposeB = vi.fn();

  let calls = 0;

  const stopEffect = createRoot(dispose => {
    createEffect(
      () => {
        onCleanup(() => disposeParent(++calls));

        createEffect(
          () => {
            onCleanup(() => disposeA(++calls));
          },
          () => {}
        );

        createEffect(
          () => {
            onCleanup(() => disposeB(++calls));
          },
          () => {}
        );
      },
      () => {}
    );

    return dispose;
  });
  flush();

  stopEffect();

  expect(disposeB).toHaveBeenCalled();
  expect(disposeA).toHaveBeenCalled();
  expect(disposeParent).toHaveBeenCalled();

  expect(disposeB).toHaveBeenCalledWith(1);
  expect(disposeA).toHaveBeenCalledWith(2);
  expect(disposeParent).toHaveBeenCalledWith(3);
});

it("cleanup order is unwind: children before owner, later registrations before earlier", () => {
  // #3572 / #1562. Disposal unwinds: an owner's children are torn down
  // before the owner's own cleanups, and within one owner the cleanups run
  // in reverse registration order (LIFO). Production component bodies share
  // their enclosing owner, so this is what makes a parent that registers
  // cleanup before rendering its children tear down after them — the same
  // order the dev tier's per-component owner gives.
  const order: string[] = [];

  const dispose = createRoot(dispose => {
    onCleanup(() => order.push("A"));
    onCleanup(() => order.push("B"));
    createRoot(() => onCleanup(() => order.push("C")));
    createEffect(
      () => {},
      () => () => order.push("D")
    );
    return dispose;
  });
  flush();
  dispose();

  // Children first, in their chain order (newest child first), then the
  // owner's own list unwound: B (registered last) before A.
  expect(order).toEqual(["D", "C", "B", "A"]);
});

it("should dispose all roots", () => {
  const disposals: string[] = [];

  const dispose = createRoot(dispose => {
    createRoot(() => {
      onCleanup(() => disposals.push("SUBTREE 1"));
      createEffect(
        () => onCleanup(() => disposals.push("+A1")),
        () => {}
      );
      createEffect(
        () => onCleanup(() => disposals.push("+B1")),
        () => {}
      );
      createEffect(
        () => onCleanup(() => disposals.push("+C1")),
        () => {}
      );
    });

    createRoot(() => {
      onCleanup(() => disposals.push("SUBTREE 2"));
      createEffect(
        () => onCleanup(() => disposals.push("+A2")),
        () => {}
      );
      createEffect(
        () => onCleanup(() => disposals.push("+B2")),
        () => {}
      );
      createEffect(
        () => onCleanup(() => disposals.push("+C2")),
        () => {}
      );
    });

    onCleanup(() => disposals.push("ROOT"));

    return dispose;
  });

  flush();
  dispose();

  expect(disposals).toMatchInlineSnapshot(`
    [
      "+C2",
      "+B2",
      "+A2",
      "SUBTREE 2",
      "+C1",
      "+B1",
      "+A1",
      "SUBTREE 1",
      "ROOT",
    ]
  `);
});
