/** @vitest-environment node */
/**
 * Dependency edges on the server: plain-signal identities and read tracking
 * (edges.ts). Off until the frames server installs them, so a render without
 * server components names nothing and tracks nothing. On, a plain signal
 * created under an id-bearing owner is named `<owner id>~<n>`, n restarting
 * whenever the owner's child counter does (dispose, retry reset), as the
 * client names it; a slot fill's reads report those names, through memos too.
 */
import { afterEach, describe, expect, test } from "vitest";
import {
  createMemo,
  createOwner,
  createRoot,
  createProjection,
  createSignal,
  createStore,
  edgeHooks,
  mapArray,
  resetOwnerForRerun,
  runWithOwner
} from "../../src/server/signals.js";
import { beginEdgesRender, edgesRenders, trackFillReads } from "../../src/server/edges.js";
import { sharedConfig } from "../../src/server/shared.js";

let end: (() => void) | undefined;
afterEach(() => {
  end?.();
  end = undefined;
  sharedConfig.context = undefined;
});

/** A render that asked for edges is in flight. */
function edgesRender() {
  end = beginEdgesRender();
  sharedConfig.context = { edges: true } as any;
}

const readsOf = (fn: () => unknown) => [...(trackFillReads(fn).reads || [])];

describe("server plain-signal identities", () => {
  test("off: nothing is named or tracked", () => {
    const reads = createRoot(
      () => {
        const [a] = createSignal(1);
        return readsOf(() => a());
      },
      { id: "off" }
    );
    expect(reads).toEqual([]);
  });

  test("installed, but the render did not ask: nothing is named", () => {
    end = beginEdgesRender();
    sharedConfig.context = { edges: false } as any;
    const reads = createRoot(
      () => {
        const [a] = createSignal(1);
        return readsOf(() => a());
      },
      { id: "plain" }
    );
    expect(reads).toEqual([]);
  });

  test("on: named per id-bearing owner in creation order; fills see reads through memos", () => {
    edgesRender();
    const reads = createRoot(
      () => {
        const [a] = createSignal(1);
        const [b] = createSignal(2);
        const sum = createMemo(() => a() + b());
        return [readsOf(() => a()), readsOf(() => sum())];
      },
      { id: "r" }
    );
    expect(reads[0]).toEqual(["r~0"]);
    expect(reads[1].sort()).toEqual(["r~0", "r~1"]);
  });

  test("the count restarts when the owner's children reset (a retry)", () => {
    edgesRender();
    const names = createRoot(
      () => {
        const o = createOwner();
        const pass = () =>
          runWithOwner(o, () => {
            const [s] = createSignal(0);
            return readsOf(() => s());
          });
        const first = pass();
        resetOwnerForRerun(o);
        return [first, pass()];
      },
      { id: "q" }
    );
    expect(names[0]).toHaveLength(1);
    expect(names[1]).toEqual(names[0]);
  });

  test("rows of one list count their own signals, from 0 on every pass", () => {
    edgesRender();
    const passes = createRoot(
      () => {
        const [items] = createSignal(["a", "b", "c"]);
        const rows = mapArray(items, () => {
          const [s] = createSignal(0);
          const [t] = createSignal(0);
          return readsOf(() => (s(), t()));
        });
        return [rows(), rows()];
      },
      { id: "l" }
    );
    const [first] = passes;
    const names = first.flat();
    expect(new Set(names).size).toBe(6);
    // Each row's two signals: `<row id>~0` and `<row id>~1`.
    for (const row of first) expect(row.map(n => n.split("~")[1])).toEqual(["0", "1"]);
    expect(passes[1]).toEqual(first);
  });

  test("a plain store is named by its root: any read of it, at any depth, reports that name", () => {
    edgesRender();
    const r = createRoot(
      () => {
        const [a] = createSignal(0);
        const [store] = createStore({ user: { name: "a" }, tags: ["x", "y"], n: 1 });
        const proj = createProjection<{ v: number }>(() => {}, { v: 0 });
        const [b] = createSignal(0);
        return {
          a: readsOf(() => a()),
          b: readsOf(() => b()),
          leaf: readsOf(() => store.user.name),
          keys: readsOf(() => Object.keys(store.user)),
          iterate: readsOf(() => store.tags.map(t => t)),
          has: readsOf(() => "n" in store),
          proj: readsOf(() => proj.v),
          same: store.user === store.user
        };
      },
      { id: "st" }
    );
    // Signals around it keep their counts: the store took `st~1`, the
    // projection none.
    expect(r.a).toEqual(["st~0"]);
    expect(r.b).toEqual(["st~2"]);
    for (const reads of [r.leaf, r.keys, r.iterate, r.has]) expect(reads).toEqual(["st~1"]);
    expect(r.proj).toEqual([]);
    expect(r.same).toBe(true);
  });

  test("a store held inside another store makes the holder wide", () => {
    edgesRender();
    const ctx = sharedConfig.context as any;
    const r = createRoot(
      () => {
        const [inner] = createStore({ n: 0 });
        const [outer] = createStore({ inner });
        return readsOf(() => outer.inner.n);
      },
      { id: "w" }
    );
    // The held store reads as itself; the holder is wide (a setter call on
    // it can write the held store, whose own readers its name misses).
    expect(r.sort()).toEqual(["w~0", "w~1"]);
    expect([...ctx.edgeWide.s]).toEqual(["w~1"]);
  });

  test("the hooks are installed only while an edges render is in flight", () => {
    const a = beginEdgesRender();
    const b = beginEdgesRender();
    expect(edgesRenders()).toBe(2);
    a();
    a();
    expect(edgesRenders()).toBe(1);
    b();
    expect(edgesRenders()).toBe(0);
    expect(edgeHooks).toBeNull();
  });
});
