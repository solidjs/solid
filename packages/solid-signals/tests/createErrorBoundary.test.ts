import {
  createEffect,
  createErrorBoundary,
  createMemo,
  createRoot,
  createSignal,
  flushSync
} from "../src/index.js";

it("should let errors bubble up when not handled", () => {
  const error = new Error();
  expect(() => {
    createRoot(() => {
      createEffect(
        () => {
          throw error;
        },
        () => {}
      );
    });
    flushSync();
  }).toThrowError(error);
});

it("should handle error", () => {
  const error = new Error();

  const b = createErrorBoundary(
    () => {
      throw error;
    },
    () => "errored"
  );

  expect(b()).toBe("errored");
});

it("should forward error to another handler", () => {
  const error = new Error();

  const b = createRoot(() =>
    createErrorBoundary(
      () => {
        createEffect(
          () => {
            createErrorBoundary(
              () => {
                throw error;
              },
              e => {
                expect(e).toBe(error);
                throw e;
              }
            )();
          },
          () => {}
        );
      },
      () => "errored"
    )
  );

  expect(b()).toBe("errored");
});

it("should not duplicate error handler", () => {
  const error = new Error(),
    handler = vi.fn();

  let [$x, setX] = createSignal(0),
    shouldThrow = false;

  createRoot(() =>
    createEffect(
      () => {
        $x();
        createErrorBoundary(() => {
          if (shouldThrow) throw error;
        }, handler)();
      },
      () => {}
    )
  );

  setX(1);
  flushSync();

  shouldThrow = true;
  setX(2);
  flushSync();
  expect(handler).toHaveBeenCalledTimes(1);
});

it("should not trigger wrong handler", () => {
  const error = new Error(),
    rootHandler = vi.fn(),
    handler = vi.fn();

  let [$x, setX] = createSignal(0),
    shouldThrow = false;

  createRoot(() => {
    createEffect(
      () => {
        createErrorBoundary(() => {
          createEffect(
            () => {
              $x();
              if (shouldThrow) throw error;
            },
            () => {}
          );

          createEffect(
            () => {
              createErrorBoundary(() => {
                // no-op
              }, handler);
            },
            () => {}
          );
        }, rootHandler)();
      },
      () => {}
    );
  });

  expect(rootHandler).toHaveBeenCalledTimes(0);
  shouldThrow = true;
  setX(1);
  flushSync();

  expect(rootHandler).toHaveBeenCalledTimes(1);
  expect(handler).not.toHaveBeenCalledWith(error);
});

it("should throw error if there are no handlers left", () => {
  const error = new Error(),
    handler = vi.fn(e => {
      throw e;
    });

  expect(() => {
    createErrorBoundary(() => {
      createErrorBoundary(() => {
        throw error;
      }, handler)();
    }, handler)();
  }).toThrow(error);

  expect(handler).toHaveBeenCalledTimes(2);
});

it("should handle errors when the effect is on the outside", async () => {
  const error = new Error(),
    rootHandler = vi.fn();

  const [$x, setX] = createSignal(0);

  createRoot(() =>
    createEffect(
      () => {
        createErrorBoundary(
          () => {
            if ($x()) throw error;
            createErrorBoundary(
              () => {
                throw error;
              },
              e => {
                expect(e).toBe(error);
              }
            )();
          },
          err => rootHandler(err)
        )();
      },
      () => {}
    )
  );
  setX(1);
  flushSync();
  expect(rootHandler).toHaveBeenCalledWith(error);
  expect(rootHandler).toHaveBeenCalledTimes(1);
});

it("should handle errors when the effect is on the outside and memo in the middle", async () => {
  const error = new Error(),
    rootHandler = vi.fn();

  createRoot(() =>
    createEffect(
      () => {
        createErrorBoundary(
          () =>
            createMemo(() => {
              throw error;
            }),
          rootHandler
        )();
      },
      () => {}
    )
  );
  expect(rootHandler).toHaveBeenCalledTimes(1);
});
