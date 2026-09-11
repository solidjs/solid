import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEffect,
  createLoadingBoundary,
  createMemo,
  createRoot,
  createSignal,
  createTrackedEffect,
  flush,
  getOwner,
  onCleanup,
  onSettled,
  refresh,
  resetErrorHalt,
  runWithOwner,
  untrack,
  DEV,
  OBSERVE
} from "../src/index.js";
import { emitDiagnostic, ownerPath, reportDiagnostic } from "../src/core/dev.js";

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
    const unsubscribe = OBSERVE!.diagnostics.subscribe(event => events.push(event));

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
    const capture = OBSERVE!.diagnostics.capture();

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
    const capture = OBSERVE!.diagnostics.capture();

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
    const capture = OBSERVE!.diagnostics.capture();

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
    const capture = OBSERVE!.diagnostics.capture();

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
    const capture = OBSERVE!.diagnostics.capture();

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
    const capture = OBSERVE!.diagnostics.capture();
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
    const capture = OBSERVE!.diagnostics.capture();

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
    const capture = OBSERVE!.diagnostics.capture();

    onSettled(() => () => {});
    expect(() => flush()).toThrow(/\[SETTLED_CLEANUP_UNOWNED\]/);

    const events = capture.stop();
    expect(events).toHaveLength(1);
    expect(events[0].code).toBe("SETTLED_CLEANUP_UNOWNED");
    expect(events[0].severity).toBe("error");
    expect(events[0].kind).toBe("lifecycle");
  });

  it("emits a diagnostic and throws when createEffect is called without an effect function", () => {
    const capture = OBSERVE!.diagnostics.capture();

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
    const capture = OBSERVE!.diagnostics.capture();

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
    const capture = OBSERVE!.diagnostics.capture();

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
    const capture = OBSERVE!.diagnostics.capture();

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
    const capture = OBSERVE!.diagnostics.capture();

    createRoot(() => {
      const m = createMemo(() => ({ value: 1 }), { sync: true });
      expect(m()).toEqual({ value: 1 });
    });

    const events = capture.stop();
    expect(events.find(e => e.code === "SYNC_NODE_RECEIVED_ASYNC")).toBeUndefined();
  });
});

describe("diagnostics console footer", () => {
  afterEach(() => {
    DEV!.setConsoleFooter(undefined);
  });

  const warnTexts = (warn: { mock: { calls: unknown[][] } }) =>
    warn.mock.calls.map(args => String(args[0]));

  it("folds the footer into the first reported console entry of each code — one entry per finding", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    DEV!.setConsoleFooter(event => `footer:${event.code}`);

    reportDiagnostic(
      emitDiagnostic({
        code: "STRICT_READ_UNTRACKED",
        kind: "strict-read",
        severity: "warn",
        message: "one"
      })
    );
    reportDiagnostic(
      emitDiagnostic({
        code: "STRICT_READ_UNTRACKED",
        kind: "strict-read",
        severity: "warn",
        message: "two"
      })
    );
    reportDiagnostic(
      emitDiagnostic({ code: "HOT_SCOPE_RERUNS", kind: "perf", severity: "warn", message: "three" })
    );
    await Promise.resolve();

    // Exactly one console entry per report; the footer rides the first entry
    // of its code as a trailing line and never appears on its own.
    expect(warnTexts(warn)).toEqual([
      "one\nfooter:STRICT_READ_UNTRACKED",
      "two",
      "three\nfooter:HOT_SCOPE_RERUNS"
    ]);
  });

  it("defers the footer to a follow-up line only for thrown (unreported) errors", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    DEV!.setConsoleFooter(event => `footer:${event.code}`);

    // A throw site: emits, then throws the message — never reports.
    emitDiagnostic({
      code: "MISSING_EFFECT_FN",
      kind: "lifecycle",
      severity: "error",
      message: "thrown"
    });
    // An advisory event is structured-channel only: no console, no footer.
    emitDiagnostic({ code: "ASYNC_WATERFALL", kind: "perf", severity: "info", message: "quiet" });
    expect(warnTexts(warn)).toEqual([]);
    await Promise.resolve();
    expect(warnTexts(warn)).toEqual(["footer:MISSING_EFFECT_FN"]);
  });

  it("does not double-print when a reported error's microtask runs after the report", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    DEV!.setConsoleFooter(event => `footer:${event.code}`);

    reportDiagnostic(
      emitDiagnostic({
        code: "INVARIANT_VIOLATION",
        kind: "error",
        severity: "error",
        message: "bad"
      })
    );
    await Promise.resolve();

    expect(error.mock.calls.map(args => String(args[0]))).toEqual([
      "bad\nfooter:INVARIANT_VIOLATION"
    ]);
    expect(warnTexts(warn)).toEqual([]);
  });

  it("suppresses the footer when the callback returns undefined", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    DEV!.setConsoleFooter(() => undefined);

    reportDiagnostic(
      emitDiagnostic({
        code: "STRICT_READ_UNTRACKED",
        kind: "strict-read",
        severity: "warn",
        message: "one"
      })
    );
    await Promise.resolve();

    expect(warnTexts(warn)).toEqual(["one"]);
  });

  it("re-registering resets the once-per-code memory", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    DEV!.setConsoleFooter(() => "footer:first");
    reportDiagnostic(
      emitDiagnostic({
        code: "STRICT_READ_UNTRACKED",
        kind: "strict-read",
        severity: "warn",
        message: "one"
      })
    );
    DEV!.setConsoleFooter(() => "footer:second");
    reportDiagnostic(
      emitDiagnostic({
        code: "STRICT_READ_UNTRACKED",
        kind: "strict-read",
        severity: "warn",
        message: "two"
      })
    );
    await Promise.resolve();

    expect(warnTexts(warn)).toEqual(["one\nfooter:first", "two\nfooter:second"]);
  });
});

describe("diagnostics owner path", () => {
  // Stand-in for solid-js's observedComponent, which labels each component root.
  const nameOwner = (name: string) => ((getOwner() as any)._name = name);

  it("walks from a computation up through named owners, root first, skipping unnamed roots", () => {
    let leaf: any;
    createRoot(() => {
      nameOwner("<App>");
      createRoot(() => {
        // An unnamed intermediate root (a mapArray item scope, say) is skipped.
        createMemo(
          () => {
            nameOwner("<TodoRow>"); // a computed is itself an owner; renaming it here
            createMemo(
              () => {
                leaf = getOwner(); // inside its fn, the memo node is the owner
                return 1;
              },
              { name: "label" }
            )();
            return 1;
          },
          { name: "row" }
        );
      });
    });
    flush();
    expect(ownerPath(leaf)).toEqual(["<App>", "<TodoRow>", "label"]);
  });

  it("locates a signal through its registering owner and stamps the path on the event", () => {
    let node: any;
    createRoot(() => {
      nameOwner("<Counter>");
      createSignal(0, { name: "count" });
      node = DEV!.getSignals(getOwner()!)[0];
    });
    // No ambient context here: the event locates via the explicit subject.
    const event = emitDiagnostic(
      { code: "WIDE_WRITE", kind: "perf", severity: "warn", message: "m" },
      node
    );
    // A signal is not itself an owner; its path is its registering owner's.
    expect(event.ownerPath).toEqual(["<Counter>"]);
    expect(ownerPath(undefined)).toBeUndefined();
    expect(ownerPath(null)).toBeUndefined();
  });

  it("defaults the subject to the ambient context and omits the path when there is none", () => {
    let inside: ReturnType<typeof emitDiagnostic> | undefined;
    createRoot(() => {
      (getOwner() as any)._name = "<App>";
      createEffect(
        () => {
          inside = emitDiagnostic({
            code: "STRICT_READ_UNTRACKED",
            kind: "strict-read",
            severity: "warn",
            message: "m"
          });
          return 1;
        },
        () => {},
        { name: "body" }
      );
    });
    flush();
    expect(inside!.ownerPath).toEqual(["<App>", "body"]);

    const outside = emitDiagnostic({
      code: "NO_OWNER_CLEANUP",
      kind: "lifecycle",
      severity: "warn",
      message: "m"
    });
    expect(outside.ownerPath).toBeUndefined();
  });

  it("reportDiagnostic prints the path as an `in` line under the message", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    createRoot(() => {
      (getOwner() as any)._name = "<App>";
      createEffect(
        () => {
          reportDiagnostic(
            emitDiagnostic({
              code: "STRICT_READ_UNTRACKED",
              kind: "strict-read",
              severity: "warn",
              message: "[STRICT_READ_UNTRACKED] m"
            })
          );
          return 1;
        },
        () => {},
        { name: "body" }
      );
    });
    flush();
    expect(warn.mock.calls.map(args => String(args[0]))).toEqual([
      "[STRICT_READ_UNTRACKED] m\n  in <App> › body"
    ]);
    warn.mockRestore();
  });
});
