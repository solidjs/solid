/** @vitest-environment node */
import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import { createRoot, createMemo, createProjection, lazy } from "../../src/server/index.js";
import { NoHydration, Hydration } from "../../src/server/hydration.js";
import { sharedConfig } from "../../src/server/shared.js";
import { NoHydrateContext, getContext, createErrorBoundary } from "../../src/server/signals.js";

function createMockSSRContext(options: { async?: boolean } = {}) {
  const serialized = new Map<string, any>();
  const modules: Array<{ type: string; href: string }> = [];
  const registeredModules: Array<{ url: string; js: string }> = [];

  const context: any = {
    async: options.async !== false,
    assets: [],
    nonce: undefined,
    escape: (s: any) => s,
    resolve: (node: any) => {
      if (typeof node === "function") return node();
      return node;
    },
    ssr: (t: string[], ...nodes: any[]) => ({ t }) as any,
    serialize(id: string, p: any) {
      serialized.set(id, p);
    },
    replace() {},
    block() {},
    registerAsset(type: string, href: string) {
      modules.push({ type, href });
    },
    resolveAssets(moduleUrl: string) {
      return { css: ["style.css"], js: ["module.js"] };
    },
    registerModule(url: string, js: string) {
      registeredModules.push({ url, js });
    },
    registerFragment(key: string) {
      return () => true;
    }
  };

  return { context, serialized, modules, registeredModules };
}

describe("NoHydration / Hydration (server)", () => {
  let savedContext: any;

  beforeEach(() => {
    savedContext = sharedConfig.context;
  });

  afterEach(() => {
    sharedConfig.context = savedContext;
  });

  // --------------------------------------------------------------------------
  // NoHydration basics
  // --------------------------------------------------------------------------

  test("NoHydration renders children", () => {
    let result: any;
    createRoot(
      () => {
        result = NoHydration({
          get children() {
            return "hello";
          }
        });
      },
      { id: "t" }
    );
    expect(result).toBe("hello");
  });

  test("NoHydration sets NoHydrateContext to true", () => {
    let contextValue: boolean | undefined;
    createRoot(
      () => {
        NoHydration({
          get children() {
            contextValue = getContext(NoHydrateContext);
            return "x";
          }
        });
      },
      { id: "t" }
    );
    expect(contextValue).toBe(true);
  });

  test("getNextContextId returns undefined inside NoHydration", () => {
    const { context } = createMockSSRContext();
    sharedConfig.context = context;

    let insideId: string | undefined;
    let outsideId: string | undefined;

    createRoot(
      () => {
        outsideId = sharedConfig.getNextContextId();
        NoHydration({
          get children() {
            insideId = sharedConfig.getNextContextId();
            return "x";
          }
        });
      },
      { id: "t" }
    );

    expect(outsideId).toBeDefined();
    expect(outsideId).toMatch(/^t/);
    expect(insideId).toBeUndefined();
  });

  test("createProjection with Promise is suppressed inside NoHydration", () => {
    const { context, serialized } = createMockSSRContext({ async: true });
    sharedConfig.context = context;

    createRoot(
      () => {
        // Projection outside NoHydration should serialize
        createProjection(() => Promise.resolve({ v: 1 }), { v: 0 });
        NoHydration({
          get children() {
            // Projection inside NoHydration should NOT serialize
            createProjection(() => Promise.resolve({ v: 2 }), { v: 0 });
            return "x";
          }
        });
      },
      { id: "t" }
    );

    // Only the outside projection should serialize
    expect(serialized.size).toBe(1);
  });

  test("createErrorBoundary inside NoHydration does not serialize error", () => {
    const { context, serialized } = createMockSSRContext({ async: true });
    sharedConfig.context = context;

    createRoot(
      () => {
        NoHydration({
          get children() {
            const result = createErrorBoundary(
              () => {
                throw new Error("test error");
              },
              (err: any) => "caught"
            );
            return result() as any;
          }
        });
      },
      { id: "t" }
    );

    expect(serialized.size).toBe(0);
  });

  test("createErrorBoundary outside NoHydration serializes normally", () => {
    const { context, serialized } = createMockSSRContext({ async: true });
    sharedConfig.context = context;

    createRoot(
      () => {
        const result = createErrorBoundary(
          () => {
            throw new Error("test error");
          },
          (err: any) => "caught"
        );
        result();
      },
      { id: "t" }
    );

    expect(serialized.size).toBe(1);
  });

  // --------------------------------------------------------------------------
  // Async createMemo serialization
  // --------------------------------------------------------------------------

  test("async createMemo inside NoHydration does not serialize", () => {
    const { context, serialized } = createMockSSRContext({ async: true });
    sharedConfig.context = context;

    createRoot(
      () => {
        NoHydration({
          get children() {
            createMemo(() => Promise.resolve(42), { ssrSource: "server" });
            return "x";
          }
        });
      },
      { id: "t" }
    );

    expect(serialized.size).toBe(0);
  });

  test("async createMemo outside NoHydration serializes normally", () => {
    const { context, serialized } = createMockSSRContext({ async: true });
    sharedConfig.context = context;

    createRoot(
      () => {
        createMemo(() => Promise.resolve(42), { ssrSource: "server" });
      },
      { id: "t" }
    );

    expect(serialized.size).toBe(1);
  });

  // --------------------------------------------------------------------------
  // Hydration standalone guard
  // --------------------------------------------------------------------------

  test("Hydration outside NoHydration is a passthrough", () => {
    let contextValue: boolean | undefined;
    let result: any;

    createRoot(
      () => {
        result = Hydration({
          id: "app",
          get children() {
            contextValue = getContext(NoHydrateContext);
            return "passthrough";
          }
        });
      },
      { id: "t" }
    );

    expect(result).toBe("passthrough");
    expect(contextValue).toBe(false);
  });

  test("Hydration inside NoHydration re-enables hydration", () => {
    let contextValue: boolean | undefined;
    let id: string | undefined;

    const { context } = createMockSSRContext();
    sharedConfig.context = context;

    createRoot(
      () => {
        NoHydration({
          get children() {
            Hydration({
              id: "app",
              get children() {
                contextValue = getContext(NoHydrateContext);
                id = sharedConfig.getNextContextId();
                return "rehydrated";
              }
            });
            return "x";
          }
        });
      },
      { id: "t" }
    );

    expect(contextValue).toBe(false);
    expect(id).toBeDefined();
    expect(id).toMatch(/^app/);
  });

  test("Hydration id prop establishes a new ID namespace", () => {
    const { context } = createMockSSRContext();
    sharedConfig.context = context;

    let id1: string | undefined;
    let id2: string | undefined;

    createRoot(
      () => {
        NoHydration({
          get children() {
            Hydration({
              id: "myapp",
              get children() {
                id1 = sharedConfig.getNextContextId();
                id2 = sharedConfig.getNextContextId();
                return "x";
              }
            });
            return "x";
          }
        });
      },
      { id: "t" }
    );

    expect(id1).toMatch(/^myapp/);
    expect(id2).toMatch(/^myapp/);
  });

  test("Hydration with no id defaults to empty string namespace", () => {
    const { context } = createMockSSRContext();
    sharedConfig.context = context;

    let id: string | undefined;

    createRoot(
      () => {
        NoHydration({
          get children() {
            Hydration({
              get children() {
                id = sharedConfig.getNextContextId();
                return "x";
              }
            });
            return "x";
          }
        });
      },
      { id: "t" }
    );

    expect(id).toBeDefined();
    expect(typeof id).toBe("string");
  });

  test("createProjection inside Hydration (within NoHydration) serializes normally", () => {
    const { context, serialized } = createMockSSRContext({ async: true });
    sharedConfig.context = context;

    createRoot(
      () => {
        NoHydration({
          get children() {
            Hydration({
              id: "app",
              get children() {
                createProjection(() => Promise.resolve({ v: 5 }), { v: 0 });
                return "x";
              }
            });
            return "x";
          }
        });
      },
      { id: "t" }
    );

    expect(serialized.size).toBe(1);
  });

  // --------------------------------------------------------------------------
  // Nested NoHydration / Hydration
  // --------------------------------------------------------------------------

  test("nested NoHydration inside Hydration suppresses again", () => {
    const { context } = createMockSSRContext();
    sharedConfig.context = context;

    let outerCtx: boolean | undefined;
    let innerCtx: boolean | undefined;
    let innermostCtx: boolean | undefined;

    createRoot(
      () => {
        NoHydration({
          get children() {
            outerCtx = getContext(NoHydrateContext);
            Hydration({
              id: "app",
              get children() {
                innerCtx = getContext(NoHydrateContext);
                NoHydration({
                  get children() {
                    innermostCtx = getContext(NoHydrateContext);
                    return "x";
                  }
                });
                return "x";
              }
            });
            return "x";
          }
        });
      },
      { id: "t" }
    );

    expect(outerCtx).toBe(true);
    expect(innerCtx).toBe(false);
    expect(innermostCtx).toBe(true);
  });

  test("ID namespaces are independent across Hydration zones", () => {
    const { context } = createMockSSRContext();
    sharedConfig.context = context;

    let id1: string | undefined;
    let id2: string | undefined;

    createRoot(
      () => {
        NoHydration({
          get children() {
            Hydration({
              id: "zone1",
              get children() {
                id1 = sharedConfig.getNextContextId();
                return "x";
              }
            });
            Hydration({
              id: "zone2",
              get children() {
                id2 = sharedConfig.getNextContextId();
                return "x";
              }
            });
            return "x";
          }
        });
      },
      { id: "t" }
    );

    expect(id1).toMatch(/^zone1/);
    expect(id2).toMatch(/^zone2/);
  });

  // --------------------------------------------------------------------------
  // lazy() module registration gating
  // --------------------------------------------------------------------------

  test("lazy() inside NoHydration registers CSS but not JS modules", () => {
    const { context, modules, registeredModules } = createMockSSRContext({ async: true });
    sharedConfig.context = context;

    createRoot(
      () => {
        NoHydration({
          get children() {
            const LazyComp = (lazy as any)(
              () => Promise.resolve({ default: () => "lazy content" }),
              undefined,
              "lazy-module.js"
            );
            LazyComp({});
            return "x";
          }
        });
      },
      { id: "t" }
    );

    const cssAssets = modules.filter(m => m.type === "style");
    const jsAssets = modules.filter(m => m.type === "module");
    expect(cssAssets.length).toBe(1);
    expect(cssAssets[0].href).toBe("style.css");
    expect(jsAssets.length).toBe(0);
    expect(registeredModules.length).toBe(0);
  });

  test("lazy() outside NoHydration registers both CSS and JS", () => {
    const { context, modules, registeredModules } = createMockSSRContext({ async: true });
    sharedConfig.context = context;

    createRoot(
      () => {
        const LazyComp = (lazy as any)(
          () => Promise.resolve({ default: () => "lazy content" }),
          undefined,
          "lazy-module.js"
        );
        LazyComp({});
      },
      { id: "t" }
    );

    const cssAssets = modules.filter(m => m.type === "style");
    const jsAssets = modules.filter(m => m.type === "module");
    expect(cssAssets.length).toBe(1);
    expect(jsAssets.length).toBe(1);
    expect(registeredModules.length).toBe(1);
  });

  test("lazy() inside NoHydration does not throw without moduleUrl", () => {
    const { context } = createMockSSRContext({ async: true });
    sharedConfig.context = context;

    expect(() => {
      createRoot(
        () => {
          NoHydration({
            get children() {
              const LazyComp = lazy(() => Promise.resolve({ default: () => "lazy content" }));
              (LazyComp as any)({});
              return "x";
            }
          });
        },
        { id: "t" }
      );
    }).not.toThrow();
  });

  test("lazy() outside NoHydration without moduleUrl defers to the module's $$moduleUrl export", async () => {
    const { context, modules, registeredModules } = createMockSSRContext({ async: true });
    sharedConfig.context = context;

    // Glob case: no callsite moduleUrl; the bundler's SSR transform injects
    // the manifest key into the module itself.
    const LazyComp = lazy(() =>
      Promise.resolve({ default: () => "lazy content", $$moduleUrl: "src/GlobComp.tsx" } as any)
    );

    createRoot(
      () => {
        (LazyComp as any)({});
      },
      { id: "t" }
    );
    // Registration is deferred until the import resolves.
    expect(registeredModules.length).toBe(0);
    await Promise.resolve();

    const jsAssets = modules.filter(m => m.type === "module");
    expect(jsAssets.length).toBe(1);
    expect(registeredModules.length).toBe(1);
    // Keyed by the render memo's hydration id, same as the moduleUrl path.
    expect(registeredModules[0].url).toBe("t0");
  });

  test("lazy() outside NoHydration without moduleUrl or $$moduleUrl warns instead of throwing", async () => {
    const { context, registeredModules } = createMockSSRContext({ async: true });
    sharedConfig.context = context;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const LazyComp = lazy(() => Promise.resolve({ default: () => "lazy content" }));
    createRoot(
      () => {
        (LazyComp as any)({});
      },
      { id: "t" }
    );
    await Promise.resolve();

    expect(registeredModules.length).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("$$moduleUrl"));
    warn.mockRestore();
  });

  /**
   * #2859: the moduleUrl/manifest guards are explicitly waived for no-hydrate
   * zones (nothing hydrates, so no assets are needed) — but the early return
   * that gated asset registration also gated the render memo, so exactly those
   * waived cases rendered nothing: the component returned `undefined` and the
   * lazy content silently vanished from the SSR output. Asset registration and
   * rendering must be decoupled — the memo is always created.
   */
  test("lazy() inside NoHydration without moduleUrl renders its content (#2859)", async () => {
    const { context } = createMockSSRContext({ async: true });
    sharedConfig.context = context;

    const LazyComp = lazy(() => Promise.resolve({ default: () => "static lazy content" as any }));
    await LazyComp.preload();

    let result: any;
    createRoot(
      () => {
        NoHydration({
          get children() {
            result = (LazyComp as any)({});
            return "x";
          }
        });
      },
      { id: "t" }
    );

    expect(typeof result).toBe("function");
    expect(result()).toBe("static lazy content");
  });

  test("lazy() inside NoHydration with moduleUrl but no manifest renders its content (#2859)", async () => {
    const { context } = createMockSSRContext({ async: true });
    delete context.resolveAssets;
    sharedConfig.context = context;

    const LazyComp = lazy(
      () => Promise.resolve({ default: () => "static lazy content" as any }),
      undefined,
      "lazy-module.js"
    );
    await LazyComp.preload();

    let result: any;
    createRoot(
      () => {
        NoHydration({
          get children() {
            result = (LazyComp as any)({});
            return "x";
          }
        });
      },
      { id: "t" }
    );

    expect(typeof result).toBe("function");
    expect(result()).toBe("static lazy content");
  });

  test("lazy() inside NoHydration is pending (NotReadyError) until the module resolves (#2859)", () => {
    const { context } = createMockSSRContext({ async: true });
    sharedConfig.context = context;

    const d: { resolve?: (mod: any) => void } = {};
    const LazyComp = lazy(() => new Promise<{ default: any }>(res => (d.resolve = res)) as any);

    let result: any;
    createRoot(
      () => {
        NoHydration({
          get children() {
            result = (LazyComp as any)({});
            return "x";
          }
        });
      },
      { id: "t" }
    );

    expect(typeof result).toBe("function");
    expect(result).toThrow();
  });

  test("lazy() moduleUrl returns the raw specifier outside a request context", () => {
    sharedConfig.context = undefined;
    const LazyComp = lazy(
      () => Promise.resolve({ default: () => "content" }),
      undefined,
      "/assets/MyComp-abc123.js"
    );
    expect(LazyComp.moduleUrl).toBe("/assets/MyComp-abc123.js");
  });

  test("lazy() moduleUrl is undefined when not provided", () => {
    const LazyComp = lazy(() => Promise.resolve({ default: () => "content" }));
    expect(LazyComp.moduleUrl).toBeUndefined();
  });

  test("lazy() moduleUrl resolves to the client entry URL inside a request context", () => {
    const { context } = createMockSSRContext({ async: true });
    sharedConfig.context = context;

    const LazyComp = lazy(
      () => Promise.resolve({ default: () => "content" }),
      undefined,
      "src/MyComp.tsx"
    );
    // The mock manifest resolves every id to js: ["module.js"].
    expect(LazyComp.moduleUrl).toBe("module.js");
  });

  test("lazy() moduleUrl access registers modulepreload hints (island signal)", () => {
    const { context, modules } = createMockSSRContext({ async: true });
    sharedConfig.context = context;

    const LazyComp = lazy(
      () => Promise.resolve({ default: () => "content" }),
      undefined,
      "src/MyComp.tsx"
    );
    // Access without rendering — as an island renderer stamping a container
    // attribute would. This is the only preload signal for NoHydration lazy.
    void LazyComp.moduleUrl;

    const jsAssets = modules.filter(m => m.type === "module");
    expect(jsAssets.map(a => a.href)).toEqual(["module.js"]);
  });

  test("lazy() moduleUrl falls back to the raw specifier when the manifest misses", () => {
    const { context } = createMockSSRContext({ async: true });
    context.resolveAssets = () => null;
    sharedConfig.context = context;

    const LazyComp = lazy(
      () => Promise.resolve({ default: () => "content" }),
      undefined,
      "src/MyComp.tsx"
    );
    expect(LazyComp.moduleUrl).toBe("src/MyComp.tsx");
  });

  test("lazy() moduleUrl uses the sync resolution fast path (islands in dev)", () => {
    const { context, modules } = createMockSSRContext({ async: true });
    // Dev-shaped resolver wiring: resolveAssets is async (css graph walk),
    // but the js URL is knowable synchronously via resolveAssetsSync.
    context.resolveAssets = (key: string) => Promise.resolve({ js: ["/" + key], css: [] });
    context.resolveAssetsSync = (key: string) => ({ js: ["/" + key], css: [] });
    sharedConfig.context = context;

    const LazyComp = lazy(
      () => Promise.resolve({ default: () => "content" }),
      undefined,
      "src/MyComp.tsx"
    );
    expect(LazyComp.moduleUrl).toBe("/src/MyComp.tsx");
    // The access is still the island preload signal.
    const jsAssets = modules.filter(m => m.type === "module");
    expect(jsAssets.map(a => a.href)).toEqual(["/src/MyComp.tsx"]);
  });

  test("lazy() moduleUrl falls back to the raw specifier for an async resolver without a sync path", () => {
    const { context } = createMockSSRContext({ async: true });
    context.resolveAssets = () => Promise.resolve({ js: ["/never-seen.js"], css: [] });
    context.resolveAssetsSync = undefined;
    sharedConfig.context = context;

    const LazyComp = lazy(
      () => Promise.resolve({ default: () => "content" }),
      undefined,
      "src/MyComp.tsx"
    );
    expect(LazyComp.moduleUrl).toBe("src/MyComp.tsx");
  });
});
