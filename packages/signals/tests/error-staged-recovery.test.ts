/**
 * D-39 / D-41: a sync memo that errored and recovers in a held pass keeps
 * its shown error until that pass commits (F-7). A reader served the screen
 * — a frame or verdict reader beside a display-ahead `latest()` (D-25, A10),
 * an untracked read — reads the error, never the value behind it, and
 * re-derives at the landing.
 *
 * `m` throws for the committed `s` and recovers for the action's write; the
 * action stays open, so the recovery is held with it. `t` is written
 * mainline meanwhile: the view re-runs over the held `m` (a frame read).
 */
import { expect, it } from "vitest";
import {
  action,
  createErrorBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  latest
} from "../src/index.js";

const tick = async () => {
  await new Promise(r => setTimeout(r, 0));
  flush();
};

it.each([false, true])(
  "a held recovery of a sync memo keeps the shown error for a frame reader (memo between: %s)",
  async between => {
    let release!: () => void;
    const gate = new Promise<void>(r => (release = r));
    const [s, setS] = createSignal(0);
    const [t, setT] = createSignal("X");
    const views: string[] = [];
    let screen: unknown;
    let m!: () => number;
    const dispose = createRoot(d => {
      m = createMemo(() => {
        if (s() === 0) throw new Error("boom");
        return s();
      });
      const fn = () => {
        const v = t() + latest(s) + m();
        views.push(v);
        return v;
      };
      const view = between ? createMemo(fn) : fn;
      const errored = createErrorBoundary(view, e => `E:${(e() as Error).message}`);
      createRenderEffect(errored, v => void (screen = v));
      return d;
    });
    const untracked = () => {
      try {
        return m();
      } catch (e) {
        return ((e as Error).cause as Error)?.message ?? (e as Error).message;
      }
    };
    try {
      flush();
      expect(screen).toBe("E:boom");

      const run = action(function* () {
        setS(1);
        yield gate;
      });
      run();
      flush();
      // The recovery is held with the action: the error stays the display.
      expect(screen).toBe("E:boom");
      expect(untracked()).toBe("boom");
      expect(latest(m)).toBe(1);

      // A mainline write re-runs the view over the held recovery.
      setT("Y");
      flush();
      expect(screen).toBe("E:boom");
      expect(untracked()).toBe("boom");

      release();
      await tick();
      await tick();
      expect(screen).toBe("Y11");
      expect(untracked()).toBe(1);
      // No pass paired the held `latest` with a value the screen never had.
      expect(views).toEqual(["Y11"]);
    } finally {
      release();
      dispose();
      flush();
    }
  }
);

// The memo is the verdict reader's own child, created on its first pass and
// kept by closure past the pass that disposes it. The shown error it throws
// names a source that died: the boundary waits on the reader (the tree), not
// on the dead source — which would settle at once, redraw, re-catch and
// loop the flush (#4396 review).
it.each([false, true])(
  "a held recovery of a memo the reader owned stays live (memo between: %s)",
  async between => {
    let release!: () => void;
    const gate = new Promise<void>(r => (release = r));
    const [s, setS] = createSignal(0);
    const screens: unknown[] = [];
    let kept: (() => number) | undefined;
    const dispose = createRoot(d => {
      const fn = () =>
        "X" +
        latest(s) +
        (kept ||= createMemo(() => {
          if (s() === 0) throw new Error("boom");
          return s();
        }))();
      const view = between ? createMemo(fn) : fn;
      const errored = createErrorBoundary(view, e => `E:${(e() as Error).message}`);
      createRenderEffect(errored, v => void screens.push(v));
      return d;
    });
    try {
      flush();
      action(function* () {
        setS(1);
        yield gate;
      })();
      flush();
      expect(screens).toEqual(["E:boom"]);
      release();
      await tick();
      await tick();
      expect(screens).toEqual(["E:boom", "X11"]);
    } finally {
      release();
      dispose();
      flush();
    }
  }
);
