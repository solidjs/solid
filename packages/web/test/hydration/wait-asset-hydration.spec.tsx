/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * `waitAsset` reached while `hydrate()` is running: the gate memo is created
 * detached (null owner), so the hydrating `createMemo` wrapper must not try
 * to peek a hydration id off it — that threw "Cannot read properties of null
 * (reading '_config')" and halted the reactive system.
 */
import { expect, test, vi } from "vitest";
import { createEffect, flush } from "solid-js";
import { hydrate, waitAsset } from "@solidjs/web";

test("a pending waitAsset read during hydration holds, then applies on settle", async () => {
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  let resolve!: () => void;
  const promise = new Promise<void>(r => (resolve = r));
  let applied = 0;
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const container = document.createElement("div");
  let dispose: (() => void) | undefined;
  try {
    dispose = hydrate(() => {
      createEffect(
        () => waitAsset(promise),
        () => {
          applied++;
        }
      );
      return null;
    }, container);
    flush();
    expect(error).not.toHaveBeenCalled();
    expect(applied).toBe(0);

    resolve();
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(applied).toBe(1);
  } finally {
    error.mockRestore();
    warn.mockRestore();
    dispose?.();
  }
});
