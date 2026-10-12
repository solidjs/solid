import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  action,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  onCleanup,
  untrack
} from "../src/index.js";
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const resolve = (v: unknown): unknown => {
  while (typeof v === "function") v = (v as () => unknown)();
  return v;
};

// S-14: a fresh Loading mounted beside a hold shows its fallback now; its
// content derives from the hold and reveals at the commit. The fallback stays
// on screen, live, until then, and is disposed only with the commit.
it("a held swap to content keeps the fallback live until the commit", async () => {
  let releaseGate!: () => void;
  const gate = new Promise<void>(r => (releaseGate = r));
  const [count, setCount] = createSignal(0);
  const [open, setOpen] = createSignal(false);
  const screen: unknown[] = [];
  const fb: string[] = [];
  createRoot(() => {
    const slow = createMemo(async () => {
      const c = count();
      await new Promise(r => setTimeout(r, 10));
      return c;
    });
    createRenderEffect(count, () => {});
    createRenderEffect(slow, () => {});
    const view = createMemo(() =>
      open()
        ? untrack(() =>
            createLoadingBoundary(
              () => () => `content ${slow()}`,
              () => {
                fb.push("built");
                onCleanup(() => fb.push("disposed"));
                return "fallback";
              }
            )
          )
        : "closed"
    );
    createRenderEffect(
      () => resolve(view()),
      v => void screen.push(v)
    );
  });
  flush();
  await vi.advanceTimersByTimeAsync(20);
  flush();
  expect(screen.at(-1)).toBe("closed");
  const p = action(function* () {
    setCount(1);
    yield gate;
  })();
  flush();
  setOpen(true);
  flush();
  expect(screen.at(-1)).toBe("fallback");
  expect(fb).toEqual(["built"]);
  await vi.advanceTimersByTimeAsync(20);
  flush(); // slow lands 1 — inside the hold
  expect(screen.at(-1)).toBe("fallback"); // the swap is held
  expect(fb).toEqual(["built"]); // the shown fallback is still live
  releaseGate();
  await p;
  flush();
  expect(screen.at(-1)).toBe("content 1");
  expect(fb).toEqual(["built", "disposed"]); // disposed with the commit
});
