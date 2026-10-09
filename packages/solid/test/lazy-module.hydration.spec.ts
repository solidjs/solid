/** @vitest-environment node */
import { describe, expect, test, afterEach } from "vitest";
import { sharedConfig } from "../src/client/hydration.js";
import { lazyModule } from "../src/client/component.js";

afterEach(() => {
  sharedConfig.hydrating = false;
  delete (globalThis as any)._$HY;
});

describe("lazyModule() hydration", () => {
  test("peek() returns the preloaded module and does not call the thunk", () => {
    const loaded = { routes: ["admin"] };
    (globalThis as any)._$HY = { modules: { "./admin/routes": loaded }, loading: {} };
    sharedConfig.hydrating = true;
    let calls = 0;
    const admin = lazyModule(() => {
      calls++;
      return Promise.resolve({ routes: ["client"] });
    }, "./admin/routes");

    expect(admin.peek()).toBe(loaded);
    expect(calls).toBe(0);
    expect(admin.moduleUrl).toBe("./admin/routes");
  });

  test("a missing module key returns undefined and does not throw", () => {
    (globalThis as any)._$HY = { modules: {}, loading: {} };
    sharedConfig.hydrating = true;
    let calls = 0;
    const admin = lazyModule(() => {
      calls++;
      return Promise.resolve({ routes: [] });
    }, "./admin/routes");

    expect(admin.peek()).toBeUndefined();
    expect(calls).toBe(0);
  });

  test("peek() without a moduleUrl misses softly during hydration", () => {
    (globalThis as any)._$HY = {
      modules: { "src/admin/routes.ts": { routes: ["glob"] } },
      loading: {}
    };
    sharedConfig.hydrating = true;
    const admin = lazyModule(() => Promise.resolve({ routes: ["fallback"] }));
    expect(admin.peek()).toBeUndefined();
  });

  test("the call and preload share one promise; peek reads it once settled", async () => {
    sharedConfig.hydrating = false;
    let calls = 0;
    const admin = lazyModule(() => {
      calls++;
      return Promise.resolve({ routes: ["csr"] });
    }, "./admin/routes");

    const first = admin();
    const second = admin.preload();
    expect(second).toBe(first);
    expect(calls).toBe(1);
    expect(admin.peek()).toBeUndefined();
    await first;
    expect(admin.peek()).toEqual({ routes: ["csr"] });
  });
});
