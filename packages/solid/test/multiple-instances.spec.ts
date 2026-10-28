import { afterEach, describe, expect, test, vi } from "vitest";

const MESSAGE = "You appear to have multiple instances of Solid";

async function loadFreshCopy() {
  vi.resetModules();
  await import("../src/index.js");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("multiple instance check", () => {
  test("a Solid 1 copy on the page (Solid$$) does not trigger the warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    globalThis.Solid$$majors = undefined;
    (globalThis as any).Solid$$ = true;
    await loadFreshCopy();
    expect(warn.mock.calls.some(args => String(args[0]).includes(MESSAGE))).toBe(false);
    // and this copy leaves v1's flag as it found it
    expect((globalThis as any).Solid$$).toBe(true);
    delete (globalThis as any).Solid$$;
  });

  test("this copy does not set Solid 1's flag, so a later Solid 1 copy stays quiet", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    globalThis.Solid$$majors = undefined;
    delete (globalThis as any).Solid$$;
    await loadFreshCopy();
    expect((globalThis as any).Solid$$).toBeUndefined();
  });

  test("a second copy of the same major warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    globalThis.Solid$$majors = undefined;
    await loadFreshCopy();
    await loadFreshCopy();
    expect(warn.mock.calls.filter(args => String(args[0]).includes(MESSAGE))).toHaveLength(1);
  });

  test("a copy of another major does not warn", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    globalThis.Solid$$majors = { 3: true };
    await loadFreshCopy();
    expect(warn.mock.calls.some(args => String(args[0]).includes(MESSAGE))).toBe(false);
  });
});
