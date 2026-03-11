import {
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "../src/index.js";

afterEach(() => flush());

describe("createLoadingBoundary with on option", () => {
  it("shows fallback when on-value changes and data is pending", async () => {
    let result: any;
    const [$id, setId] = createSignal("a");

    createRoot(() => {
      const data = createMemo(async () => {
        const id = $id();
        await Promise.resolve();
        return `data-${id}`;
      });

      const boundary = createLoadingBoundary(
        () => data(),
        () => "loading",
        { on: $id }
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
    expect(result).toBe("data-a");

    setId("b");
    flush();
    expect(result).toBe("loading");

    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(result).toBe("data-b");
  });

  it("does not show fallback when on-value is unchanged (stale content during transition)", async () => {
    let result: any;
    const [$id, setId] = createSignal("a");
    const [$extra, setExtra] = createSignal(0);

    createRoot(() => {
      const data = createMemo(async () => {
        const id = $id();
        const extra = $extra();
        await Promise.resolve();
        return `data-${id}-${extra}`;
      });

      const boundary = createLoadingBoundary(
        () => data(),
        () => "loading",
        { on: $id }
      );

      createRenderEffect(
        () => (result = boundary()),
        () => {}
      );
    });

    flush();
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(result).toBe("data-a-0");

    setExtra(1);
    flush();
    expect(result).toBe("data-a-0");

    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(result).toBe("data-a-1");
  });

  it("does not show fallback when on-value changes but data is not pending", () => {
    let result: any;
    const [$id, setId] = createSignal("a");

    createRoot(() => {
      const data = createMemo(() => `sync-${$id()}`);

      const boundary = createLoadingBoundary(
        () => data(),
        () => "loading",
        { on: $id }
      );

      createRenderEffect(
        () => (result = boundary()),
        () => {}
      );
    });

    flush();
    expect(result).toBe("sync-a");

    setId("b");
    flush();
    expect(result).toBe("sync-b");
  });

  it("handles rapid on-value changes", async () => {
    let result: any;
    const [$id, setId] = createSignal("a");

    createRoot(() => {
      const data = createMemo(async () => {
        const id = $id();
        await Promise.resolve();
        return `data-${id}`;
      });

      const boundary = createLoadingBoundary(
        () => data(),
        () => "loading",
        { on: $id }
      );

      createRenderEffect(
        () => (result = boundary()),
        () => {}
      );
    });

    flush();
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(result).toBe("data-a");

    setId("b");
    flush();
    expect(result).toBe("loading");

    setId("c");
    flush();
    expect(result).toBe("loading");

    setId("d");
    flush();
    expect(result).toBe("loading");

    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(result).toBe("data-d");
  });

  it("split async: boundary-caught does not hold transition for outside async", async () => {
    let boundaryResult: any;
    let outsideResult: any;
    const [$id, setId] = createSignal("a");

    createRoot(() => {
      const fast = createMemo(async () => {
        const id = $id();
        await Promise.resolve();
        return `fast-${id}`;
      });

      const slow = createMemo(async () => {
        const id = $id();
        await Promise.resolve();
        await Promise.resolve();
        return `slow-${id}`;
      });

      const boundary = createLoadingBoundary(
        () => slow(),
        () => "b-loading",
        { on: $id }
      );

      createRenderEffect(
        () => (outsideResult = fast()),
        () => {}
      );
      createRenderEffect(
        () => (boundaryResult = boundary()),
        () => {}
      );
    });

    flush();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(outsideResult).toBe("fast-a");
    expect(boundaryResult).toBe("slow-a");

    setId("b");
    flush();

    expect(boundaryResult).toBe("b-loading");

    // Fast resolves — transition should complete
    await Promise.resolve();
    await Promise.resolve();
    flush();

    expect(outsideResult).toBe("fast-b");
    expect(boundaryResult).toBe("b-loading");

    // Slow resolves
    await Promise.resolve();
    flush();
    expect(boundaryResult).toBe("slow-b");
  });

  it("handles async on source (on getter reads pending memo)", async () => {
    let result: any;
    const [$trigger, setTrigger] = createSignal(0);

    createRoot(() => {
      const model = createMemo(async () => {
        const t = $trigger();
        await Promise.resolve();
        return { id: t, label: `item-${t}` };
      });

      const boundary = createLoadingBoundary(
        () => model().label,
        () => "loading",
        { on: () => model().id }
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
    expect(result).toBe("item-0");

    setTrigger(1);
    flush();
    expect(result).toBe("loading");

    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(result).toBe("item-1");
  });

  it("multiple boundaries — one with on resets, sibling without on shows stale", async () => {
    let resultA: any;
    let resultB: any;
    const [$id, setId] = createSignal("a");

    createRoot(() => {
      const dataA = createMemo(async () => {
        const id = $id();
        await Promise.resolve();
        return `A-${id}`;
      });
      const dataB = createMemo(async () => {
        const id = $id();
        await Promise.resolve();
        return `B-${id}`;
      });

      const boundaryA = createLoadingBoundary(
        () => dataA(),
        () => "loading-A",
        { on: $id }
      );
      const boundaryB = createLoadingBoundary(
        () => dataB(),
        () => "loading-B"
      );

      createRenderEffect(
        () => (resultA = boundaryA()),
        () => {}
      );
      createRenderEffect(
        () => (resultB = boundaryB()),
        () => {}
      );
    });

    flush();
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(resultA).toBe("A-a");
    expect(resultB).toBe("B-a");

    setId("b");
    flush();

    expect(resultA).toBe("loading-A");
    expect(resultB).toBe("B-a");

    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(resultA).toBe("A-b");
    expect(resultB).toBe("B-b");
  });
});
