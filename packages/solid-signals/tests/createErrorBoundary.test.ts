import {
  action,
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

it("should hold error boundary during transition when signal change clears error", async () => {
  const error = new Error("test error");
  const [$shouldError, setShouldError] = createSignal(true);
  let result: any;

  createRoot(() => {
    const b = createErrorBoundary(
      () => {
        if ($shouldError()) throw error;
        return "content";
      },
      () => "error"
    );
    createRenderEffect(
      () => (result = b()),
      () => {}
    );
  });

  flush();
  expect(result).toBe("error");

  // Start a transition that clears the error
  const myAction = action(function* () {
    setShouldError(false);
    yield Promise.resolve();
  });

  myAction();
  flush();
  // Transition in progress - boundary should still show error (held)
  expect(result).toBe("error");

  await Promise.resolve();
  // Transition complete - boundary should now show content
  expect(result).toBe("content");
});

it("should hold error boundary during transition when reset is called", async () => {
  const error = new Error("test error");
  let shouldError = true;
  let result: any;
  let resetFn!: () => void;

  createRoot(() => {
    const b = createErrorBoundary(
      () => {
        if (shouldError) throw error;
        return "content";
      },
      (err, reset) => {
        resetFn = reset;
        return "error";
      }
    );
    createRenderEffect(
      () => (result = b()),
      () => {}
    );
  });

  flush();
  expect(result).toBe("error");
  expect(resetFn).toBeDefined();

  // Start a transition that resets the error boundary
  const myAction = action(function* () {
    shouldError = false;
    resetFn();
    yield Promise.resolve();
  });

  myAction();
  flush();
  // Transition in progress - boundary should still show error (held)
  expect(result).toBe("error");

  await Promise.resolve();
  // Transition complete - boundary should now show content
  expect(result).toBe("content");
});
