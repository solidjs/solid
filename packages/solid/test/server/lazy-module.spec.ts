/** @vitest-environment node */
import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import { createRoot, NotReadyError } from "../../src/server/index.js";
import { lazyModule } from "../../src/server/component.js";
import { sharedConfig } from "../../src/server/shared.js";
import { inClaimedRender } from "./render-root.js";

const ADMIN = "./admin/routes";
const ENTRY = "/assets/admin.js";

function assetsFor(id: string) {
  return id === ADMIN || id === "src/admin/routes.ts"
    ? {
        js: [ENTRY, "/assets/shared.js"],
        css: ["/assets/admin.css"],
        preloads: [{ href: "/assets/admin.woff2", as: "font", crossorigin: "" }]
      }
    : null;
}

function trackingContext() {
  const registered: Array<{ type: string; value: any }> = [];
  const modules: Record<string, string> = {};
  const blocked: Promise<any>[] = [];
  const context: any = {
    async: true,
    resolveAssets: assetsFor,
    resolveAssetsSync: assetsFor,
    registerAsset(type: string, value: any) {
      registered.push({ type, value });
    },
    registerModule(moduleUrl: string, entryUrl: string) {
      modules[moduleUrl] = entryUrl;
    },
    block(p: Promise<any>) {
      blocked.push(p);
    }
  };
  return { context, registered, modules, blocked };
}

describe("lazyModule() server preload", () => {
  let saved: any;

  beforeEach(() => {
    saved = sharedConfig.context;
  });

  afterEach(() => {
    sharedConfig.context = saved;
  });

  test("peek() registers under the module id and suspends until the module loads", async () => {
    const { context, registered, modules, blocked } = trackingContext();
    sharedConfig.context = context;
    let resolve!: (mod: { routes: string[] }) => void;
    const admin = lazyModule(
      () =>
        new Promise<{ routes: string[] }>(r => {
          resolve = r;
        }),
      ADMIN
    );

    expect(() =>
      createRoot(
        () => {
          admin.peek();
        },
        { id: "t" }
      )
    ).toThrow(NotReadyError);
    expect(blocked).toHaveLength(1);
    // The key is the module id, not the hydration id the root would have
    // handed a lazy() component ("t0").
    expect(modules).toEqual({ [ADMIN]: ENTRY });
    expect(modules).not.toHaveProperty("t0");
    expect(registered).toEqual([
      { type: "style", value: "/assets/admin.css" },
      {
        type: "preload",
        value: { href: "/assets/admin.woff2", as: "font", crossorigin: "" }
      },
      { type: "module", value: ENTRY },
      { type: "module", value: "/assets/shared.js" }
    ]);

    resolve({ routes: ["home"] });
    await blocked[0];
    let mod: { routes: string[] } | undefined;
    createRoot(() => {
      mod = admin.peek();
    });
    expect(mod).toEqual({ routes: ["home"] });
  });

  test("calling the loader does not register; preload() hints without registerModule", async () => {
    const { context, registered, modules } = trackingContext();
    const admin = lazyModule(() => Promise.resolve({ routes: ["home"] }), ADMIN);

    await admin();
    expect(registered).toEqual([]);
    expect(modules).toEqual({});

    await inClaimedRender(context, () => admin.preload());
    expect(modules).toEqual({});
    expect(registered.map(entry => entry.type)).toEqual(["style", "preload", "module", "module"]);
  });

  test("peek() reads $$moduleUrl when the callsite has no module id", async () => {
    const { context, modules } = trackingContext();
    sharedConfig.context = context;
    const admin = lazyModule(() =>
      Promise.resolve({ routes: ["glob"], $$moduleUrl: "src/admin/routes.ts" } as any)
    );

    expect(() => createRoot(() => admin.peek())).toThrow(NotReadyError);
    await Promise.resolve();
    let mod: any;
    createRoot(() => {
      mod = admin.peek();
    });
    expect(mod.routes).toEqual(["glob"]);
    expect(modules).toEqual({ "src/admin/routes.ts": ENTRY });
  });

  test("a loaded module with no id warns and still returns the module", async () => {
    const { context, modules } = trackingContext();
    sharedConfig.context = context;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const admin = lazyModule(() => Promise.resolve({ routes: ["plain"] }));

    expect(() => createRoot(() => admin.peek())).toThrow(NotReadyError);
    await Promise.resolve();
    let mod: any;
    createRoot(() => {
      mod = admin.peek();
    });
    expect(mod).toEqual({ routes: ["plain"] });
    expect(modules).toEqual({});
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("$$moduleUrl"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("lazyModule()"));
    warn.mockRestore();
  });

  test("peek() outside a render does not throw and does not register", async () => {
    const { context, modules } = trackingContext();
    sharedConfig.context = undefined;
    const admin = lazyModule(() => Promise.resolve({ routes: ["x"] }), ADMIN);
    expect(admin.peek()).toBeUndefined();
    await admin();
    expect(admin.peek()).toEqual({ routes: ["x"] });
    expect(modules).toEqual({});
    void context;
  });
});
