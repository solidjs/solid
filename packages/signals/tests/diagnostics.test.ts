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
  onSettled,
  refresh,
  resetErrorHalt,
  runWithOwner,
  untrack
} from "../src/index.js";

// Several diagnostics are escaping errors, which halt the reactive system.
afterEach(() => {
  resetErrorHalt();
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

  it("emits diagnostics before owned-scope signal write errors", () => {
    const capture = DEV!.diagnostics.capture();

    createRoot(() => {
      const [count, setCount] = createSignal(0, { name: "count" });
      const memo = createMemo(() => {
        setCount(1);
        return count();
      });
      expect(() => memo()).toThrow(/Writing to reactive state inside an owned scope/);
    });

    const events = capture.stop();
    expect(events).toHaveLength(1);
    expect(events[0].code).toBe("REACTIVE_WRITE_IN_OWNED_SCOPE");
    expect(events[0].severity).toBe("error");
    expect(events[0].nodeName).toBe("count");
    expect(events[0].data?.operation).toBe("setSignal");
  });

  it("emits diagnostics before owned-scope refresh errors", () => {
    const capture = DEV!.diagnostics.capture();

    createRoot(() => {
      const target = createMemo(() => 1, { name: "target" });
      const memo = createMemo(() => {
        refresh(target);
        return target();
      });
      expect(() => memo()).toThrow(/Calling refresh\(\) inside an owned scope/);
    });

    const events = capture.stop();
    expect(events).toHaveLength(1);
    expect(events[0].code).toBe("REACTIVE_WRITE_IN_OWNED_SCOPE");
    expect(events[0].severity).toBe("error");
    expect(events[0].nodeName).toBe("target");
    expect(events[0].data?.operation).toBe("refresh");
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
    // The escaped error also halts the reactive system, emitting a second
    // diagnostic on its way out.
    expect(events).toHaveLength(2);
    expect(events[0].code).toBe("CLEANUP_IN_FORBIDDEN_SCOPE");
    expect(events[0].severity).toBe("error");
    expect(events[1].code).toBe("REACTIVITY_HALTED");
  });

  it("emits a diagnostic and throws when onSettled returns a cleanup in an unowned scope", () => {
    const capture = DEV!.diagnostics.capture();

    onSettled(() => () => {});
    expect(() => flush()).toThrow(/\[SETTLED_CLEANUP_UNOWNED\]/);

    const events = capture.stop();
    expect(events).toHaveLength(1);
    expect(events[0].code).toBe("SETTLED_CLEANUP_UNOWNED");
    expect(events[0].severity).toBe("error");
    expect(events[0].kind).toBe("lifecycle");
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

  it("emits a diagnostic when a sync: true memo returns a Promise", () => {
    const capture = DEV!.diagnostics.capture();

    expect(() =>
      createRoot(() => {
        const m = createMemo(() => Promise.resolve(1) as any, { sync: true, name: "asyncMemo" });
        m();
      })
    ).toThrow(/SYNC_NODE_RECEIVED_ASYNC.*returned a Promise/);

    const events = capture.stop();
    const event = events.find(e => e.code === "SYNC_NODE_RECEIVED_ASYNC");
    expect(event).toBeDefined();
    expect(event!.severity).toBe("error");
    expect(event!.kind).toBe("lifecycle");
  });

  it("emits a diagnostic when a sync: true memo returns an AsyncIterable", () => {
    const capture = DEV!.diagnostics.capture();

    async function* gen() {
      yield 1;
    }

    expect(() =>
      createRoot(() => {
        const m = createMemo(() => gen() as any, { sync: true, name: "asyncIterMemo" });
        m();
      })
    ).toThrow(/SYNC_NODE_RECEIVED_ASYNC.*returned an AsyncIterable/);

    const events = capture.stop();
    const event = events.find(e => e.code === "SYNC_NODE_RECEIVED_ASYNC");
    expect(event).toBeDefined();
    expect(event!.severity).toBe("error");
  });

  it("does not flag plain objects from sync: true memos", () => {
    const capture = DEV!.diagnostics.capture();

    createRoot(() => {
      const m = createMemo(() => ({ value: 1 }), { sync: true });
      expect(m()).toEqual({ value: 1 });
    });

    const events = capture.stop();
    expect(events.find(e => e.code === "SYNC_NODE_RECEIVED_ASYNC")).toBeUndefined();
  });
});
