import { afterEach, describe, expect, test, vi } from "vitest";

type Solid = typeof import("../src/index.js");

const MESSAGE = "You appear to have multiple instances of Solid";

/** A fresh, separate copy of solid-js (and its own @solidjs/signals). */
async function loadCopy(): Promise<Solid> {
  vi.resetModules();
  return import("../src/index.js");
}

/** Starts from a page where no 2.x copy has loaded yet. */
function forgetCopies(): void {
  delete globalThis.Solid$$copies;
}

function duplicateWarnings(warn: { mock: { calls: unknown[][] } }) {
  return warn.mock.calls.filter(args => String(args[0]).includes(MESSAGE));
}

afterEach(() => {
  vi.restoreAllMocks();
  if (globalThis.Solid$$copies) globalThis.Solid$$copies.running = undefined;
});

describe("multiple instance check", () => {
  test("a lone copy never writes the shared slot until a second copy loads", async () => {
    forgetCopies();
    const a = await loadCopy();
    const seen: unknown[] = [];
    const render = () =>
      a.createRoot(dispose => {
        a.createComponent(() => {
          seen.push(globalThis.Solid$$copies?.running);
          return null as any;
        }, {});
        dispose();
      });
    render();
    expect(seen).toEqual([undefined]);
    await loadCopy();
    render();
    expect(seen[1]).toBeDefined();
    expect(globalThis.Solid$$copies?.running).toBeUndefined();
  });

  test("any copy that follows the shared record's contract is caught, whatever its version", async () => {
    // A stand-in for a later Solid: it only counts itself in and names itself
    // as running, as the contract in @solidjs/signals core/copies.ts says.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    forgetCopies();
    const a = await loadCopy();
    const [count] = a.createSignal(0);
    const record = globalThis.Solid$$copies!;
    record.copies++;
    const prev = record.running;
    record.running = { rooted: false };
    count();
    record.running = prev;
    record.copies--;
    expect(duplicateWarnings(warn)).toHaveLength(1);
  });

  test("loading two copies does not warn by itself, and leaves v1's Solid$$ alone", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    delete (globalThis as any).Solid$$;
    await loadCopy();
    await loadCopy();
    expect(duplicateWarnings(warn)).toHaveLength(0);
    expect((globalThis as any).Solid$$).toBeUndefined();
  });

  test("an isolated copy rendering its own root inside another copy's component stays quiet", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = await loadCopy();
    const b = await loadCopy();
    a.createRoot(dispose => {
      a.createComponent(() => {
        b.createRoot(disposeB => {
          b.createComponent(() => null as any, {});
          disposeB();
        });
        return null as any;
      }, {});
      dispose();
    });
    expect(duplicateWarnings(warn)).toHaveLength(0);
  });

  test("a component from another copy rendered inside this copy's tree warns once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = await loadCopy();
    const b = await loadCopy();
    a.createRoot(dispose => {
      a.createComponent(() => {
        b.createComponent(() => null as any, {});
        b.createComponent(() => null as any, {});
        return null as any;
      }, {});
      dispose();
    });
    expect(duplicateWarnings(warn)).toHaveLength(1);
  });

  test("useContext from another copy inside this copy's component warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = await loadCopy();
    const b = await loadCopy();
    const Ctx = b.createContext("default");
    a.createRoot(dispose => {
      a.createComponent(() => {
        try {
          b.useContext(Ctx);
        } catch {}
        return null as any;
      }, {});
      dispose();
    });
    expect(duplicateWarnings(warn)).toHaveLength(1);
  });

  test("nested components of one copy never warn", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = await loadCopy();
    a.createRoot(dispose => {
      a.createComponent(() => a.createComponent(() => null as any, {}), {});
      dispose();
    });
    expect(duplicateWarnings(warn)).toHaveLength(0);
    expect(globalThis.Solid$$copies?.running).toBeUndefined();
  });

  test("precompiled JSX on another copy reading this copy's signal warns", async () => {
    // The library's render effect runs on copy B (which never renders by
    // itself); the prop getter reads the app's signal on copy A.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const app = await loadCopy();
    const lib = await loadCopy();
    app.createRoot(dispose => {
      const [count] = app.createSignal(0);
      const props = {
        get count() {
          return count();
        }
      };
      app.createComponent(() => {
        lib.createRenderEffect(
          () => props.count,
          () => {}
        );
        return null as any;
      }, {});
      dispose();
    });
    expect(duplicateWarnings(warn)).toHaveLength(1);
  });

  test("a runtime that bundled its own copy reading the app's store warns", async () => {
    // The runtime copy renders (it owns the root); the app's copy never does.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const app = await loadCopy();
    const runtime = await loadCopy();
    const [state] = app.createStore({ n: 1 });
    runtime.createRoot(dispose => {
      runtime.createRenderEffect(
        () => state.n,
        () => {}
      );
      dispose();
    });
    expect(duplicateWarnings(warn)).toHaveLength(1);
  });

  test("an app computation calling into an isolated, rooted copy's API stays quiet", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const app = await loadCopy();
    const panel = await loadCopy();
    const [panelState] = panel.createRoot(() => panel.createSignal("idle"));
    const panelApi = { status: () => panel.untrack(panelState) };
    app.createRoot(dispose => {
      const [count] = app.createSignal(0);
      app.createRenderEffect(
        () => (count(), panelApi.status()),
        () => {}
      );
      dispose();
    });
    expect(duplicateWarnings(warn)).toHaveLength(0);
  });

  test("untracked reads inside one copy's own computation never warn", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = await loadCopy();
    a.createRoot(dispose => {
      const [x] = a.createSignal(1);
      const [y] = a.createSignal(2);
      a.createRenderEffect(
        () => x() + a.untrack(y),
        () => {}
      );
      dispose();
    });
    expect(duplicateWarnings(warn)).toHaveLength(0);
    expect(globalThis.Solid$$copies?.running).toBeUndefined();
  });
});
