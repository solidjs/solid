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
 * 2. Reveal timing follows the sources. Content pending on a source the
 *    re-arming transaction STAGED reveals at that transaction's commit, even
 *    if the flight lands first — publishing `data 2` beside `count 1` would
 *    tear. Content pending on a source the transaction never touched reveals
 *    as soon as it lands, while the transaction is still held — nothing in
 *    it is staged, so nothing can tear.
 *
 * Every observation is made in an effect's EFFECT phase (the committed
 * frame). Same-source reveal-at-commit is also pinned by the held-action case
 * in loading-on-rearm-3540.test.ts; the independent-source case is new here.
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
  untrack
} from "../src/index.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const microtask = () => Promise.resolve();

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

describe("reveal timing after a re-arm follows the sources (#3540)", () => {
  test("content pending on a source the held transaction staged reveals at the commit, not when the flight lands", async () => {
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

    action(function* () {
      setCount(2);
      yield new Promise<void>(r => (release = r));
    })();
    flush();
    expect(out.value).toBe("fallback");
    expect(countCell.value).toBe(1);

    // The flight lands; the transaction is still open. `data 2` derives from
    // the staged count: revealing it beside `count 1` would tear.
    await vi.advanceTimersByTimeAsync(1000);
    flush();
    expect(out.value).toBe("fallback");
    expect(countCell.value).toBe(1);

    release();
    await microtask();
    await microtask();
    flush();
    expect(out.value).toBe("data 2");
    expect(countCell.value).toBe(2);
    dispose();
  });

  test("content pending on a source the held transaction never touched reveals when it lands, while the transaction is still held", async () => {
    const [dep, setDep] = createSignal(0);
    const [other, setOther] = createSignal("a0");
    const [asked, setAsked] = createSignal(0);
    const depCell = cell();
    const otherCell = cell();
    const out = cell();
    let release!: () => void;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      // Independent of the transaction: re-asked through `asked`, which the
      // test writes mainline.
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
            { on: dep }
          )
        ),
        out
      );
    });
    flush();
    await vi.advanceTimersByTimeAsync(1000);
    flush();
    expect(out.value).toBe("data 0");

    // Content goes pending mainline (nothing staged), then the transaction
    // writes the `on` dependency and something unrelated, and stays open.
    setAsked(1);
    flush();
    expect(out.value).toBe("data 0"); // holds its content: no `on` notification yet
    action(function* () {
      setDep(1);
      setOther("a1");
      yield new Promise<void>(r => (release = r));
    })();
    flush();
    expect(out.value).toBe("fallback");
    expect([depCell.value, otherCell.value]).toEqual([0, "a0"]);

    // The flight lands: nothing in `data 1` is the transaction's, so the
    // boundary reveals now, beside the still-held dep/other.
    await vi.advanceTimersByTimeAsync(1000);
    flush();
    expect(out.value).toBe("data 1");
    expect([depCell.value, otherCell.value]).toEqual([0, "a0"]);

    release();
    await microtask();
    await microtask();
    flush();
    expect(out.value).toBe("data 1");
    expect([depCell.value, otherCell.value]).toEqual([1, "a1"]);
    dispose();
  });
});
