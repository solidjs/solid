/**
 * A verdict reader mounts a fresh Loading under an action hold (semantic
 * fuzzer, mount-under-hold seed 3289 cases 119 and 323).
 *
 * `<Show when={latest(x) > 0}>` (gated through a memo) opens while an action
 * holds `x`, and mounts a `<Loading>` whose content reads `x` directly with
 * no load of its own. The boundary's output is born into the held frame, so
 * it has no committed value; the render effect inserting it is verdict-lane
 * work that read its staging. Since #3869 the seam re-queued that effect to
 * re-derive on the committed world every round the frame stayed parked, and
 * each re-run read the same staging: "Potential Infinite Loop Detected".
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  action,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  latest,
  untrack
} from "../src/index.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const resolve = (v: unknown): unknown => {
  while (typeof v === "function") v = (v as () => unknown)();
  return v;
};

function mount(anchor: boolean) {
  const [x, setX] = createSignal(0);
  const screen = { x: undefined as number | undefined, slot: undefined as unknown };
  createRoot(() => {
    if (anchor)
      createRenderEffect(x, v => {
        screen.x = v;
      });
    const condition = createMemo(() => latest(x) > 0);
    const children = createMemo(() =>
      condition()
        ? untrack(() =>
            createLoadingBoundary(
              () => untrack(() => () => `content ${x()}`),
              () => "fallback"
            )
          )
        : undefined
    );
    createRenderEffect(
      () => resolve(children()),
      v => {
        screen.slot = v;
      }
    );
  });
  flush();
  const committed = () => (anchor ? screen.x : untrack(x));
  let release!: () => void;
  const hold = () =>
    action(function* () {
      setX(1);
      yield new Promise<void>(r => (release = r));
    })();
  return { screen, committed, hold, release: () => release() };
}

describe("a verdict reader mounts a fresh Loading under an action hold", () => {
  for (const anchor of [false, true])
    describe(anchor ? "with a reader of x on screen (case 323)" : "case 119", () => {
      test("flush settles while held, and the commit reveals the content", async () => {
        const m = mount(anchor);
        expect(m.screen.slot).toBeUndefined();
        expect(m.committed()).toBe(0);

        const done = m.hold();
        expect(() => flush()).not.toThrow();
        await Promise.resolve();
        expect(() => flush()).not.toThrow();
        expect(m.committed()).toBe(0);

        m.release();
        await done;
        flush();
        expect(m.committed()).toBe(1);
        expect(m.screen.slot).toBe("content 1");
      });

      // A29: a fresh, never-shown Loading over held data shows its fallback
      // now. Pre-#3869 behavior, still open (MH1): the content shows the held
      // value beside the committed `x = 0`.
      test.fails("while held, the fresh boundary shows its fallback (A29)", async () => {
        const m = mount(anchor);
        m.hold();
        flush();
        await Promise.resolve();
        flush();
        expect(m.committed()).toBe(0);
        expect(m.screen.slot).toBe("fallback");
      });
    });
});
