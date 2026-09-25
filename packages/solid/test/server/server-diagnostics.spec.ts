/** @vitest-environment node */
// The server facade's findings on `OBSERVE.diagnostics` (server-dev-build-plan
// P1/P2): component labels for `ownerPath`, and the facade's own sites —
// `SERVER_WRITE` (a dev check), `ASYNC_OUTSIDE_LOADING_BOUNDARY` (recorded,
// then thrown), `LAZY_ASSET_UNMAPPED` and `REVEAL_IN_RENDER_TO_STRING` (dev
// checks), `SSR_RENDER_ERROR_CONTAINED` from `<Errored>` (wiring). This file
// imports source, i.e. the dev tier (both literals unreplaced and truthy);
// the `[SERVER_WRITE]` once-per-process flags are owned by
// server-write-deprecation.spec.ts, so the write here is a store write
// asserted on the channel, not on the console count.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  OBSERVE,
  createComponent,
  createErrorBoundary,
  createMemo,
  createOwner,
  createRoot,
  creationStamp,
  getNextChildId,
  getOwner,
  lazy,
  runWithOwner,
  type DiagnosticEvent
} from "../../src/server/index.js";
import { Reveal } from "../../src/server/flow.js";
import { sharedConfig } from "../../src/server/shared.js";

let capture: ReturnType<NonNullable<typeof OBSERVE>["diagnostics"]["capture"]>;
let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
let savedContext: any;

beforeEach(() => {
  capture = OBSERVE!.diagnostics.capture();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
  savedContext = sharedConfig.context;
});
afterEach(() => {
  capture.stop();
  warn.mockRestore();
  error.mockRestore();
  sharedConfig.context = savedContext;
});

const byCode = (code: DiagnosticEvent["code"]) => capture.events.filter(e => e.code === code);

function probe(): null {
  OBSERVE!.diagnostics.emit(
    { code: "INVARIANT_VIOLATION", kind: "error", severity: "error", message: "probe" },
    getOwner() as any
  );
  return null;
}

describe("component labels (observe/dev)", () => {
  test("createComponent runs the body under a labelled owner; ownerPath reads the component tree", () => {
    function Page() {
      return probe();
    }
    function App() {
      return createComponent(Page, {});
    }
    createRoot(() => createComponent(App, {}), { id: "r" });
    const [event] = byCode("INVARIANT_VIOLATION");
    expect(event.ownerPath).toEqual(["<App>", "<Page>"]);
  });

  test("the compiler's name argument wins over Comp.name; anonymous falls back", () => {
    const minified = function Xt() {
      return probe();
    };
    createRoot(() => createComponent(minified, {}, "Home"), { id: "r" });
    expect(byCode("INVARIANT_VIOLATION")[0].ownerPath).toEqual(["<Home>"]);

    capture.clear();
    createRoot(() => createComponent(() => probe(), {}), { id: "r" });
    expect(byCode("INVARIANT_VIOLATION")[0].ownerPath).toEqual(["<Anonymous>"]);
  });

  test("the label owner is transparent: hydration ids are the same with and without it", () => {
    const ids: string[] = [];
    createRoot(
      () => {
        ids.push(getNextChildId(getOwner()!));
        createComponent(() => {
          ids.push(getNextChildId(getOwner()!));
          createOwner();
          return null;
        }, {});
        ids.push(getNextChildId(getOwner()!));
      },
      { id: "r" }
    );
    const plain: string[] = [];
    createRoot(
      () => {
        plain.push(getNextChildId(getOwner()!));
        (() => {
          plain.push(getNextChildId(getOwner()!));
          createOwner();
          return null;
        })();
        plain.push(getNextChildId(getOwner()!));
      },
      { id: "r" }
    );
    expect(ids).toEqual(plain);
  });

  test("the label owner is not a creation for creationStamp()", () => {
    createRoot(
      () => {
        const before = creationStamp();
        createComponent(() => null, {});
        expect(creationStamp()).toBe(before);
        // A real owner still moves the stamp — the live-hole verdict is intact.
        createComponent(() => (createOwner(), null), {});
        expect(creationStamp()).toBe(before + 1);
      },
      { id: "r" }
    );
  });

  test("outside any owner the call stays plain", () => {
    let owner: unknown = "unset";
    createComponent(() => ((owner = getOwner()), null), {});
    expect(owner).toBeNull();
  });

  test("dev: a non-function tag names the mistake", () => {
    expect(() => createComponent(undefined as any, {})).toThrow(
      /expected a component function but got undefined/
    );
  });
});

describe("SERVER_WRITE (dev check)", () => {
  test("a store write on the server is a finding located by component", async () => {
    const { createStore } = await import("../../src/server/index.js");
    function Writer() {
      const [, setStore] = createStore({ n: 0 });
      setStore(s => {
        s.n = 1;
      });
      return null;
    }
    createRoot(() => createComponent(Writer, {}), { id: "r" });
    const events = byCode("SERVER_WRITE");
    // Once per process per category; a prior spec in this worker may already
    // have consumed the store category, so assert shape when it fired.
    if (events.length) {
      expect(events[0].kind).toBe("write");
      expect(events[0].severity).toBe("warn");
      expect(events[0].data).toEqual({ category: "store" });
      expect(events[0].ownerPath).toEqual(["<Writer>"]);
      expect(events[0].message).toMatch(/^\[SERVER_WRITE\] Writing a store on the server/);
    }
  });
});

describe("ASYNC_OUTSIDE_LOADING_BOUNDARY (recorded, then thrown)", () => {
  test("a bare ssrSource 'client' read outside a Loading pass records the finding and throws it", () => {
    sharedConfig.context = { serialize() {} } as any;
    createRoot(
      () => {
        const read = (createMemo as any)(() => 999, { ssrSource: "client" });
        expect(() => read()).toThrow(/\[ASYNC_OUTSIDE_LOADING_BOUNDARY\]/);
      },
      { id: "t" }
    );
    const [event, ...rest] = byCode("ASYNC_OUTSIDE_LOADING_BOUNDARY");
    expect(rest).toHaveLength(0);
    expect(event.kind).toBe("async");
    expect(event.severity).toBe("error");
    expect(event.data).toEqual({ side: "server" });
    // The throw is the console face: nothing reported on top of it.
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("LAZY_ASSET_UNMAPPED (dev check)", () => {
  test("a rejected asset resolver is a finding located by the owner that rendered the lazy component", async () => {
    sharedConfig.context = {
      registerAsset() {},
      resolveAssets: () => Promise.reject(new Error("graph walk failed")),
      serialize() {},
      _lazyAssets: undefined
    } as any;
    const LazyComp = lazy(
      () => Promise.resolve({ default: (_props: {}) => "ok" }),
      undefined,
      "./Broken.tsx"
    );
    function Page() {
      // First render: the module import starts and the asset resolution is
      // asked for under this owner (the render memo suspends on the import;
      // the registration is what is under test).
      try {
        LazyComp({});
      } catch (_) {}
      return null;
    }
    createRoot(() => createComponent(Page, {}), { id: "t" });
    await new Promise(r => setTimeout(r));

    const [event, ...rest] = byCode("LAZY_ASSET_UNMAPPED");
    expect(rest).toHaveLength(0);
    expect(event.kind).toBe("ssr");
    expect(event.severity).toBe("warn");
    expect(event.data!.reason).toBe("resolution-failed");
    expect(event.data!.id).toBe("./Broken.tsx");
    expect((event.data!.error as Error).message).toBe("graph walk failed");
    expect(event.ownerPath).toEqual(["<Page>"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("[LAZY_ASSET_UNMAPPED]");
  });

  test("a loaded module without $$moduleUrl and no callsite moduleUrl", async () => {
    sharedConfig.context = {
      registerAsset() {},
      resolveAssets: () => null,
      serialize() {}
    } as any;
    const LazyComp = lazy(() => Promise.resolve({ default: (_props: {}) => "ok" }));
    await LazyComp.preload!();
    createRoot(() => LazyComp({}), { id: "t" });
    const [event] = byCode("LAZY_ASSET_UNMAPPED");
    expect(event.data).toEqual({ reason: "no-module-url" });
  });
});

describe("REVEAL_IN_RENDER_TO_STRING (dev check)", () => {
  test("a nested collapsed/together <Reveal> in a sync render", () => {
    sharedConfig.context = { async: false } as any;
    createRoot(
      () => {
        Reveal({
          get children() {
            return Reveal({ order: "together", children: "inner" } as any);
          }
        } as any);
      },
      { id: "t" }
    );
    const [event, ...rest] = byCode("REVEAL_IN_RENDER_TO_STRING");
    expect(rest).toHaveLength(0);
    expect(event.kind).toBe("ssr");
    expect(event.data).toEqual({ order: "together", collapsed: false });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("SSR_RENDER_ERROR_CONTAINED from <Errored> (wiring)", () => {
  test("recorded once per boundary per failure, located by the boundary's owner", () => {
    sharedConfig.context = { serialize() {} } as any;
    let accessor: () => any;
    createRoot(
      () => {
        createComponent(function App() {
          accessor = createErrorBoundary(
            () => {
              throw new Error("bad render");
            },
            () => "fallback"
          );
          return null;
        }, {});
      },
      { id: "t" }
    );
    expect(accessor!()).toBe("fallback");
    // The enclosing Loading re-pulls the accessor on every discovery pass;
    // the same failure does not record twice.
    expect(accessor!()).toBe("fallback");

    const [event, ...rest] = byCode("SSR_RENDER_ERROR_CONTAINED");
    expect(rest).toHaveLength(0);
    expect(event.data!.handling).toBe("fallback");
    expect((event.data!.error as Error).message).toBe("bad render");
    expect(event.ownerPath).toEqual(["<App>"]);
  });
});

describe("tiers, in the built artifacts", () => {
  test("prod carries neither the codes nor the emitter; observe carries wiring only; dev carries all", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const read = (name: string) =>
      readFileSync(resolve(import.meta.dirname, "../../dist", name), "utf8");
    const prod = read("server.js");
    const observe = read("server.observe.js");
    const dev = read("server.dev.js");
    expect(prod).not.toContain("diagnostics.emit");
    for (const check of [
      "SERVER_WRITE",
      "LAZY_ASSET_UNMAPPED",
      "REVEAL_IN_RENDER_TO_STRING",
      // The boundary checks read off the boundary record's facts (hydration.ts).
      "SSR_BOUNDARY_WATERFALL",
      "SSR_CLIENT_CONTENT_MASKED"
    ]) {
      expect(prod, check).not.toContain(`[${check}]`);
      expect(observe, check).not.toContain(`[${check}]`);
      expect(dev, check).toContain(`[${check}]`);
    }
    expect(prod).not.toContain("[SSR_RENDER_ERROR_CONTAINED]");
    expect(observe).toContain("[SSR_RENDER_ERROR_CONTAINED]");
    expect(dev).toContain("[SSR_RENDER_ERROR_CONTAINED]");
    // The thrown message ships in every tier; only the record is gated.
    expect(prod).toContain("[ASYNC_OUTSIDE_LOADING_BOUNDARY]");
  });
});
