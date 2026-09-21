/**
 * #3540 — `on` re-arms the boundary; the fallback follows the frame.
 *
 * `on` is a dependency list: a tracked function whose READS re-arm the
 * boundary; its value is never compared. A notification arrives inside a
 * pass and the re-arm runs once the pass's heap has run (scheduler
 * `pendingRearms`), before the verdict, under the transaction the notifying
 * write belongs to: the boundary releases its hold NOW — the frame stops
 * waiting on its content — and its fallback swap is staged with that
 * transaction, landing with the write's commit (frame-following). Nothing
 * else holding, that commit is this pass's; a held navigation lands the
 * fallback together with the rest of the new page, never beside the old
 * one. `on` reading display-ahead state (`latest()`, an optimistic write)
 * is the exception: the swap is the finalize's, mainline, and the fallback
 * shows now, beside the held frame (the trigger shape of rc.10).
 *
 * The constraint the mechanism must respect: the re-arm changes nothing
 * about the hold itself. A held batch stays held — none of its staged values
 * leak into the mainline frame, the boundary's children are not disposed,
 * and the batch commits later, intact and atomic.
 *
 * Every observation is made in an effect's EFFECT phase (the committed
 * frame). The born-held exemption and the keyed-Show matrix are in
 * boundary-not-born-held-3540.test.ts; the frame sequences of the
 * shell/comments navigation are in loading-on-frame-following-3540.test.ts.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  action,
  createErrorBoundary,
  createLoadingBoundary,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest,
  onCleanup,
  untrack
} from "../src/index.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const microtask = () => Promise.resolve();

/** Bind an accessor to a cell and a log, effect-phase (the committed frame). */
function show(accessor: () => unknown, cell: { value: unknown; log: unknown[] }) {
  createRenderEffect(accessor, v => {
    cell.value = v;
    cell.log.push(v);
  });
}
const cell = () => ({ value: undefined as unknown, log: [] as unknown[] });

/** A revealed boundary over a 1s async memo of `count`, with `on` built from
 * the count accessor. */
function revealed(makeOn: (count: () => number) => () => unknown) {
  const [count, setCount] = createSignal(1);
  const on = makeOn(count);
  const out = cell();
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    const data = createMemo(async () => {
      const v = count();
      await sleep(1000);
      return v;
    });
    show(
      untrack(() =>
        createLoadingBoundary(
          () => `data ${data()}`,
          () => "fallback",
          { on }
        )
      ),
      out
    );
  });
  flush();
  return { count, setCount, out, dispose };
}

describe("Loading `on` re-arms; the fallback follows the frame (#3540)", () => {
  test("a dependency written mainline while content is pending: fallback in the same flush; reveal at the landing", async () => {
    const t = revealed(count => count);
    expect(t.out.value).toBe("fallback");
    await vi.advanceTimersByTimeAsync(1000);
    flush();
    expect(t.out.value).toBe("data 1");

    // count's write makes data pending and notifies `on` in one flush: the
    // re-arm releases the boundary before the verdict, nothing else holds,
    // and count's frame — the fallback swap staged with it — commits in the
    // same pass.
    t.setCount(2);
    flush();
    expect(t.out.value).toBe("fallback");

    await vi.advanceTimersByTimeAsync(1000);
    flush();
    expect(t.out.value).toBe("data 2");
    expect(t.out.log).toEqual(["fallback", "data 1", "fallback", "data 2"]);
    t.dispose();
  });

  /** A boundary over `data(count)` beside three plain readers, count written
   * inside an action with two other writes, then the action awaits: the
   * transaction is held (data's flight AND the action's own promise). */
  function heldAction(makeOn: (count: () => number) => () => unknown) {
    const [count, setCount] = createSignal(1);
    const [a, setA] = createSignal("a0");
    const [b, setB] = createSignal("b0");
    const cells = { A: cell(), B: cell(), count: cell(), boundary: cell(), pending: cell() };
    const counters = { cleanups: 0, mounts: 0 };
    let release!: () => void;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const data = createMemo(async () => {
        const v = count();
        await sleep(1000);
        return v;
      });
      show(a, cells.A);
      show(b, cells.B);
      show(count, cells.count);
      show(() => isPending(count), cells.pending);
      const boundary = untrack(() =>
        createLoadingBoundary(
          () => {
            // The children, as `props.children` would be: built once, with
            // their own reader of data. Alive behind the fallback, never
            // re-created — a cleanup here fires at disposal only.
            counters.mounts++;
            onCleanup(() => counters.cleanups++);
            return createMemo(() => `data ${data()}`);
          },
          () => "fallback",
          { on: makeOn(count) }
        )
      );
      show(() => {
        const v = boundary();
        return typeof v === "function" ? v() : v;
      }, cells.boundary);
    });
    const run = () =>
      action(function* () {
        setCount(2);
        setA("a1");
        setB("b1");
        yield new Promise<void>(r => (release = r));
      })();
    return { cells, counters, run, release: () => release(), dispose };
  }

  test("a dependency written INSIDE a held action: the fallback lands WITH the action's frame; the batch stays held and commits intact", async () => {
    const t = heldAction(count => count);
    const { cells, counters } = t;
    flush();
    await vi.advanceTimersByTimeAsync(1000);
    flush();
    expect(cells.boundary.value).toBe("data 1");
    expect([cells.A.value, cells.B.value, cells.count.value]).toEqual(["a0", "b0", 1]);

    t.run();
    flush();

    // The boundary released its hold, but the action holds the frame the
    // count's write belongs to, and the fallback swap is staged with it: the
    // frame still shows the committed world — content included. (Under the
    // trigger re-arm of rc.10 the fallback landed here, beside the old
    // frame, for a change nothing on screen reflected yet.)
    expect(cells.boundary.value).toBe("data 1");
    expect([cells.A.value, cells.B.value, cells.count.value]).toEqual(["a0", "b0", 1]);
    expect(cells.pending.value).toBe(true);
    expect(counters.cleanups).toBe(0);

    // The flight lands; the action is still open, so the batch is still held
    // — nothing commits piecemeal. The landing settles the boundary's
    // collected source ahead of the commit: the swap is cleared before it
    // ever shows.
    await vi.advanceTimersByTimeAsync(1000);
    flush();
    expect(cells.boundary.value).toBe("data 1");
    expect([cells.A.value, cells.B.value, cells.count.value]).toEqual(["a0", "b0", 1]);

    // The action settles: all three land together with the new content, in
    // one frame. Neither a nor b ever showed its new value before this, and
    // the boundary never showed a fallback — nothing on screen needed one.
    t.release();
    await microtask();
    await microtask();
    flush();
    expect(cells.boundary.value).toBe("data 2");
    expect([cells.A.value, cells.B.value, cells.count.value]).toEqual(["a1", "b1", 2]);
    expect(cells.pending.value).toBe(false);
    expect(cells.boundary.log).toEqual(["fallback", "data 1", "data 2"]);
    expect(cells.A.log).toEqual(["a0", "a1"]);
    expect(cells.B.log).toEqual(["b0", "b1"]);
    expect(cells.count.log).toEqual([1, 2]);
    expect(counters.mounts).toBe(1);
    expect(counters.cleanups).toBe(0);
    t.dispose();
    expect(counters.cleanups).toBe(1);
  });

  test("`on: () => latest(count)` written INSIDE a held action: fallback now beside the held frame; the batch stays held and commits intact", async () => {
    const t = heldAction(count => () => latest(count));
    const { cells, counters } = t;
    flush();
    await vi.advanceTimersByTimeAsync(1000);
    flush();
    expect(cells.boundary.value).toBe("data 1");
    expect([cells.A.value, cells.B.value, cells.count.value]).toEqual(["a0", "b0", 1]);

    t.run();
    flush();

    // `latest()` is the display-ahead read: the `on` pass ran under the
    // shadow's lane, so the swap is the finalize's, mainline — the fallback
    // landed in the current frame ...
    expect(cells.boundary.value).toBe("fallback");
    // ... and NONE of the staged values did: the mainline frame still shows
    // the committed world, the write is still pending, the children live.
    expect([cells.A.value, cells.B.value, cells.count.value]).toEqual(["a0", "b0", 1]);
    expect(cells.pending.value).toBe(true);
    expect(counters.cleanups).toBe(0);

    // The flight lands; the action is still open, so the batch is still held
    // and the boundary still shows its fallback — nothing commits piecemeal.
    await vi.advanceTimersByTimeAsync(1000);
    flush();
    expect(cells.boundary.value).toBe("fallback");
    expect([cells.A.value, cells.B.value, cells.count.value]).toEqual(["a0", "b0", 1]);

    // The action settles: all three land together, content revealed, in one
    // frame. Neither a nor b ever showed its new value before this.
    t.release();
    await microtask();
    await microtask();
    flush();
    expect(cells.boundary.value).toBe("data 2");
    expect([cells.A.value, cells.B.value, cells.count.value]).toEqual(["a1", "b1", 2]);
    expect(cells.pending.value).toBe(false);
    expect(cells.boundary.log).toEqual(["fallback", "data 1", "fallback", "data 2"]);
    expect(cells.A.log).toEqual(["a0", "a1"]);
    expect(cells.B.log).toEqual(["b0", "b1"]);
    expect(cells.count.log).toEqual([1, 2]);
    expect(counters.mounts).toBe(1);
    expect(counters.cleanups).toBe(0);
    t.dispose();
    expect(counters.cleanups).toBe(1);
  });

  test("an optimistic write to a dependency re-arms", async () => {
    const [count, setCount] = createSignal(1);
    const [opt, setOpt] = createOptimistic(0);
    const out = cell();
    const optCell = cell();
    let release!: () => void;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const data = createMemo(async () => {
        const v = count();
        await sleep(1000);
        return v;
      });
      show(opt, optCell);
      show(
        untrack(() =>
          createLoadingBoundary(
            () => `data ${data()}`,
            () => "fallback",
            { on: opt }
          )
        ),
        out
      );
    });
    flush();
    await vi.advanceTimersByTimeAsync(1000);
    flush();
    expect(out.value).toBe("data 1");

    // The action writes count (held: data goes pending) and the optimistic
    // signal (applied now). The optimistic write notifies `on`.
    action(function* () {
      setCount(2);
      setOpt(1);
      yield new Promise<void>(r => (release = r));
    })();
    flush();
    expect(optCell.value).toBe(1);
    expect(out.value).toBe("fallback");

    await vi.advanceTimersByTimeAsync(1000);
    release();
    await microtask();
    await microtask();
    flush();
    expect(out.value).toBe("data 2");
    dispose();
  });

  test("several notifications in one flush coalesce into one re-arm", async () => {
    const [count, setCount] = createSignal(1);
    const [x, setX] = createSignal(0);
    const [y, setY] = createSignal(0);
    const out = cell();
    let fallbacks = 0;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const data = createMemo(async () => {
        const v = count();
        await sleep(1000);
        return v;
      });
      show(
        untrack(() =>
          createLoadingBoundary(
            () => `data ${data()}`,
            () => (fallbacks++, "fallback"),
            {
              on: () => {
                x();
                y();
                count();
              }
            }
          )
        ),
        out
      );
    });
    flush();
    await vi.advanceTimersByTimeAsync(1000);
    flush();
    expect(out.value).toBe("data 1");
    const before = fallbacks;

    setCount(2);
    setX(1);
    setY(1);
    setX(2);
    flush();
    expect(out.value).toBe("fallback");
    expect(fallbacks - before).toBe(1);
    expect(out.log.filter(v => v === "fallback").length).toBe(2);

    await vi.advanceTimersByTimeAsync(1000);
    flush();
    expect(out.value).toBe("data 2");
    dispose();
  });

  test("`on`'s return value is irrelevant: a constant re-arms when a read source changes", async () => {
    const t = revealed(count => () => {
      count();
      return 1;
    });
    await vi.advanceTimersByTimeAsync(1000);
    flush();
    expect(t.out.value).toBe("data 1");
    t.setCount(2);
    flush();
    expect(t.out.value).toBe("fallback");
    await vi.advanceTimersByTimeAsync(1000);
    flush();
    expect(t.out.value).toBe("data 2");
    t.dispose();
  });

  test("a re-arm queued for a boundary disposed before the flush drains it is skipped", async () => {
    const t = revealed(count => count);
    await vi.advanceTimersByTimeAsync(1000);
    flush();
    expect(t.out.value).toBe("data 1");
    // The write queues the re-arm; the root is gone before finalize drains it.
    t.setCount(2);
    t.dispose();
    expect(() => flush()).not.toThrow();
    expect(t.out.log).toEqual(["fallback", "data 1"]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(() => flush()).not.toThrow();
    expect(t.out.log).toEqual(["fallback", "data 1"]);
  });
});

describe("Errored `on` re-arms: clear the error and retry (#3540)", () => {
  test("a dependency written while the error fallback shows retries the children", () => {
    // Not reactive: the failing computation has no source that changes, so
    // only a retry can recover it (a failed fetch, say).
    let broken = true;
    const [retryKey, setRetryKey] = createSignal(0);
    const out = cell();
    let attempts = 0;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const content = createMemo(() => {
        attempts++;
        if (broken) throw new Error("boom");
        return "content";
      });
      show(
        untrack(() =>
          createErrorBoundary(
            () => content(),
            err => `error: ${(err() as Error).message}`,
            { on: retryKey }
          )
        ),
        out
      );
    });
    flush();
    expect(out.value).toBe("error: boom");
    expect(attempts).toBe(1);

    // Nothing else changed: the retry throws again and the fallback stays.
    setRetryKey(1);
    flush();
    expect(out.value).toBe("error: boom");
    expect(attempts).toBe(2);

    // The cause is fixed; `on` is the reset key.
    broken = false;
    setRetryKey(2);
    flush();
    expect(out.value).toBe("content");
    expect(attempts).toBe(3);

    // With nothing caught, a notification is a no-op.
    setRetryKey(3);
    flush();
    expect(out.value).toBe("content");
    expect(attempts).toBe(3);
    dispose();
  });

  test("the retry runs through the same finalize path: a dependency written inside a held action retries now", async () => {
    let broken = true;
    const [retryKey, setRetryKey] = createSignal(0);
    const [a, setA] = createSignal("a0");
    const out = cell();
    const aCell = cell();
    let release!: () => void;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      show(a, aCell);
      show(
        untrack(() =>
          createErrorBoundary(
            () => {
              if (broken) throw new Error("boom");
              return "content";
            },
            err => `error: ${(err() as Error).message}`,
            { on: retryKey }
          )
        ),
        out
      );
    });
    flush();
    expect(out.value).toBe("error: boom");

    // The cause is fixed; the retry key is written inside an action that
    // stays open. The retry is not the action's to hold: content now, the
    // action's other write later.
    broken = false;
    action(function* () {
      setRetryKey(1);
      setA("a1");
      yield new Promise<void>(r => (release = r));
    })();
    flush();
    expect(out.value).toBe("content");
    expect(aCell.value).toBe("a0");

    release();
    await microtask();
    await microtask();
    flush();
    expect(aCell.value).toBe("a1");
    dispose();
  });
});
