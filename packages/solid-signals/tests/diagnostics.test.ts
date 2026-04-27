import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEffect,
  createLoadingBoundary,
  createMemo,
  createRoot,
  createSignal,
  createTrackedEffect,
  DEV,
  flush,
  getOwner,
  onCleanup,
  runWithOwner,
  untrack
} from "../src/index.js";

afterEach(() => {
  flush();
  vi.restoreAllMocks();
});

describe("diagnostics", () => {
  it("supports subscribe for strict-read warnings", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const events: any[] = [];
    const unsubscribe = DEV!.diagnostics.subscribe(event => events.push(event));

    createRoot(() => {
      const [count] = createSignal(1, { name: "count" });
      untrack(() => count(), "TestComponent");
    });

    unsubscribe();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
    expect(events[0].code).toBe("STRICT_READ_UNTRACKED");
    expect(events[0].severity).toBe("warn");
    expect(events[0].data?.strictRead).toBe("TestComponent");
  });

  it("supports capture buffers", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const capture = DEV!.diagnostics.capture();

    onCleanup(() => {});

    expect(capture.events).toHaveLength(1);
    expect(capture.events[0].code).toBe("NO_OWNER_CLEANUP");
    expect(capture.events[0].severity).toBe("warn");
    expect(warn).toHaveBeenCalledTimes(1);

    capture.clear();
    expect(capture.events).toHaveLength(0);

    const stopped = capture.stop();
    expect(stopped).toEqual([]);
  });

  it("emits diagnostics before owned-scope write errors", () => {
    const capture = DEV!.diagnostics.capture();

    createRoot(() => {
      const [count, setCount] = createSignal(0, { name: "count" });
      const memo = createMemo(() => {
        setCount(1);
        return count();
      });
      expect(() => memo()).toThrow(/Writing to a Signal inside an owned scope/);
    });

    const events = capture.stop();
    expect(events).toHaveLength(1);
    expect(events[0].code).toBe("SIGNAL_WRITE_IN_OWNED_SCOPE");
    expect(events[0].severity).toBe("error");
    expect(events[0].nodeName).toBe("count");
  });

  it("emits diagnostics for effects created without an owner", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const capture = DEV!.diagnostics.capture();

    createEffect(
      () => 1,
      () => {}
    );

    const events = capture.stop();
    expect(events).toHaveLength(1);
    expect(events[0].code).toBe("NO_OWNER_EFFECT");
    expect(events[0].data?.effectType).toBe("effect");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("emits diagnostics for boundaries created without an owner", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const capture = DEV!.diagnostics.capture();

    const read = createLoadingBoundary(
      () => "ready",
      () => "fallback"
    );
    expect(read()).toBe("ready");

    const events = capture.stop();
    expect(events).toHaveLength(1);
    expect(events[0].code).toBe("NO_OWNER_BOUNDARY");
    expect(events[0].data?.boundaryType).toBe("loading");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("emits diagnostics for disposed owners passed to runWithOwner", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const capture = DEV!.diagnostics.capture();
    let owner = null as ReturnType<typeof getOwner>;

    const dispose = createRoot(dispose => {
      owner = getOwner();
      return dispose;
    });
    dispose();

    runWithOwner(owner, () => undefined);

    const events = capture.stop();
    expect(events).toHaveLength(1);
    expect(events[0].code).toBe("RUN_WITH_DISPOSED_OWNER");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("emits diagnostics before forbidden cleanup-scope errors", () => {
    const capture = DEV!.diagnostics.capture();

    createRoot(() => {
      createTrackedEffect(() => {
        onCleanup(() => {});
      });
    });
    expect(() => flush()).toThrow(/Cannot use onCleanup inside createTrackedEffect or onSettled/);

    const events = capture.stop();
    expect(events).toHaveLength(1);
    expect(events[0].code).toBe("CLEANUP_IN_FORBIDDEN_SCOPE");
    expect(events[0].severity).toBe("error");
  });

  it("emits a diagnostic and throws when createEffect is called without an effect function", () => {
    const capture = DEV!.diagnostics.capture();

    createRoot(() => {
      expect(() => createEffect(() => 1)).toThrow(
        /createEffect requires both a compute function and an effect function/
      );
    });

    const events = capture.stop();
    expect(events).toHaveLength(1);
    expect(events[0].code).toBe("MISSING_EFFECT_FN");
    expect(events[0].severity).toBe("error");
    expect(events[0].kind).toBe("lifecycle");
  });

  it("emits a diagnostic before throwing on reactive primitive creation in a forbidden scope", () => {
    const capture = DEV!.diagnostics.capture();

    createRoot(() => {
      createTrackedEffect(() => {
        expect(() => createMemo(() => 1)).toThrow(
          /Cannot create reactive primitives inside createTrackedEffect or owner-backed onSettled/
        );
      });
    });
    flush();

    const events = capture.stop();
    const primitive = events.find(e => e.code === "PRIMITIVE_IN_FORBIDDEN_SCOPE");
    expect(primitive).toBeDefined();
    expect(primitive!.severity).toBe("error");
    expect(primitive!.kind).toBe("lifecycle");
  });
});
