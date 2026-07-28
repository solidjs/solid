/**
 * Regression tests for #2903: `updateKeyedMap` must be exception-safe under
 * NotReadyError. A map callback that reads a pending async source throws
 * mid-diff; the aborted pass must leave `_mappings`/`_nodes`/`_rows` exactly
 * as they were (strong abort) so the post-settle retry diffs against
 * uncorrupted state.
 *
 * The contract pinned here:
 * - an aborted pass commits nothing: no disposals of surviving rows, no
 *   positional writes, no length change;
 * - owners created during the aborted pass are disposed with it (their
 *   cleanups run at abort) — they never squat in the position arrays;
 * - every row's creations and disposals balance over the list's lifetime
 *   (no leaked owners, no double disposal, no wrong-owner disposal).
 */
import { describe, expect, it } from "vitest";
import {
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  mapArray,
  onCleanup,
  repeat
} from "../src/index.js";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => (resolve = res));
  return { promise, resolve };
}

const settle = async () => {
  await new Promise(r => setTimeout(r, 0));
  flush();
};

/**
 * Standard harness: a keyed list where the row named "x" reads a gated async
 * memo. Rows log created/disposed so owner balance is assertable.
 */
function harness(initial: string[]) {
  const gate = deferred<string>();
  const [$source, setSource] = createSignal(initial);
  const [$useAsync, setUseAsync] = createSignal(false);
  const created: string[] = [];
  const disposed: string[] = [];
  let result = "";
  let dispose!: () => void;

  createRoot(d => {
    dispose = d;
    const asyncVal = createMemo(async () => ($useAsync() ? gate.promise : "sync"));
    const map = mapArray(
      () => $source(),
      (item: string) => {
        created.push(item);
        onCleanup(() => disposed.push(item));
        if (item === "x") return `x:${asyncVal()}`;
        return item;
      }
    );
    const b = createLoadingBoundary(
      () => map().join(","),
      () => "loading"
    );
    createRenderEffect(
      () => (result = b()),
      () => {}
    );
  });
  flush();

  return {
    gate,
    setSource,
    setUseAsync,
    created,
    disposed,
    result: () => result,
    dispose
  };
}

function balance(created: string[], disposed: string[]) {
  const counts = new Map<string, number>();
  for (const c of created) counts.set(c, (counts.get(c) ?? 0) + 1);
  for (const d of disposed) counts.set(d, (counts.get(d) ?? 0) - 1);
  return counts;
}

describe("updateKeyedMap NotReadyError safety (#2903)", () => {
  it("case 1: reorder + pending insert keeps every surviving row (no duplicates, no losses)", async () => {
    const h = harness(["a", "b", "c"]);
    expect(h.result()).toBe("a,b,c");

    h.setUseAsync(true);
    h.setSource(["c", "x", "a", "b"]); // reorder + insert pending "x"
    flush();
    expect(h.result()).toBe("a,b,c"); // boundary holds prior content over the refetch

    h.gate.resolve("go");
    await settle();
    expect(h.result()).toBe("c,x:go,a,b");

    // Surviving rows kept their owners: created exactly once each.
    expect(h.created.filter(i => i === "a").length).toBe(1);
    expect(h.created.filter(i => i === "c").length).toBe(1);
    // Mid-life: one live owner per row, no zombies from the aborted pass.
    for (const [item, n] of balance(h.created, h.disposed)) {
      expect(n, `live owners for row "${item}" after settle`).toBe(1);
    }

    h.dispose();
    flush();
    // Lifetime balance: every creation matched by exactly one disposal.
    for (const [item, n] of balance(h.created, h.disposed)) {
      expect(n, `owner balance for row "${item}"`).toBe(0);
    }
  });

  it("case 2: removal while a pass is pending disposes the REAL row's owner", async () => {
    const h = harness(["a", "b", "c"]);
    expect(h.result()).toBe("a,b,c");

    h.setUseAsync(true);
    h.setSource(["a", "b", "x", "c"]); // pending insert before "c" — pass aborts
    flush();
    expect(h.result()).toBe("a,b,c"); // held

    // While still pending: remove "c". The aborted pass must not have
    // replaced c's owner at its position.
    h.setSource(["a", "b", "x"]);
    flush();

    h.gate.resolve("go");
    await settle();
    expect(h.result()).toBe("a,b,x:go");
    expect(h.disposed).toContain("c"); // the real row was disposed…
    expect(h.created.filter(i => i === "c").length).toBe(1); // …exactly once created

    h.dispose();
    flush();
    for (const [item, n] of balance(h.created, h.disposed)) {
      expect(n, `owner balance for row "${item}"`).toBe(0);
    }
  });

  it("case 3: initial create that suspends retries cleanly (no wrong-owner disposal, no leaks)", async () => {
    const gate = deferred<string>();
    const [$source] = createSignal(["a", "x", "b"]);
    const created: string[] = [];
    const disposed: string[] = [];
    let result = "";
    let dispose!: () => void;

    createRoot(d => {
      dispose = d;
      const asyncVal = createMemo(async () => gate.promise);
      const map = mapArray(
        () => $source(),
        (item: string) => {
          created.push(item);
          onCleanup(() => disposed.push(item));
          if (item === "x") return `x:${asyncVal()}`;
          return item;
        }
      );
      const b = createLoadingBoundary(
        () => map().join(","),
        () => "loading"
      );
      createRenderEffect(
        () => (result = b()),
        () => {}
      );
    });
    flush();
    expect(result).toBe("loading");

    gate.resolve("go");
    await settle();
    expect(result).toBe("a,x:go,b");

    // Mid-life invariant: exactly ONE live owner per row. Leaked owners from
    // the aborted pass would sit as zombies (created but not disposed) until
    // the final teardown masks them.
    for (const [item, n] of balance(created, disposed)) {
      expect(n, `live owners for row "${item}" after settle`).toBe(1);
    }

    dispose();
    flush();
    for (const [item, n] of balance(created, disposed)) {
      expect(n, `owner balance for row "${item}"`).toBe(0);
    }
  });

  it("aborted fallback creation does not leak owners across retries", async () => {
    const gate = deferred<string>();
    const [$source, setSource] = createSignal<string[]>(["a"]);
    let fallbackCreates = 0;
    let fallbackDisposes = 0;
    let result = "";
    let dispose!: () => void;

    createRoot(d => {
      dispose = d;
      const asyncVal = createMemo(async () => gate.promise);
      const map = mapArray(
        () => $source(),
        (item: string) => item,
        {
          fallback: () => {
            fallbackCreates++;
            onCleanup(() => fallbackDisposes++);
            return `empty:${asyncVal()}`; // fallback itself reads async
          }
        }
      );
      const b = createLoadingBoundary(
        () => map().join(","),
        () => "loading"
      );
      createRenderEffect(
        () => (result = b()),
        () => {}
      );
    });
    flush();
    expect(result).toBe("a");

    setSource([]); // empty → fallback path, which suspends
    flush();
    expect(result).toBe("a"); // held over the fallback's own suspension

    gate.resolve("go");
    await settle();
    expect(result).toBe("empty:go");
    expect(fallbackCreates - fallbackDisposes, "live fallback owners").toBe(1);

    dispose();
    flush();
    expect(fallbackCreates - fallbackDisposes).toBe(0);
  });

  it("non-keyed (keyed: false) rows survive an aborted pass with staged row signals", async () => {
    const gate = deferred<string>();
    const [$source, setSource] = createSignal(["a", "b"]);
    const [$useAsync, setUseAsync] = createSignal(false);
    const created: number[] = [];
    const disposed: number[] = [];
    let result = "";
    let dispose!: () => void;

    createRoot(d => {
      dispose = d;
      const asyncVal = createMemo(async () => ($useAsync() ? gate.promise : "sync"));
      const map = mapArray(
        () => $source(),
        (item, index: number) => {
          created.push(index);
          onCleanup(() => disposed.push(index));
          const v = item(); // row signal read at creation
          return v.startsWith("x") ? `${v}:${asyncVal()}` : v; // mapper itself suspends
        },
        { keyed: false }
      );
      const b = createLoadingBoundary(
        () => map().join(","),
        () => "loading"
      );
      createRenderEffect(
        () => (result = b()),
        () => {}
      );
    });
    flush();
    expect(result).toBe("a,b");

    setUseAsync(true);
    setSource(["a", "b", "x"]); // grow: index 2 is created and suspends
    flush();
    expect(result).toBe("a,b"); // held

    gate.resolve("v");
    await settle();
    expect(result).toBe("a,b,x:v");

    dispose();
    flush();
    // Indexes 0/1 created once; index 2 aborted + retried (2 creations, 2 disposals).
    const counts = new Map<number, number>();
    for (const c of created) counts.set(c, (counts.get(c) ?? 0) + 1);
    for (const dd of disposed) counts.set(dd, (counts.get(dd) ?? 0) - 1);
    for (const [idx, n] of counts) expect(n, `owner balance for index ${idx}`).toBe(0);
  });

  it("repeat: grow while a new index suspends — no leaked or double-disposed owners", async () => {
    const gate = deferred<string>();
    const [$count, setCount] = createSignal(2);
    const [$useAsync, setUseAsync] = createSignal(false);
    const created: number[] = [];
    const disposed: number[] = [];
    let result = "";
    let dispose!: () => void;

    createRoot(d => {
      dispose = d;
      const asyncVal = createMemo(async () => ($useAsync() ? gate.promise : "sync"));
      const view = repeat($count, i => {
        created.push(i);
        onCleanup(() => disposed.push(i));
        return i === 3 ? `3:${asyncVal()}` : `${i}`;
      });
      const b = createLoadingBoundary(
        () => view().join(","),
        () => "loading"
      );
      createRenderEffect(
        () => (result = b()),
        () => {}
      );
    });
    flush();
    expect(result).toBe("0,1");

    setUseAsync(true);
    setCount(5); // indexes 2,3,4 created — 3 suspends mid-append
    flush();
    expect(result).toBe("0,1"); // held

    gate.resolve("go");
    await settle();
    expect(result).toBe("0,1,2,3:go,4");

    // Rows 0 and 1 were never part of the aborted work: created exactly once.
    expect(created.filter(i => i === 0).length).toBe(1);
    expect(created.filter(i => i === 1).length).toBe(1);

    dispose();
    flush();
    const counts = new Map<number, number>();
    for (const c of created) counts.set(c, (counts.get(c) ?? 0) + 1);
    for (const dd of disposed) counts.set(dd, (counts.get(dd) ?? 0) - 1);
    for (const [idx, n] of counts) expect(n, `owner balance for index ${idx}`).toBe(0);
  });

  it("repeat: disjoint window shift with a suspending row keeps old rows until commit", async () => {
    const gate = deferred<string>();
    const [$from, setFrom] = createSignal(0);
    const [$useAsync, setUseAsync] = createSignal(false);
    const created: number[] = [];
    const disposed: number[] = [];
    let result = "";
    let dispose!: () => void;

    createRoot(d => {
      dispose = d;
      const asyncVal = createMemo(async () => ($useAsync() ? gate.promise : "sync"));
      const view = repeat(
        () => 3,
        i => {
          created.push(i);
          onCleanup(() => disposed.push(i));
          return i === 11 ? `11:${asyncVal()}` : `${i}`;
        },
        { from: $from }
      );
      const b = createLoadingBoundary(
        () => view().join(","),
        () => "loading"
      );
      createRenderEffect(
        () => (result = b()),
        () => {}
      );
    });
    flush();
    expect(result).toBe("0,1,2");

    setUseAsync(true);
    setFrom(10); // disjoint window [10,13) — index 11 suspends
    flush();
    expect(result).toBe("0,1,2"); // held

    gate.resolve("go");
    await settle();
    expect(result).toBe("10,11:go,12");

    dispose();
    flush();
    const counts = new Map<number, number>();
    for (const c of created) counts.set(c, (counts.get(c) ?? 0) + 1);
    for (const dd of disposed) counts.set(dd, (counts.get(dd) ?? 0) - 1);
    for (const [idx, n] of counts) expect(n, `owner balance for index ${idx}`).toBe(0);
  });

  it("repeat: aborted fallback creation does not leak owners across retries", async () => {
    const gate = deferred<string>();
    const [$count, setCount] = createSignal(1);
    let fallbackCreates = 0;
    let fallbackDisposes = 0;
    let result = "";
    let dispose!: () => void;

    createRoot(d => {
      dispose = d;
      const asyncVal = createMemo(async () => gate.promise);
      const view = repeat($count, i => `${i}`, {
        fallback: () => {
          fallbackCreates++;
          onCleanup(() => fallbackDisposes++);
          return `empty:${asyncVal()}`;
        }
      });
      const b = createLoadingBoundary(
        () => view().join(","),
        () => "loading"
      );
      createRenderEffect(
        () => (result = b()),
        () => {}
      );
    });
    flush();
    expect(result).toBe("0");

    setCount(0); // fallback path, which suspends
    flush();
    expect(result).toBe("0"); // held

    gate.resolve("go");
    await settle();
    expect(result).toBe("empty:go");
    expect(fallbackCreates - fallbackDisposes, "live fallback owners").toBe(1);

    dispose();
    flush();
    expect(fallbackCreates - fallbackDisposes).toBe(0);
  });

  it("multiple pending rows in one pass abort and land together", async () => {
    const gate = deferred<string>();
    const [$source, setSource] = createSignal(["a", "b"]);
    const [$useAsync, setUseAsync] = createSignal(false);
    let result = "";
    let dispose!: () => void;

    createRoot(d => {
      dispose = d;
      const asyncVal = createMemo(async () => ($useAsync() ? gate.promise : "sync"));
      const map = mapArray(
        () => $source(),
        (item: string) => (item.startsWith("x") ? `${item}:${asyncVal()}` : item)
      );
      const b = createLoadingBoundary(
        () => map().join(","),
        () => "loading"
      );
      createRenderEffect(
        () => (result = b()),
        () => {}
      );
    });
    flush();

    setUseAsync(true);
    setSource(["x1", "a", "x2", "b"]);
    flush();
    expect(result).toBe("a,b"); // held

    gate.resolve("v");
    await settle();
    expect(result).toBe("x1:v,a,x2:v,b");

    dispose();
  });
});

/**
 * #2944: mapArray over an async-derived store key wedged permanently after
 * the source settled. The map computed re-ran during the settle flush and its
 * source read succeeded (observer-present, served off the pending rail —
 * #2938), but the keyed diff's item reads run inside the internal owner with
 * no observer. Those untracked reads hit the store's uninitialized guard,
 * which consulted STATUS_UNINITIALIZED — a flag whose clear is deferred to
 * batch commit and therefore stale mid-flush — and threw a fresh
 * NotReadyError that nothing would sweep. The guard now also requires the
 * firewall to still be in flight (STATUS_PENDING, the live bit) or errored.
 */
describe("mapArray/repeat over an async-derived store key (#2944)", () => {
  it("mapArray renders the list when the store's async key first settles", async () => {
    const gate = deferred<{ id: number; name: string }[]>();
    const mapped: string[] = [];
    let result = "";
    let dispose!: () => void;

    createRoot(d => {
      dispose = d;
      const items = createMemo(() => gate.promise);
      const [s1] = createStore(() => ({ items: items() }), { items: [] as any[] });
      const map = mapArray(
        () => (s1 as any).items,
        (v: any) => {
          mapped.push(v.name);
          return v.name;
        }
      );
      const b = createLoadingBoundary(
        () => map().join(","),
        () => "loading"
      );
      createRenderEffect(
        () => (result = b()),
        () => {}
      );
    });
    flush();
    expect(result).toBe("loading");

    gate.resolve([
      { id: 1, name: "A" },
      { id: 2, name: "B" }
    ]);
    await settle();
    expect(result).toBe("A,B");
    expect(mapped).toEqual(["A", "B"]);

    dispose();
  });

  it("repeat rows reading store items settle the same way", async () => {
    const gate = deferred<string[]>();
    let result = "";
    let dispose!: () => void;

    createRoot(d => {
      dispose = d;
      const items = createMemo(() => gate.promise);
      const [s1] = createStore(() => ({ items: items() }), { items: [] as string[] });
      const rows = repeat(
        () => (s1 as any).items.length,
        (i: number) => (s1 as any).items[i]
      );
      const b = createLoadingBoundary(
        () => rows().join(","),
        () => "loading"
      );
      createRenderEffect(
        () => (result = b()),
        () => {}
      );
    });
    flush();
    expect(result).toBe("loading");

    gate.resolve(["A", "B"]);
    await settle();
    expect(result).toBe("A,B");

    dispose();
  });

  it("the uninitialized guard still vetoes genuinely loading untracked reads (#2897)", () => {
    let s1!: any;
    const dispose = createRoot(d => {
      const [s] = createStore(() => new Promise(() => {}) as any, { v: 0 });
      s1 = s;
      return d;
    });
    flush();
    expect(() => s1.v).toThrow(); // NotReadyError while the firewall is in flight
    dispose();
  });
});
