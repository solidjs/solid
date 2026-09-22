/**
 * #3540 — what a re-arm does NOT license.
 *
 * `on` releases a boundary from waiting on its old content; it is still a
 * mechanism against tearing, not an opt-in to it. Two consequences:
 *
 * 1. A re-armed boundary's FALLBACK can itself read something not ready. On
 *    initial load that pending is the parent boundary's (its fallback). After
 *    a re-arm the parent is initialized: it forwards the pending and holds —
 *    the swap to the fallback waits for the fallback's own read, so the old
 *    content stays up until the fallback is ready (or the content lands
 *    first and the fallback is never seen). The parent never drops to its
 *    own fallback for a child's re-arm.
 *
 * 2. Reveal timing follows the frame (#3575). The swap a held write's re-arm
 *    stages is that write's transaction's, and so is everything the
 *    boundary's output publishes after it: the boundary reveals WITH the
 *    frame. Content pending on a source the transaction STAGED reveals at
 *    the commit even if the flight lands first — publishing `data 2` beside
 *    `count 1` would tear. Content pending on a source the transaction never
 *    wrote reveals at the commit too: its own hold (the pending write it
 *    derives from) is joined to the frame the moment the output pass, staged
 *    by the swap, reads its landing. In both shapes the action outlasts the
 *    data, so the sweep clears the swap before any effect phase and the
 *    fallback is never displayed — DEV warns LOADING_ON_OUTSIDE_HOLD once.
 *    The pre-#3575 sequence — fallback now, content as soon as it lands,
 *    beside the still-held frame — is the display-ahead read's:
 *    `on: () => latest(dep)`.
 *
 * Every observation is made in an effect's EFFECT phase (the committed
 * frame). Same-source reveal-at-commit is also pinned by the held-action case
 * in loading-on-rearm-3540.test.ts and by loading-on-frame-following-3540
 * (5.); the independent-source case is pinned here.
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
  untrack,
  OBSERVE
} from "../src/index.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const microtask = () => Promise.resolve();

/** DEV diagnostics, silenced on the console and collected by code. */
function captureWarnings() {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const capture = OBSERVE!.diagnostics.capture();
  return {
    warn,
    codes: () => capture.events.map(e => e.code),
    stop: () => capture.stop()
  };
}

function show(accessor: () => unknown, cell: { value: unknown; log: unknown[] }) {
  createRenderEffect(accessor, v => {
    cell.value = v;
    cell.log.push(v);
  });
}
const cell = () => ({ value: undefined as unknown, log: [] as unknown[] });

/** An outer boundary already showing content around an inner boundary with
 * `on`, whose fallback reads `fallbackData` (a deferred the test resolves). */
function nested() {
  const [count, setCount] = createSignal(1);
  const outer = cell();
  let resolveFallback!: () => void;
  let dispose!: () => void;
  let fallbackRuns = 0;
  createRoot(d => {
    dispose = d;
    const data = createMemo(async () => {
      const v = count();
      await sleep(1000);
      return v;
    });
    const fallbackData = createMemo(
      () => new Promise<string>(r => (resolveFallback = () => r("ready")))
    );
    const inner = untrack(() =>
      createLoadingBoundary(
        () => `data ${data()}`,
        () => {
          fallbackRuns++;
          return `fallback ${fallbackData()}`;
        },
        { on: count }
      )
    );
    show(
      untrack(() =>
        createLoadingBoundary(
          () => inner(),
          () => "OUTER FALLBACK"
        )
      ),
      outer
    );
  });
  flush();
  return {
    count,
    setCount,
    outer,
    dispose,
    resolveFallback: () => resolveFallback(),
    fallbackRuns: () => fallbackRuns
  };
}

describe("a re-armed boundary whose fallback is itself not ready (#3540)", () => {
  test("initial load: the fallback's pending is the parent's — the parent shows its fallback", async () => {
    const t = nested();
    // Inner content pending AND inner fallback pending: nothing under the
    // outer boundary is ready, so the outer shows its own fallback.
    expect(t.outer.value).toBe("OUTER FALLBACK");
    t.resolveFallback();
    await microtask();
    await microtask();
    flush();
    expect(t.outer.value).toBe("fallback ready");
    await vi.advanceTimersByTimeAsync(1000);
    flush();
    expect(t.outer.value).toBe("data 1");
    t.dispose();
  });

  test("after a re-arm with the fallback's read settled: the fallback shows at once; the parent never shows its own fallback", async () => {
    const t = nested();
    t.resolveFallback();
    await microtask();
    await microtask();
    flush();
    await vi.advanceTimersByTimeAsync(1000);
    flush();
    expect(t.outer.value).toBe("data 1");
    const runsBefore = t.fallbackRuns();

    t.setCount(2);
    flush();
    // The swap's pass reads the fallback, which settled above: the fallback
    // shows in the current frame.
    expect(t.outer.value).toBe("fallback ready");
    expect(t.fallbackRuns()).toBeGreaterThan(runsBefore);
    await vi.advanceTimersByTimeAsync(1000);
    flush();
    expect(t.outer.value).toBe("data 2");
    expect(t.outer.log.filter(v => v === "OUTER FALLBACK")).toHaveLength(1); // initial load only
    t.dispose();
  });
});

/** Same as `nested`, but the fallback's read is pending at the moment of the
 * re-arm: it is a memo over `count` too, landing later than `data`. */
function nestedPendingFallback(fallbackMs: number) {
  const [count, setCount] = createSignal(1);
  const outer = cell();
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    const data = createMemo(async () => {
      const v = count();
      await sleep(1000);
      return v;
    });
    const fallbackData = createMemo(async () => {
      const v = count();
      await sleep(fallbackMs);
      return `loading ${v}`;
    });
    const inner = untrack(() =>
      createLoadingBoundary(
        () => `data ${data()}`,
        () => fallbackData(),
        { on: count }
      )
    );
    show(
      untrack(() =>
        createLoadingBoundary(
          () => inner(),
          () => "OUTER FALLBACK"
        )
      ),
      outer
    );
  });
  flush();
  return { setCount, outer, dispose };
}

describe("a re-armed boundary whose fallback goes pending with the same write (#3540)", () => {
  test("fallback lands before the content: old content holds, then the fallback shows, then the content", async () => {
    const t = nestedPendingFallback(300);
    await vi.advanceTimersByTimeAsync(1000);
    flush();
    expect(t.outer.value).toBe("data 1");

    t.setCount(2);
    flush();
    await microtask();
    flush();
    // The inner fallback is not ready: the swap is held by the (initialized)
    // outer boundary — old content stays, no outer fallback.
    expect(t.outer.value).toBe("data 1");

    await vi.advanceTimersByTimeAsync(300);
    flush();
    // The fallback's read landed: the fallback shows, beside the held frame.
    expect(t.outer.value).toBe("loading 2");

    await vi.advanceTimersByTimeAsync(700);
    flush();
    expect(t.outer.value).toBe("data 2");
    expect(t.outer.log.filter(v => v === "OUTER FALLBACK")).toHaveLength(1); // initial load only
    t.dispose();
  });

  test("content lands before the fallback: the fallback is never seen", async () => {
    const t = nestedPendingFallback(3000);
    await vi.advanceTimersByTimeAsync(3000);
    flush();
    expect(t.outer.value).toBe("data 1");

    t.setCount(2);
    flush();
    await microtask();
    flush();
    expect(t.outer.value).toBe("data 1");

    await vi.advanceTimersByTimeAsync(1000);
    flush();
    expect(t.outer.value).toBe("data 2");
    expect(t.outer.log).toEqual(["OUTER FALLBACK", "data 1", "data 2"]);
    t.dispose();
  });
});

describe("reveal timing after a re-arm follows the frame (#3540, #3575)", () => {
  test("content pending on a source the held transaction staged reveals at the commit, not when the flight lands", async () => {
    const d = captureWarnings();
    const [count, setCount] = createSignal(1);
    const countCell = cell();
    const out = cell();
    let release!: () => void;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const data = createMemo(async () => {
        const v = count();
        await sleep(1000);
        return v;
      });
      show(count, countCell);
      show(
        untrack(() =>
          createLoadingBoundary(
            () => `data ${data()}`,
            () => "fallback",
            { on: count }
          )
        ),
        out
      );
    });
    flush();
    await vi.advanceTimersByTimeAsync(1000);
    flush();
    expect(out.value).toBe("data 1");
    out.log.length = 0;

    // The re-arm releases the boundary's hold on `data`, and the swap is
    // staged with count's write: the action holds that frame, so nothing on
    // screen changes — no fallback beside the old count.
    action(function* () {
      setCount(2);
      yield new Promise<void>(r => (release = r));
    })();
    flush();
    expect(out.value).toBe("data 1");
    expect(countCell.value).toBe(1);
    expect(d.codes()).toEqual([]);

    // The flight lands; the transaction is still open. `data 2` derives from
    // the staged count: revealing it beside `count 1` would tear. The action
    // outlasted the data, so the staged swap can no longer be seen: the
    // after-the-fact rule reports it here, once.
    await vi.advanceTimersByTimeAsync(1000);
    flush();
    expect(out.value).toBe("data 1");
    expect(countCell.value).toBe(1);
    expect(d.codes()).toEqual(["LOADING_ON_OUTSIDE_HOLD"]);

    // The commit: count and the content together; the fallback never shown.
    release();
    await microtask();
    await microtask();
    flush();
    expect(out.value).toBe("data 2");
    expect(countCell.value).toBe(2);
    expect(out.log).toEqual(["data 2"]);
    expect(d.warn).toHaveBeenCalledTimes(1);
    d.stop();
    dispose();
  });

  /** `data` is re-asked through `asked` — a write the action never makes —
   * and is in flight when the action writes the `on` dependency. */
  function independent(on: "dep" | "latest") {
    const [dep, setDep] = createSignal(0);
    const [other, setOther] = createSignal("a0");
    const [asked, setAsked] = createSignal(0);
    const depCell = cell();
    const otherCell = cell();
    const out = cell();
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const data = createMemo(async () => {
        const v = asked();
        await sleep(1000);
        return v;
      });
      show(dep, depCell);
      show(other, otherCell);
      show(
        untrack(() =>
          createLoadingBoundary(
            () => `data ${data()}`,
            () => "fallback",
            { on: on === "dep" ? dep : () => latest(dep) }
          )
        ),
        out
      );
    });
    flush();
    return {
      setDep,
      setOther,
      setAsked,
      out,
      dispose,
      held: () => [depCell.value, otherCell.value]
    };
  }

  test("content pending on a source the held transaction never wrote: the re-arm joins the boundary to the frame — it reveals at the commit", async () => {
    const d = captureWarnings();
    const t = independent("dep");
    await vi.advanceTimersByTimeAsync(1000);
    flush();
    expect(t.out.value).toBe("data 0");
    t.out.log.length = 0;

    // The content goes pending. An initialized boundary forwards it: the
    // frame — `asked`'s write — is held on `data`, and the boundary keeps
    // its content (no `on` notification yet).
    t.setAsked(1);
    flush();
    expect(t.out.value).toBe("data 0");

    // A second, open transaction writes the `on` dependency and something
    // unrelated. The re-arm stages the swap into IT; the boundary's output
    // is that frame's now, and the action holds it: nothing changes on
    // screen.
    let release!: () => void;
    action(function* () {
      t.setDep(1);
      t.setOther("a1");
      yield new Promise<void>(r => (release = r));
    })();
    flush();
    expect(t.out.value).toBe("data 0");
    expect(t.held()).toEqual([0, "a0"]);
    expect(d.codes()).toEqual([]);

    // The flight lands. `data 1` derives from nothing the action wrote —
    // but the output pass that reads its landing is staged, so `asked`'s
    // hold joins the action's frame and the reveal waits for its commit.
    // The action outlasted the data: the swap will be cleared before any
    // effect phase, and the after-the-fact rule reports it, once.
    await vi.advanceTimersByTimeAsync(1000);
    flush();
    expect(t.out.value).toBe("data 0");
    expect(t.held()).toEqual([0, "a0"]);
    expect(d.codes()).toEqual(["LOADING_ON_OUTSIDE_HOLD"]);

    // The commit: dep, other and the content together; no fallback shown.
    release();
    await microtask();
    await microtask();
    flush();
    expect(t.out.value).toBe("data 1");
    expect(t.held()).toEqual([1, "a1"]);
    expect(t.out.log).toEqual(["data 1"]);
    expect(d.warn).toHaveBeenCalledTimes(1);
    d.stop();
    t.dispose();
  });

  test("the same shape with `on: () => latest(dep)`: fallback now, content as soon as it lands, beside the held frame", async () => {
    // The display-ahead read: the swap shows through the lane, so the
    // boundary's output stays mainline and `data 1` reveals when it lands,
    // while dep/other are still held — nothing in it is the action's, so
    // nothing tears. The user's explicit choice: no diagnostic.
    const d = captureWarnings();
    const t = independent("latest");
    await vi.advanceTimersByTimeAsync(1000);
    flush();
    expect(t.out.value).toBe("data 0");
    t.out.log.length = 0;

    t.setAsked(1);
    flush();
    expect(t.out.value).toBe("data 0");

    let release!: () => void;
    action(function* () {
      t.setDep(1);
      t.setOther("a1");
      yield new Promise<void>(r => (release = r));
    })();
    flush();
    expect(t.out.value).toBe("fallback");
    expect(t.held()).toEqual([0, "a0"]);

    await vi.advanceTimersByTimeAsync(1000);
    flush();
    expect(t.out.value).toBe("data 1");
    expect(t.held()).toEqual([0, "a0"]);

    release();
    await microtask();
    await microtask();
    flush();
    expect(t.out.value).toBe("data 1");
    expect(t.held()).toEqual([1, "a1"]);
    expect(d.codes()).toEqual([]);
    d.stop();
    t.dispose();
  });
});
