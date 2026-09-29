/**
 * The client half of the keyed server-to-client channel: `takeHydrationValue`
 * reads (and removes) what a server render wrote with `getHydrationWriter()`,
 * from the page's `_$HY.r` registry. Tests seed that registry directly.
 */
import { afterEach, describe, expect, test } from "vitest";
import { getHydrationWriter, takeHydrationValue } from "../src/index.js";

afterEach(() => {
  delete (globalThis as any)._$HY;
});

// A promise as seroval leaves it on the registry: stamped `s` (1 resolved,
// 2 rejected) and `v` once its settlement has streamed in.
function stamped<T>(p: Promise<T>, s?: 1 | 2, v?: unknown) {
  return Object.assign(p, s ? { s, v } : {});
}

describe("takeHydrationValue", () => {
  test("seeded values: resolved, then gone (take-and-remove)", () => {
    (globalThis as any)._$HY = { r: { "lib:a": { n: 1 }, "lib:nil": null } };
    expect(takeHydrationValue("lib:a")).toEqual({ status: "resolved", value: { n: 1 } });
    expect(takeHydrationValue("lib:a")).toBeUndefined();
    expect("lib:a" in (globalThis as any)._$HY.r).toBe(false);
    expect(takeHydrationValue("lib:nil")).toEqual({ status: "resolved", value: null });
  });

  test("undefined with no registry or no entry", () => {
    expect(takeHydrationValue("lib:none")).toBeUndefined();
    (globalThis as any)._$HY = { r: {} };
    expect(takeHydrationValue("lib:none")).toBeUndefined();
  });

  test("promises: pending until settled, then resolved or rejected", async () => {
    let resolve!: (v: string) => void;
    const pending = stamped(new Promise<string>(r => (resolve = r)));
    const rejected = stamped(Promise.reject(new Error("nope")), 2, new Error("nope"));
    (globalThis as any)._$HY = {
      r: {
        "lib:pending": pending,
        "lib:done": stamped(Promise.resolve("v"), 1, "v"),
        "lib:failed": rejected
      }
    };
    const p = takeHydrationValue<string>("lib:pending")!;
    expect(p.status).toBe("pending");
    resolve("late");
    await expect((p as any).promise).resolves.toBe("late");
    expect(takeHydrationValue("lib:done")).toEqual({ status: "resolved", value: "v" });
    const failed = takeHydrationValue("lib:failed") as any;
    expect(failed.status).toBe("rejected");
    expect(failed.error.message).toBe("nope");
  });

  test("getHydrationWriter is undefined on the client", () => {
    expect(getHydrationWriter()).toBeUndefined();
  });
});
