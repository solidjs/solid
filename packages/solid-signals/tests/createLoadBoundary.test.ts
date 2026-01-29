import {
  createLoadBoundary,
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  NotReadyError
} from "../src/index.js";

describe("createLoadBoundary", () => {
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

      const boundary = createLoadBoundary(
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

      const boundary = createLoadBoundary(
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

      const boundary1 = createLoadBoundary(
        () => proj.a,
        () => "loading"
      );
      const boundary2 = createLoadBoundary(
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

      const outer = createLoadBoundary(
        () => {
          const inner = createLoadBoundary(
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

      const boundary = createLoadBoundary(
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

      const boundary = createLoadBoundary(
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
});
