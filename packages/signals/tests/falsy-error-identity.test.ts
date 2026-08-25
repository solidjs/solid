/**
 * Pins the error-identity contract (#2840) for FALSY error values: whatever a
 * source throws or rejects with — including `undefined` and `null` — is what
 * every documented error surface receives. No internal `StatusError` wrapper,
 * no leaked reactive `.source` node.
 *
 * The falsy hole: `StatusError` always installs `cause` (even `undefined`), so
 * unwrap sites written as `wrapper.cause ?? wrapper` fall back to the wrapper
 * itself exactly when the user's rejection value is nullish. Affected:
 *   - createErrorBoundary fallback (boundaries.ts `notify`)
 *   - createEffect bundle `error` arm + no-handler console.error (effect.ts)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEffect,
  createErrorBoundary,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "../src/index.js";

function deferred<T = void>() {
  let resolveFn!: (value: T) => void;
  let rejectFn!: (error?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolveFn = res;
    rejectFn = rej;
  });
  return { promise, resolve: resolveFn, reject: rejectFn };
}

const drain = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  flush();
};

/** The wrapper leak signature: an Error carrying an internal reactive `.source`. */
function isInternalWrapper(v: unknown): boolean {
  return v instanceof Error && "source" in v;
}

describe("createErrorBoundary fallback receives the exact rejection value", () => {
  async function rejectWith(rejection: unknown) {
    const d = deferred<number>();
    let observed: unknown = "NOT_CALLED";
    let result: any;
    createRoot(() => {
      const memo = createMemo(() => d.promise);
      const b = createErrorBoundary(
        () => memo(),
        err => {
          observed = err();
          return "errored";
        }
      );
      createRenderEffect(
        () => (result = b()),
        () => {}
      );
    });
    flush();
    d.reject(rejection);
    await drain();
    expect(result).toBe("errored");
    return observed;
  }

  it("Promise.reject(undefined) → err() === undefined", async () => {
    const observed = await rejectWith(undefined);
    expect(isInternalWrapper(observed)).toBe(false);
    expect(observed).toBe(undefined);
  });

  it("Promise.reject(null) → err() === null", async () => {
    const observed = await rejectWith(null);
    expect(isInternalWrapper(observed)).toBe(false);
    expect(observed).toBe(null);
  });

  it("Promise.reject(0) → err() === 0", async () => {
    expect(await rejectWith(0)).toBe(0);
  });

  it('Promise.reject("") → err() === ""', async () => {
    expect(await rejectWith("")).toBe("");
  });

  it("Promise.reject(false) → err() === false", async () => {
    expect(await rejectWith(false)).toBe(false);
  });

  it("Promise.reject(NaN) → err() is NaN", async () => {
    expect(await rejectWith(NaN)).toBeNaN();
  });

  it("Promise.reject(Error) → same instance (control)", async () => {
    const boom = new Error("boom");
    expect(await rejectWith(boom)).toBe(boom);
  });

  it("Promise.reject(custom class) → instanceof holds (control)", async () => {
    class MyError extends Error {}
    const boom = new MyError("custom");
    const observed = await rejectWith(boom);
    expect(observed).toBe(boom);
    expect(observed).toBeInstanceOf(MyError);
  });

  it("Promise.reject(error with its own .cause) → not double-unwrapped", async () => {
    const inner = new Error("inner");
    const outer = new Error("outer", { cause: inner });
    const observed = await rejectWith(outer);
    expect(observed).toBe(outer);
    expect((observed as Error).cause).toBe(inner);
  });

  it("Promise.reject(plain object) → same reference", async () => {
    const payload = { code: 404 };
    expect(await rejectWith(payload)).toBe(payload);
  });

  it("async iterator throwing undefined → err() === undefined", async () => {
    let observed: unknown = "NOT_CALLED";
    let result: any;
    createRoot(() => {
      // eslint-disable-next-line require-yield
      const memo = createMemo(() =>
        (async function* (): AsyncGenerator<number> {
          throw undefined;
        })()
      );
      const b = createErrorBoundary(
        () => memo(),
        err => {
          observed = err();
          return "errored";
        }
      );
      createRenderEffect(
        () => (result = b()),
        () => {}
      );
    });
    flush();
    await drain();
    expect(result).toBe("errored");
    expect(isInternalWrapper(observed)).toBe(false);
    expect(observed).toBe(undefined);
  });

  function throwSync(thrown: unknown) {
    let observed: unknown = "NOT_CALLED";
    let result: any;
    createRoot(() => {
      const memo = createMemo(() => {
        throw thrown;
      });
      const b = createErrorBoundary(
        () => memo(),
        err => {
          observed = err();
          return "errored";
        }
      );
      createRenderEffect(
        () => (result = b()),
        () => {}
      );
    });
    flush();
    expect(result).toBe("errored");
    return observed;
  }

  it("sync throw undefined in a tracked child → err() === undefined", () => {
    const observed = throwSync(undefined);
    expect(isInternalWrapper(observed)).toBe(false);
    expect(observed).toBe(undefined);
  });

  it("sync throw null in a tracked child → err() === null", () => {
    const observed = throwSync(null);
    expect(isInternalWrapper(observed)).toBe(false);
    expect(observed).toBe(null);
  });

  it("Errored > Loading composition: bare rejection reaches err() as undefined", async () => {
    const d = deferred<number>();
    let observed: unknown = "NOT_CALLED";
    let result: any;
    createRoot(() => {
      const memo = createMemo(() => d.promise);
      const b = createErrorBoundary(
        () =>
          createLoadingBoundary(
            () => memo(),
            () => "loading"
          )(),
        err => {
          observed = err();
          return "errored";
        }
      );
      createRenderEffect(
        () => (result = b()),
        () => {}
      );
    });
    flush();
    expect(result).toBe("loading");
    d.reject(undefined);
    await drain();
    expect(result).toBe("errored");
    expect(isInternalWrapper(observed)).toBe(false);
    expect(observed).toBe(undefined);
  });

  it("boundary recovers after a falsy rejection when the source is replaced", async () => {
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const [gen, setGen] = createSignal(0);
    let observed: unknown = "NOT_CALLED";
    let result: any;
    createRoot(() => {
      const memo = createMemo(() => (gen() === 0 ? d1.promise : d2.promise));
      const b = createErrorBoundary(
        () => memo(),
        err => {
          observed = err();
          return "errored";
        }
      );
      createRenderEffect(
        () => (result = b()),
        () => {}
      );
    });
    flush();
    d1.reject(undefined);
    await drain();
    expect(result).toBe("errored");
    expect(observed).toBe(undefined);

    setGen(1);
    d2.resolve("recovered");
    await drain();
    expect(result).toBe("recovered");
  });
});

describe("createEffect bundle `error` arm receives the exact error value (#2840)", () => {
  let errorSpy!: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  function throwInCompute(thrown: unknown) {
    const [armed, setArmed] = createSignal(false);
    let received: unknown = "NOT_CALLED";
    createRoot(() => {
      createEffect(
        () => {
          if (armed()) throw thrown;
          return 0;
        },
        {
          effect: () => {},
          error: err => {
            received = err;
          }
        }
      );
    });
    flush();
    setArmed(true);
    flush();
    return received;
  }

  it("compute-phase throw undefined → handler receives undefined", () => {
    const received = throwInCompute(undefined);
    expect(isInternalWrapper(received)).toBe(false);
    expect(received).toBe(undefined);
  });

  it("compute-phase throw null → handler receives null", () => {
    const received = throwInCompute(null);
    expect(isInternalWrapper(received)).toBe(false);
    expect(received).toBe(null);
  });

  it("compute-phase throw 0 → handler receives 0 (control)", () => {
    expect(throwInCompute(0)).toBe(0);
  });

  it("async source rejecting with undefined → handler receives undefined", async () => {
    const d = deferred<number>();
    let received: unknown = "NOT_CALLED";
    createRoot(() => {
      const memo = createMemo(() => d.promise);
      createEffect(() => memo(), {
        effect: () => {},
        error: err => {
          received = err;
        }
      });
    });
    flush();
    d.reject(undefined);
    await drain();
    expect(isInternalWrapper(received)).toBe(false);
    expect(received).toBe(undefined);
  });

  it("no handler: console.error logs the raw undefined, not the wrapper", () => {
    const [armed, setArmed] = createSignal(false);
    createRoot(() => {
      createEffect(
        () => {
          if (armed()) throw undefined;
          return 0;
        },
        () => {}
      );
    });
    flush();
    setArmed(true);
    flush();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = errorSpy.mock.calls[0][0];
    expect(isInternalWrapper(logged)).toBe(false);
    expect(logged).toBe(undefined);
  });
});
