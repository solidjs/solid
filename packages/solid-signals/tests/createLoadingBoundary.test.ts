import {
  createErrorBoundary,
  createLoadingBoundary,
  createMemo,
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  NotReadyError,
  untrack
} from "../src/index.js";

describe("createLoadingBoundary", () => {
  function deferred<T = void>() {
    let resolve!: (value: T) => void;
    let reject!: (error?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it("shows fallback while async projection is pending", async () => {
    let result: any;

    createRoot(() => {
      const proj = createProjection(
        async draft => {
          await Promise.resolve();
          draft.value = 1;
        },
        { value: 0 }
      );

      const boundary = createLoadingBoundary(
        () => proj.value,
        () => "loading"
      );

      createRenderEffect(
        () => (result = boundary()),
        () => {}
      );
    });

    flush();
    expect(result).toBe("loading");

    await Promise.resolve();
    await Promise.resolve();
    flush();

    expect(result).toBe(1);
  });

  it("clears loading state even when data unchanged", async () => {
    let result: any;

    createRoot(() => {
      const proj = createProjection(
        async draft => {
          await Promise.resolve();
          // No changes - data stays same
        },
        { items: [] }
      );

      const boundary = createLoadingBoundary(
        () => proj.items.length,
        () => "loading"
      );

      createRenderEffect(
        () => (result = boundary()),
        () => {}
      );
    });

    flush();
    expect(result).toBe("loading");

    await Promise.resolve();
    await Promise.resolve();
    flush();

    expect(result).toBe(0); // Should show 0, not "loading"
  });

  it("clears loading for multiple effects in same boundary", async () => {
    let result1: any, result2: any;

    createRoot(() => {
      const proj = createProjection(
        async draft => {
          await Promise.resolve();
          draft.a = 1;
          draft.b = 2;
        },
        { a: 0, b: 0 }
      );

      const boundary1 = createLoadingBoundary(
        () => proj.a,
        () => "loading"
      );
      const boundary2 = createLoadingBoundary(
        () => proj.b,
        () => "loading"
      );

      createRenderEffect(
        () => (result1 = boundary1()),
        () => {}
      );
      createRenderEffect(
        () => (result2 = boundary2()),
        () => {}
      );
    });

    flush();
    expect(result1).toBe("loading");
    expect(result2).toBe("loading");

    await Promise.resolve();
    await Promise.resolve();
    flush();

    expect(result1).toBe(1);
    expect(result2).toBe(2);
  });

  it("nested boundaries - inner catches async", async () => {
    let outerResult: any, innerResult: any;

    createRoot(() => {
      const proj = createProjection(
        async draft => {
          await Promise.resolve();
          draft.value = 1;
        },
        { value: 0 }
      );

      const outer = createLoadingBoundary(
        () => {
          const inner = createLoadingBoundary(
            () => proj.value,
            () => "inner-loading"
          );
          createRenderEffect(
            () => (innerResult = inner()),
            () => {}
          );
          return "outer-content";
        },
        () => "outer-loading"
      );

      createRenderEffect(
        () => (outerResult = outer()),
        () => {}
      );
    });

    flush();
    // Inner should be loading, outer should show content
    expect(innerResult).toBe("inner-loading");
    expect(outerResult).toBe("outer-content");

    await Promise.resolve();
    await Promise.resolve();
    flush();

    expect(innerResult).toBe(1);
    expect(outerResult).toBe("outer-content");
  });

  it("surfaces async rejection consistently for Loading/Errored orderings", async () => {
    let loadingThenErrored: any;
    let erroredThenLoading: any;
    const [$count, setCount] = createSignal(0);
    let current = deferred<number>();

    createRoot(() => {
      const source = createMemo(async () => {
        $count();
        await current.promise;
        return 10;
      });

      const branch1 = createLoadingBoundary(
        () =>
          createErrorBoundary(
            () => ["S: ", source()],
            () => "error1"
          )(),
        () => undefined
      );

      const branch2 = createErrorBoundary(
        () =>
          createLoadingBoundary(
            () => ["S: ", source()],
            () => undefined
          )(),
        () => "error2"
      );

      createRenderEffect(
        () => (loadingThenErrored = branch1()),
        () => {}
      );
      createRenderEffect(
        () => (erroredThenLoading = branch2()),
        () => {}
      );
    });

    flush();
    expect(loadingThenErrored).toBeUndefined();
    expect(erroredThenLoading).toBeUndefined();

    current.reject(100);
    await Promise.resolve();
    await Promise.resolve();
    flush();

    expect(loadingThenErrored).toBe("error1");
    expect(erroredThenLoading).toBe("error2");

    current = deferred<number>();
    setCount(1);
    flush();
    expect(loadingThenErrored).toBe("error1");
    expect(erroredThenLoading).toBe("error2");

    current.reject(100);
    await Promise.resolve();
    await Promise.resolve();
    flush();

    expect(loadingThenErrored).toBe("error1");
    expect(erroredThenLoading).toBe("error2");
  });

  it("nested Loading does not suppress eventual error fallback", async () => {
    let nestedLoadingBranch: any;
    let plainBranch: any;
    const [$count, setCount] = createSignal(0);
    let current = deferred<number>();

    createRoot(() => {
      const source = createMemo(async () => {
        $count();
        await current.promise;
        return 10;
      });

      const branch1 = createLoadingBoundary(
        () =>
          createErrorBoundary(
            () =>
              createLoadingBoundary(
                () => ["S: ", source()],
                () => undefined
              )(),
            () => "error1"
          )(),
        () => undefined
      );

      const branch2 = createErrorBoundary(
        () =>
          createLoadingBoundary(
            () => ["S: ", source()],
            () => undefined
          )(),
        () => "error2"
      );

      createRenderEffect(
        () => (nestedLoadingBranch = branch1()),
        () => {}
      );
      createRenderEffect(
        () => (plainBranch = branch2()),
        () => {}
      );
    });

    flush();
    expect(nestedLoadingBranch).toBeUndefined();
    expect(plainBranch).toBeUndefined();

    current.reject(100);
    await Promise.resolve();
    await Promise.resolve();
    flush();

    expect(nestedLoadingBranch).toBe("error1");
    expect(plainBranch).toBe("error2");

    current = deferred<number>();
    setCount(1);
    flush();
    expect(nestedLoadingBranch).toBe("error1");
    expect(plainBranch).toBe("error2");

    current.reject(100);
    await Promise.resolve();
    await Promise.resolve();
    flush();

    expect(nestedLoadingBranch).toBe("error1");
    expect(plainBranch).toBe("error2");
  });

  it("clears held errors after a refresh resolves successfully", async () => {
    let loadingThenErrored: any;
    let erroredThenLoading: any;
    const [$count, setCount] = createSignal(0);
    let current = deferred<number>();

    createRoot(() => {
      const source = createMemo(async () => {
        $count();
        await current.promise;
        return 10;
      });

      const branch1 = createLoadingBoundary(
        () =>
          createErrorBoundary(
            () => ["S: ", source()],
            () => "error1"
          )(),
        () => undefined
      );

      const branch2 = createErrorBoundary(
        () =>
          createLoadingBoundary(
            () => ["S: ", source()],
            () => undefined
          )(),
        () => "error2"
      );

      createRenderEffect(
        () => (loadingThenErrored = branch1()),
        () => {}
      );
      createRenderEffect(
        () => (erroredThenLoading = branch2()),
        () => {}
      );
    });

    flush();

    current.reject(100);
    await Promise.resolve();
    await Promise.resolve();
    flush();

    expect(loadingThenErrored).toBe("error1");
    expect(erroredThenLoading).toBe("error2");

    current = deferred<number>();
    setCount(1);
    flush();

    expect(loadingThenErrored).toBe("error1");
    expect(erroredThenLoading).toBe("error2");

    current.resolve(10);
    await Promise.resolve();
    await Promise.resolve();
    flush();

    expect(loadingThenErrored).toEqual(["S: ", 10]);
    expect(erroredThenLoading).toEqual(["S: ", 10]);
  });

  it("side effect only runs when no longer pending", async () => {
    let sideEffectRuns = 0;
    let result: any;

    createRoot(() => {
      const proj = createProjection(
        async draft => {
          await Promise.resolve();
          draft.value = 1;
        },
        { value: 0 }
      );

      const boundary = createLoadingBoundary(
        () => proj.value,
        () => "loading"
      );

      createRenderEffect(
        () => (result = boundary()),
        () => {
          sideEffectRuns++;
        }
      );
    });

    flush();
    expect(result).toBe("loading");
    expect(sideEffectRuns).toBe(1); // Initial run with loading

    await Promise.resolve();
    await Promise.resolve();
    flush();

    expect(result).toBe(1);
    expect(sideEffectRuns).toBe(2); // Runs again when resolved
  });

  it("handles rapid signal changes while pending", async () => {
    let result: any;
    const [$x, setX] = createSignal(1);

    createRoot(() => {
      const proj = createProjection(
        async draft => {
          const v = $x();
          await Promise.resolve();
          draft.value = v * 2;
        },
        { value: 0 }
      );

      const boundary = createLoadingBoundary(
        () => proj.value,
        () => "loading"
      );

      createRenderEffect(
        () => (result = boundary()),
        () => {}
      );
    });

    flush();
    expect(result).toBe("loading");

    // Change signal while still pending
    setX(2);
    flush();
    expect(result).toBe("loading");

    await Promise.resolve();
    await Promise.resolve();
    flush();

    // Should have latest value
    expect(result).toBe(4);
  });

  it("throws dev error when pending async value is read outside tracking scope with strictRead", () => {
    createRoot(() => {
      const data = createMemo(async () => {
        await Promise.resolve();
        return "Hello world!";
      });

      flush();
      untrack(() => {
        expect(() => data()).toThrow("Reading a pending async value directly in TestComponent");
      }, "TestComponent");
    });
  });

  it("does not throw dev error when pending async value is read inside a tracking scope", async () => {
    let result: any;
    createRoot(() => {
      const data = createMemo(async () => {
        await Promise.resolve();
        return "Hello world!";
      });

      flush();
      untrack(() => {
        const boundary = createLoadingBoundary(
          () => data(),
          () => "loading"
        );
        createRenderEffect(
          () => (result = boundary()),
          () => {}
        );
      }, "TestComponent");
    });

    flush();
    expect(result).toBe("loading");

    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(result).toBe("Hello world!");
  });

  describe("async memo resolves to same value as initial (solidjs#2604)", () => {
    it("same value resolves through boundary", async () => {
      let result: any;

      createRoot(() => {
        const data = createMemo(async () => {
          await Promise.resolve();
          return 100;
        }, 100);

        const boundary = createLoadingBoundary(
          () => data(),
          () => "loading"
        );

        createRenderEffect(
          () => (result = boundary()),
          () => {}
        );
      });

      flush();
      expect(result).toBe("loading");

      await Promise.resolve();
      await Promise.resolve();
      flush();

      expect(result).toBe(100);
    });

    it("different value resolves through boundary", async () => {
      let result: any;

      createRoot(() => {
        const data = createMemo(async () => {
          await Promise.resolve();
          return 101;
        }, 100);

        const boundary = createLoadingBoundary(
          () => data(),
          () => "loading"
        );

        createRenderEffect(
          () => (result = boundary()),
          () => {}
        );
      });

      flush();
      expect(result).toBe("loading");

      await Promise.resolve();
      await Promise.resolve();
      flush();

      expect(result).toBe(101);
    });

    it("does not re-run compute when resolving same value", async () => {
      let callCount = 0;
      let result: any;

      createRoot(() => {
        const data = createMemo(async () => {
          callCount++;
          await Promise.resolve();
          return 100;
        }, 100);

        const boundary = createLoadingBoundary(
          () => data(),
          () => "loading"
        );

        createRenderEffect(
          () => (result = boundary()),
          () => {}
        );
      });

      flush();
      expect(callCount).toBe(1);
      expect(result).toBe("loading");

      await Promise.resolve();
      await Promise.resolve();
      flush();

      expect(result).toBe(100);
      expect(callCount).toBe(1);
    });
  });

  it("stops loading when a pending child is disposed before its promise settles", () => {
    let result: any;
    const [$showAsync, setShowAsync] = createSignal(true);
    let resolve!: () => void;
    const promise = new Promise<void>(r => {
      resolve = r;
    });

    function Child() {
      const data = createMemo(async () => {
        await promise;
        return "async";
      });
      return () => data();
    }

    createRoot(() => {
      const boundary = createLoadingBoundary(
        () => ($showAsync() ? Child()() : "sync"),
        () => "loading"
      );

      createRenderEffect(
        () => (result = boundary()),
        () => {}
      );
    });

    flush();
    expect(result).toBe("loading");

    resolve();
    setShowAsync(false);
    flush();

    expect(result).toBe("sync");
  });
});
