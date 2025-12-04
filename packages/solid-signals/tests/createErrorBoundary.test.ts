import {
  createErrorBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "../src/index.js";

it("should let errors bubble up when not handled", () => {
  const error = new Error();
  expect(() => {
    createRoot(() => {
      createRenderEffect(
        () => {
          throw error;
        },
        () => {}
      );
    });
    flush();
  }).toThrowError(error);
});

it("should handle error", () => {
  const error = new Error();

  const b = createRoot(() =>
    createErrorBoundary(
      () => {
        throw error;
      },
      () => "errored"
    )
  );

  expect(b()).toBe("errored");
});

it("should forward error to another handler", () => {
  const error = new Error();

  const b = createRoot(() =>
    createErrorBoundary(
      () => {
        const inner = createErrorBoundary(
          () => {
            throw error;
          },
          e => {
            expect(e).toBe(error);
            throw e;
          }
        );
        createRenderEffect(inner, () => {});
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

  createRoot(() => {
    const b = createErrorBoundary(() => {
      $x();
      if (shouldThrow) throw error;
    }, handler);
    createRenderEffect(b, () => {});
  });

  setX(1);
  flush();

  shouldThrow = true;
  setX(2);
  flush();
  expect(handler).toHaveBeenCalledTimes(1);
});

it("should not trigger wrong handler", () => {
  const error = new Error(),
    rootHandler = vi.fn(),
    handler = vi.fn();

  let [$x, setX] = createSignal(0),
    shouldThrow = false;

  createRoot(() => {
    const b = createErrorBoundary(() => {
      createRenderEffect(
        () => {
          $x();
          if (shouldThrow) throw error;
        },
        () => {}
      );

      const b2 = createErrorBoundary(() => {
        // no-op
      }, handler);
      createRenderEffect(b2, () => {});
    }, rootHandler);
    createRenderEffect(b, () => {});
  });

  expect(rootHandler).toHaveBeenCalledTimes(0);
  shouldThrow = true;
  setX(1);
  flush();

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

  createRoot(() => {
    const b = createErrorBoundary(
      () => {
        if ($x()) throw error;
        createErrorBoundary(
          () => {
            throw error;
          },
          e => {
            expect(e).toBe(error);
          }
        );
      },
      err => rootHandler(err)
    );
    createRenderEffect(
      () => b(),
      () => {}
    );
  });
  expect(rootHandler).toHaveBeenCalledTimes(0);
  setX(1);
  flush();
  expect(rootHandler).toHaveBeenCalledWith(error);
  expect(rootHandler).toHaveBeenCalledTimes(1);
});

it("should handle errors when the effect is on the outside and memo in the middle", async () => {
  const error = new Error(),
    rootHandler = vi.fn();

  createRoot(() => {
    const b = createErrorBoundary(
      () =>
        createMemo(() => {
          throw error;
        }),
      rootHandler
    );
    createRenderEffect(b, () => {});
  });
  expect(rootHandler).toHaveBeenCalledTimes(1);
});
