/**
 * #3540 — born held (A29) exempts boundaries, and `on` is a dependency list.
 *
 * A29's creation-time form ("born held") is right for a plain memo or effect
 * created while a transaction holds what it reads: published, its value would
 * tear the frame. A loading boundary that has not revealed yet is the
 * exception by definition — its job is to catch what is not ready under it
 * rather than let it hold. A `Loading` mounted while a transaction holds what
 * it reads shows its fallback NOW and reveals at the commit; the hold stays
 * with readers that have content to keep (a boundary already showing content
 * forwards the pending and holds like any reader).
 *
 * `on` is the same rule seen from outside: a tracked function whose READS
 * re-arm the boundary (its value is never compared). A write to a source it
 * read makes a revealed boundary fresh again — its fallback shows in the
 * current frame, beside whatever the write is still holding elsewhere — when
 * something under it is pending; nothing happens when nothing is. The
 * re-arm tests proper are in loading-on-rearm-3540.test.ts.
 *
 * Every observation below is made in an effect's EFFECT phase (the committed
 * frame), never in its compute phase (which sees the staged world).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  action,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flatten,
  flush,
  latest,
  untrack
} from "../src/index.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const microtask = () => Promise.resolve();

/** `<Loading fallback={fallback}>{fn()}</Loading>` as a component call:
 * created untracked, as createComponent does. */
const Loading = <T>(fn: () => T, fallback: string) =>
  untrack(() => createLoadingBoundary(fn, () => fallback));

/** Bind an accessor to a cell, effect-phase (the committed frame). */
function show(accessor: () => unknown, cell: { value: unknown }) {
  createRenderEffect(accessor, v => {
    cell.value = v;
  });
}

describe("a Loading mounted mainline while a transaction holds what it reads (A29 boundary exemption, #3540)", () => {
  test("held by a live action: fallback now, content at the commit — a plain effect beside it stays born held", async () => {
    const [x, setX] = createSignal(0);
    const pre = { value: undefined as unknown };
    createRoot(() => show(x, pre));
    flush();
    let release!: () => void;
    action(function* () {
      setX(1);
      yield new Promise<void>(r => (release = r));
    })();
    flush();
    expect(pre.value).toBe(0);

    // Mounted from mainline while x's write is held.
    const boundary = { value: undefined as unknown };
    const plain = { value: "unset" as unknown };
    createRoot(() => {
      show(
        Loading(() => `content ${x()}`, "fallback"),
        boundary
      );
      // A29 proper: a plain memo + effect over the same held value is born
      // held — its first run is the commit's.
      const m = createMemo(() => `plain ${x()}`);
      show(m, plain);
    });
    flush();
    expect(boundary.value).toBe("fallback");
    expect(plain.value).toBe("unset");
    expect(pre.value).toBe(0);

    release();
    await microtask();
    await microtask();
    flush();
    expect(boundary.value).toBe("content 1");
    expect(plain.value).toBe("plain 1");
    expect(pre.value).toBe(1);
  });

  test("held by an async refetch: fallback now for a held write, a pending memo, or both; reveal at the landing", async () => {
    const [count, setCount] = createSignal(1);
    const cells = {
      count: { value: undefined as unknown },
      B: { value: undefined as unknown },
      Acount: { value: undefined as unknown },
      Adata: { value: undefined as unknown },
      Aboth: { value: undefined as unknown }
    };
    let data!: () => number;
    createRoot(() => {
      data = createMemo(async () => {
        const v = count();
        await sleep(1000);
        return v;
      });
      show(count, cells.count);
      // B shows content over data: an initialized boundary, it forwards the
      // refetch's pending and holds the frame (A33).
      show(
        Loading(() => data(), "Loading B"),
        cells.B
      );
    });
    flush();
    await vi.advanceTimersByTimeAsync(1000);
    flush();
    expect([cells.count.value, cells.B.value]).toEqual([1, 1]);

    setCount(2);
    flush();
    expect([cells.count.value, cells.B.value]).toEqual([1, 1]);

    // Mounted from mainline while count's write is held by data's flight.
    createRoot(() => {
      show(
        Loading(() => `count ${count()}`, "Loading Acount"),
        cells.Acount
      );
      show(
        Loading(() => `data ${data()}`, "Loading Adata"),
        cells.Adata
      );
      show(
        Loading(() => `count ${count()} data ${data()}`, "Loading Aboth"),
        cells.Aboth
      );
    });
    flush();
    await microtask();
    flush();
    expect(cells.Acount.value).toBe("Loading Acount");
    expect(cells.Adata.value).toBe("Loading Adata");
    expect(cells.Aboth.value).toBe("Loading Aboth");
    // The hold stays with the readers that have content to keep.
    expect([cells.count.value, cells.B.value]).toEqual([1, 1]);

    await vi.advanceTimersByTimeAsync(1000);
    flush();
    expect(cells.Acount.value).toBe("count 2");
    expect(cells.Adata.value).toBe("data 2");
    expect(cells.Aboth.value).toBe("count 2 data 2");
    expect([cells.count.value, cells.B.value]).toEqual([2, 2]);
  });

  test("content created behind a fallback over a held value is collected, not published (the in-flush form)", async () => {
    const [x, setX] = createSignal(0);
    let release!: () => void;
    action(function* () {
      setX(1);
      yield new Promise<void>(r => (release = r));
    })();
    flush();
    const published: unknown[] = [];
    const out = { value: undefined as unknown };
    let gate!: () => void;
    createRoot(() => {
      const blocker = createMemo(() => new Promise<string>(r => (gate = () => r("open"))));
      show(
        Loading(() => {
          const m = createMemo(() => `inner ${x()}`);
          createRenderEffect(m, v => {
            published.push(v);
          });
          return `${blocker()} ${m()}`;
        }, "fallback"),
        out
      );
    });
    flush();
    expect(out.value).toBe("fallback");
    expect(published).toEqual([]);
    expect(x()).toBe(0);

    // The blocker lands; the boundary still waits on the held write.
    gate();
    await microtask();
    await microtask();
    flush();
    expect(out.value).toBe("fallback");
    expect(published).toEqual([]);

    release();
    await microtask();
    await microtask();
    flush();
    expect(out.value).toBe("open inner 1");
    expect(published).toEqual(["inner 1"]);
  });
});

/** The web matrix at the signals level (#3540), with @solidjs/web's `insert`
 * modelled: an outer render effect reads the accessor; a function value gets
 * an inner render effect that resolves it. */
const INNER_OWNED = {};
function insert(accessor: () => unknown, apply: (v: unknown) => void) {
  createRenderEffect(
    (prev?: unknown) => {
      const value = flatten(accessor(), { skipNonRendered: true, doNotUnwrap: true });
      if (typeof value !== "function") return value;
      createRenderEffect(
        () => flatten(value, { skipNonRendered: true }),
        inner => void apply(inner),
        prev !== undefined ? { sync: true, transparent: true, schedule: true } : undefined
      );
      return INNER_OWNED;
    },
    value => {
      if (value === INNER_OWNED) return;
      apply(value);
    },
    { sync: true, transparent: true }
  );
}

/** solid-js's `<Show keyed>`: a condition memo over `when`, a sync value memo
 * picking the child. A function child with parameters is a render callback,
 * invoked per key; a static child is a getter, evaluated per key. */
function Show(props: { when: () => unknown; children: unknown }) {
  const conditionValue = createMemo(() => props.when());
  return createMemo(
    () => {
      const c = conditionValue();
      if (!c) return undefined;
      const child = props.children;
      return typeof child === "function" && child.length > 0
        ? untrack(() => (child as (c: unknown) => unknown)(c))
        : child;
    },
    { sync: true }
  );
}

type Key = "latest" | "committed";
type Form = "static" | "callback" | "on";

function build(form: Form, key: Key) {
  const [count, setCount] = createSignal(1);
  const view = { count: "", A: "", B: "" };
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    const data = createMemo(async () => {
      const v = count();
      await sleep(1000);
      return v;
    });
    const k = key === "latest" ? () => latest(count) : count;
    const LoadingA = () => Loading(() => data(), "Loading A");
    let A: () => unknown;
    switch (form) {
      case "static":
        A = Show({
          when: k,
          get children() {
            return LoadingA();
          }
        });
        break;
      case "callback":
        A = Show({ when: k, children: (_c: unknown) => LoadingA() });
        break;
      case "on":
        A = untrack(() =>
          createLoadingBoundary(
            () => data(),
            () => "Loading A",
            { on: k }
          )
        );
        break;
    }
    insert(A, v => (view.A = String(v)));
    insert(
      () => Loading(() => data(), "Loading B"),
      v => (view.B = String(v))
    );
    insert(count, v => (view.count = String(v)));
  });
  flush();
  return { setCount, dispose, snapshot: () => `${view.count}|${view.A}|${view.B}` };
}

const HELD = "1|1|1";
const EARLY = "1|Loading A|1";

describe("Loading `on` beside a keyed Show around the boundary (#3540)", () => {
  // A keyed Show remounts on its condition's VALUE: over `latest(count)` the
  // new boundary shows its fallback ahead of the write; over `count()` the
  // key lands with the write, so the frame holds. `on` is a dependency list,
  // not a key: count's write notifies it either way, and the boundary
  // re-arms — releasing its hold now, with the fallback swap FOLLOWING THE
  // FRAME the write belongs to. B — an initialized boundary without `on` —
  // forwards data's pending and holds the frame in every row (A33), and it
  // reads the SAME `data` A's content does: the frame waits for data, and
  // by the time it commits A's collected source has settled and the sweep
  // has cleared the swap — `on: count` shows no fallback at all (HELD; DEV
  // warns LOADING_ON_OUTSIDE_HOLD, pinned in
  // loading-on-frame-following-3540.test.ts). `on: () => latest(count)` is
  // the display-ahead read: its swap is mainline and the fallback shows now,
  // beside the held frame (EARLY). (Expectation for `on` over committed was
  // EARLY under the trigger re-arm of rc.10, HELD under the value-compare
  // `on` before it — for a different reason: the key landed with the write.)
  // (A zero-arg function child is an accessor — evaluated once, not remounted
  // per key — and is deliberately not pinned here.)
  const matrix: Array<[Form, Key, string]> = [
    ["static", "latest", EARLY],
    ["callback", "latest", EARLY],
    ["on", "latest", EARLY],
    ["static", "committed", HELD],
    ["callback", "committed", HELD],
    ["on", "committed", HELD]
  ];
  for (const [form, key, midFlight] of matrix) {
    test(`${form} over ${key}: mid-flight ${midFlight === EARLY ? "reveals fallback early" : "holds"}`, async () => {
      // `on` over committed warns LOADING_ON_OUTSIDE_HOLD (B reads data too).
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const t = build(form, key);
      await vi.advanceTimersByTimeAsync(1000);
      flush();
      expect(t.snapshot()).toBe("1|1|1");
      t.setCount(2);
      flush();
      await microtask();
      flush();
      expect(t.snapshot()).toBe(midFlight);
      await vi.advanceTimersByTimeAsync(1000);
      flush();
      expect(t.snapshot()).toBe("2|2|2");
      t.dispose();
      expect(warn).toHaveBeenCalledTimes(form === "on" && key === "committed" ? 1 : 0);
      warn.mockRestore();
    });
  }

  test("an `on` notification with nothing pending under the boundary is a no-op (no fallback, no re-reveal churn)", () => {
    const [id, setId] = createSignal("a");
    const out = { value: undefined as unknown };
    const values: unknown[] = [];
    createRoot(() => {
      const b = untrack(() =>
        createLoadingBoundary(
          () => `sync ${id()}`,
          () => "loading",
          { on: id }
        )
      );
      createRenderEffect(b, v => {
        out.value = v;
        values.push(v);
      });
    });
    flush();
    setId("b");
    flush();
    expect(out.value).toBe("sync b");
    expect(values).toEqual(["sync a", "sync b"]);
  });

  test("`on`'s value is irrelevant: a fresh token per evaluation that reads nothing reactive never re-arms", async () => {
    const [count, setCount] = createSignal(1);
    const out = { value: undefined as unknown };
    createRoot(() => {
      const data = createMemo(async () => {
        const v = count();
        await sleep(1000);
        return v;
      });
      show(
        untrack(() =>
          createLoadingBoundary(
            () => data(),
            () => "loading",
            { on: () => ({}) }
          )
        ),
        out
      );
    });
    flush();
    await vi.advanceTimersByTimeAsync(1000);
    flush();
    expect(out.value).toBe(1);
    setCount(2);
    flush();
    await microtask();
    flush();
    // No notification, no re-arm: the boundary forwards the pending and
    // holds its content.
    expect(out.value).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    flush();
    expect(out.value).toBe(2);
  });

  test("an `on` source going pending is a notification; it does not suspend the parent", async () => {
    const [trigger, setTrigger] = createSignal(0);
    const outer = { value: undefined as unknown };
    const inner = { value: undefined as unknown };
    createRoot(() => {
      const model = createMemo(async () => {
        const t = trigger();
        await sleep(1000);
        return { id: t, label: `item-${t}` };
      });
      const keyed = untrack(() =>
        createLoadingBoundary(
          () => model().label,
          () => "inner loading",
          { on: () => model().id }
        )
      );
      show(
        Loading(() => keyed(), "outer loading"),
        outer
      );
      show(keyed, inner);
    });
    flush();
    expect(inner.value).toBe("inner loading");
    await vi.advanceTimersByTimeAsync(1000);
    flush();
    expect(inner.value).toBe("item-0");
    expect(outer.value).toBe("item-0");
    setTrigger(1);
    flush();
    await microtask();
    flush();
    // `on` reads a memo that went pending: the boundary re-arms; the parent
    // is not suspended by `on` — it shows the re-armed boundary's fallback.
    expect(inner.value).toBe("inner loading");
    expect(outer.value).toBe("inner loading");
    await vi.advanceTimersByTimeAsync(1000);
    flush();
    expect(inner.value).toBe("item-1");
    expect(outer.value).toBe("item-1");
  });
});
