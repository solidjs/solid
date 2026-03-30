/**
 * @vitest-environment jsdom
 */
import { afterEach, expect, test } from "vitest";
import {
  createRoot,
  flush,
  enableHydration,
  sharedConfig,
  createErrorBoundary,
  createLoadingBoundary
} from "../src/index.js";

enableHydration();

let hydrationData: Record<string, any>;

function startHydration(data: Record<string, any>) {
  hydrationData = data;
  sharedConfig.hydrating = true;
  (sharedConfig as any).has = (id: string) => id in hydrationData;
  (sharedConfig as any).load = (id: string) => hydrationData[id];
  (sharedConfig as any).gather = () => {};
}

function stopHydration() {
  sharedConfig.hydrating = false;
  (sharedConfig as any).has = undefined;
  (sharedConfig as any).load = undefined;
  (sharedConfig as any).gather = undefined;
}

afterEach(() => {
  stopHydration();
});

test("public createErrorBoundary uses hydration-aware serialized errors", () => {
  startHydration({ t0: new Error("server error") });

  let result: any;
  createRoot(
    () => {
      result = createErrorBoundary(
        () => "children content",
        (err: any) => `fallback: ${err.message}`
      );
    },
    { id: "t" }
  );

  flush();
  expect(result()).toBe("fallback: server error");
});

test("public createLoadingBoundary uses hydration-aware boundary wrapper", () => {
  (globalThis as any)._$HY = {
    modules: {},
    loading: {},
    r: {},
    events: [],
    completed: new WeakSet()
  };
  startHydration({});

  let result: any;
  createRoot(
    () => {
      result = createLoadingBoundary(
        () => "content",
        () => "loading..."
      );
    },
    { id: "t" }
  );

  flush();
  expect(typeof result).toBe("function");
  expect(result()).not.toBeUndefined();
  expect(result()).not.toBe("loading...");
});
