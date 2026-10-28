import { afterEach, describe, expect, test, vi } from "vitest";

type Solid = typeof import("../src/index.js");

const MESSAGE = "You appear to have multiple instances of Solid";

/** A fresh, separate copy of solid-js (and its own @solidjs/signals). */
async function loadCopy(): Promise<Solid> {
  vi.resetModules();
  return import("../src/index.js");
}

function duplicateWarnings(warn: ReturnType<typeof vi.spyOn>) {
  return warn.mock.calls.filter(args => String(args[0]).includes(MESSAGE));
}

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.Solid$$running = undefined;
});

describe("multiple instance check", () => {
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
    expect(globalThis.Solid$$running).toBeUndefined();
  });
});
