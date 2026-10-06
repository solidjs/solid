/**
 * @vitest-environment jsdom
 *
 * `sharedConfig.hydrateWindow` — the claim window a streamed boundary's
 * resume opens, reachable by an integration that owns server markup
 * wholesale (the frames client's adopted occurrences): hydrating on for the
 * synchronous run, the current owner the claim owner, the keys under the id
 * gathered into the registry (the captured pair when given), the claim
 * roots declared, everything restored on the way out.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { createOwner, createRoot, runWithOwner } from "@solidjs/signals";
import { enableHydration, isHydrating, sharedConfig } from "../src/client/hydration.js";

function stopHydration() {
  sharedConfig.hydrating = false;
  (sharedConfig as any).registry = undefined;
  (sharedConfig as any).gather = undefined;
  delete (globalThis as any)._$HY;
}

describe("sharedConfig.hydrateWindow", () => {
  afterEach(stopHydration);

  test("installed by enableHydration(); returns the window's result", () => {
    enableHydration();
    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {} };
    (sharedConfig as any).registry = new Map();
    (sharedConfig as any).gather = () => {};
    const hw = sharedConfig.hydrateWindow!;
    expect(typeof hw).toBe("function");
    let hydrating: boolean | undefined;
    const out = hw("sc-x-", () => {
      hydrating = sharedConfig.hydrating;
      return 42;
    });
    expect(out).toBe(42);
    expect(hydrating).toBe(true);
    expect(sharedConfig.hydrating).toBe(false);
  });

  test("hydrating on inside, the current owner the claim owner; all restored", () => {
    enableHydration();
    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {} };
    const registry = new Map<string, object>();
    const gather = vi.fn();
    (sharedConfig as any).registry = registry;
    (sharedConfig as any).gather = gather;
    const seen: Record<string, unknown> = {};
    createRoot(() => {
      const sibling = createOwner();
      const claimant = createOwner({ id: "sc-x-" });
      runWithOwner(claimant, () => {
        sharedConfig.hydrateWindow!("sc-x-", () => {
          seen.hydrating = sharedConfig.hydrating;
          // The window claims the claimant's subtree only (#3504).
          seen.claiming = isHydrating();
          seen.elsewhere = runWithOwner(sibling, () => isHydrating());
        });
      });
    });
    expect(gather).toHaveBeenCalledWith("sc-x-");
    expect(seen).toEqual({ hydrating: true, claiming: true, elsewhere: false });
    expect(sharedConfig.hydrating).toBe(false);
    expect(isHydrating()).toBe(false);
  });

  test("a captured registry/gather pair is swapped in for the window and restored (#2917)", () => {
    enableHydration();
    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {} };
    const liveRegistry = new Map<string, object>();
    const liveGather = vi.fn();
    (sharedConfig as any).registry = liveRegistry;
    (sharedConfig as any).gather = liveGather;
    const captured = { registry: new Map<string, object>(), gather: vi.fn() };
    let inside: { registry?: unknown; gather?: unknown } = {};
    sharedConfig.hydrateWindow!(
      "sc-a-",
      () => {
        inside = { registry: sharedConfig.registry, gather: sharedConfig.gather };
      },
      captured
    );
    expect(captured.gather).toHaveBeenCalledWith("sc-a-");
    expect(liveGather).not.toHaveBeenCalled();
    expect(inside).toEqual({ registry: captured.registry, gather: captured.gather });
    expect(sharedConfig.registry).toBe(liveRegistry);
    expect(sharedConfig.gather).toBe(liveGather);
  });

  test("restores on a throw, and nests: an inner window leaves the outer one's state", () => {
    enableHydration();
    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {} };
    (sharedConfig as any).registry = new Map();
    (sharedConfig as any).gather = () => {};
    let afterInner: unknown;
    sharedConfig.hydrateWindow!("sc-o-", () => {
      expect(() =>
        sharedConfig.hydrateWindow!("sc-i-", () => {
          throw new Error("boom");
        })
      ).toThrow("boom");
      afterInner = sharedConfig.hydrating;
    });
    expect(afterInner).toBe(true);
    expect(sharedConfig.hydrating).toBe(false);
  });
});
