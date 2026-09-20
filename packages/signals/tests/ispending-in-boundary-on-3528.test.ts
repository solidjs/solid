import { describe, expect, test } from "vitest";
import {
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending
} from "../src/index.js";

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// #3528: a boundary whose `on` accessor consults `isPending(dep)` — directly or
// through a memo — over two async memos. `on` was evaluated from `notify`,
// inside the pending memo's own pass; the memo of `isPending(m2)` is marked
// pending by that propagation, and reading it there (untracked, pending)
// recorded the untracked-pending re-run link on `context` — which was `m2`.
// `m2` then depended on a memo that depends on `m2`: every pending mark
// re-derived `m2` (the A30 kept-tail rule), which went pending again, forever,
// in one flush. A click must produce exactly one new flight of the written
// memo, with the new input.
//
// #3540: `on` is a tracked key now (its own computed, as the condition of a
// `<Show keyed>` wrapping the boundary), not a trigger evaluated per pending
// notification. `isPending(dep)` in the key is a verdict channel: it flips
// ahead of the write's commit, so the key changes — and the fallback shows —
// ahead of it too, the way `on={latest(x)}` does. `on=always` returns a fresh
// token per evaluation but reads nothing reactive: the key is evaluated once
// and never changes, so the boundary is never reset — it forwards the pending
// and holds with the transaction like a boundary without `on`.
type OnMode = "always" | "memo-isPending" | "fn-isPending";

function build(onMode: OnMode, boundaries: 1 | 2) {
  const [count, setCount] = createSignal(0);
  const [count2, setCount2] = createSignal(0);
  const runs: string[] = [];
  const log: string[] = [];
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    const m2 = createMemo(async () => {
      const c = count();
      runs.push(`m2(c=${c})`);
      if (runs.length > 40) throw new Error("loop guard");
      await sleep(30);
      return c * 2;
    });
    const m3 = createMemo(async () => {
      const c = count2();
      runs.push(`m3(c=${c})`);
      if (runs.length > 40) throw new Error("loop guard");
      await sleep(30);
      return c * 3;
    });
    const make = (dep: () => unknown, tag: string) => {
      let token = {};
      let lastOn: object | null = null;
      const shouldReset =
        onMode === "memo-isPending"
          ? createMemo(() => isPending(dep))
          : onMode === "fn-isPending"
            ? () => isPending(dep)
            : () => true;
      const view = createLoadingBoundary(
        () => `${m2()} ${m3()}`,
        () => "Loading",
        {
          on() {
            if (onMode === "fn-isPending") return shouldReset() ? (lastOn = {}) : lastOn;
            if (shouldReset()) token = {};
            return token;
          }
        }
      );
      createRenderEffect(view, v => void log.push(`${tag}=${v}`));
    };
    make(m2, "A");
    if (boundaries === 2) make(m3, "B");
    createRenderEffect(count, v => void log.push(`count=${v}`));
  });
  flush();
  return {
    runs,
    log,
    setCount,
    setCount2,
    dispose,
    async settle() {
      for (let t = 0; t < 12; t++) {
        await sleep(10);
        flush();
      }
    },
    mark(label: string) {
      log.push(label);
      runs.push(label);
    },
    since(label: string) {
      return {
        log: log.slice(log.indexOf(label) + 1),
        runs: runs.slice(runs.indexOf(label) + 1)
      };
    }
  };
}

describe("#3528 isPending consulted from a Loading boundary's `on`", () => {
  test.each(["always", "fn-isPending", "memo-isPending"] as const)(
    "on=%s, one boundary: one click is one flight; a key that changes resets the boundary",
    async onMode => {
      const h = build(onMode, 1);
      await h.settle();
      h.mark("--click--");
      h.setCount(1);
      flush();
      await h.settle();
      h.dispose();
      const r = h.since("--click--");
      expect(r.runs).toEqual(["m2(c=1)"]);
      if (onMode === "always") {
        // The key never changes (nothing reactive read): no reset, the
        // boundary forwards the pending and the frame holds until m2 lands.
        expect(r.log).toEqual(["A=2 0", "count=1"]);
      } else {
        // The verdict flips ahead of the commit, so the key does: the fallback
        // lands first; the reset frees the boundary's reader from the hold
        // (A33), the count publishes, and the content reveals when m2 lands.
        expect(r.log).toEqual(["A=Loading", "count=1", "A=2 0"]);
      }
    }
  );

  test.each(["fn-isPending", "memo-isPending"] as const)(
    "on=%s, two boundaries reading both memos: one click is one flight",
    async onMode => {
      const h = build(onMode, 2);
      await h.settle();
      h.mark("--click--");
      h.setCount(1);
      flush();
      await h.settle();
      h.dispose();
      const r = h.since("--click--");
      expect(r.runs).toEqual(["m2(c=1)"]);
      // A's key flips ahead of the commit (a verdict): its fallback shows
      // beside the current frame. B reads m2 too and is not keyed on it: an
      // outside reader of the flight, so the frame stays held until m2 lands
      // (A33) — one reveal.
      expect(r.log[0]).toBe("A=Loading");
      expect(r.log.slice(1)).toHaveLength(3);
      expect(r.log.slice(1)).toEqual(expect.arrayContaining(["count=1", "A=2 0", "B=2 0"]));
    }
  );

  test("the report's shape: two boundaries, both buttons clicked back to back", async () => {
    const h = build("memo-isPending", 2);
    await h.settle();
    h.mark("--clicks--");
    h.setCount(1);
    h.setCount2(1);
    flush();
    await h.settle();
    h.dispose();
    const r = h.since("--clicks--");
    expect(r.runs.sort()).toEqual(["m2(c=1)", "m3(c=1)"]);
    expect(r.log.filter(l => l.startsWith("A=")).at(-1)).toBe("A=2 3");
    expect(r.log.filter(l => l.startsWith("B=")).at(-1)).toBe("B=2 3");
  });
});
