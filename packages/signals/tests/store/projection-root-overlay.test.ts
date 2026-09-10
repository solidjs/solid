import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEffect,
  createProjection,
  createRoot,
  createSignal,
  createStore,
  flush
} from "../../src/index.js";

/**
 * Projection drafts open as prototype overlays (#3352): a derive that
 * touches ONE root key of a large keyed record must not clone the whole raw
 * on its first write. The #3044 overlay was scoped to plain stores; this
 * pins that non-optimistic families (projections, derived stores) take the
 * same O(written) path, and that the paths a family adds on top — the
 * write-override immediate commit, chained seeds, held views — still hold.
 *
 * The complexity guard is deterministic, not timed: `cloneRaw` is the only
 * store code that calls `Object.getOwnPropertyDescriptors`, so a spy on it
 * counts container clones exactly. One clone is legitimate per lifetime —
 * privatizing the user's seed at the first fold (never-mutate-user-data).
 */
const KEYS = 2000;
const seed = () => Object.fromEntries(Array.from({ length: KEYS }, (_, i) => [`k${i}`, { n: i }]));

const clones = () => vi.spyOn(Object, "getOwnPropertyDescriptors");
/** Clones of a store container (vitest's own matchers scan descriptors of
 * their internal state too — filter by a key only our records carry). */
const recordClones = (spy: ReturnType<typeof clones>, probe: string) =>
  spy.mock.calls.filter(([o]) => o !== null && typeof o === "object" && probe in o).length;
afterEach(() => vi.restoreAllMocks());

describe("projection root writes are O(written) (#3352)", () => {
  it("a derive deleting + re-adding one root key does not clone the record", () => {
    const [tick, setTick] = createSignal(0);
    const proj = createRoot(() =>
      createProjection<Record<string, { n: number }>>(
        draft => {
          const i = tick();
          delete draft[`k${i}`];
          draft[`k${i}`] = { n: -1 - i };
        },
        seed(),
        { key: null }
      )
    );
    void proj.k0;
    flush();
    expect(proj.k0).toEqual({ n: -1 });

    const spy = clones();
    for (let i = 1; i <= 5; i++) {
      setTick(i);
      flush();
      expect(proj[`k${i}`]).toEqual({ n: -1 - i });
      expect(proj[`k${i - 1}`]).toEqual({ n: -i });
    }
    expect(recordClones(spy, "k0")).toBe(0);
    expect(Object.keys(proj)).toHaveLength(KEYS);
    expect(proj.k1999).toEqual({ n: 1999 });
  });

  it("root deletes in a derive read as absent everywhere and notify", () => {
    const [gone, setGone] = createSignal<string | null>(null);
    const seenB: unknown[] = [];
    const seenKeys: string[][] = [];
    const proj = createRoot(() => {
      const proj = createProjection<Record<string, { n: number } | undefined>>(
        draft => {
          const g = gone();
          if (g !== null) {
            delete draft[g];
            expect(g in draft).toBe(false);
            expect(draft[g]).toBeUndefined();
            expect(Object.keys(draft)).not.toContain(g);
          }
        },
        { a: { n: 1 }, b: { n: 2 }, c: { n: 3 } },
        { key: null }
      );
      createEffect(
        () => proj.b,
        v => {
          seenB.push(v);
        }
      );
      createEffect(
        () => Object.keys(proj),
        v => {
          seenKeys.push(v);
        }
      );
      return proj;
    });
    flush();
    expect(seenB).toEqual([{ n: 2 }]);
    expect(seenKeys).toEqual([["a", "b", "c"]]);

    const spy = clones();
    setGone("b");
    flush();
    // Exactly the one-time seed privatization (the first derive wrote nothing,
    // so no fold had cloned the user's object yet) — not a per-derive clone.
    expect(recordClones(spy, "a")).toBe(1);
    expect("b" in proj).toBe(false);
    expect(proj.b).toBeUndefined();
    expect(Object.keys(proj)).toEqual(["a", "c"]);
    expect(Object.getOwnPropertyDescriptor(proj, "b")).toBeUndefined();
    expect(seenB).toEqual([{ n: 2 }, undefined]);
    expect(seenKeys).toEqual([
      ["a", "b", "c"],
      ["a", "c"]
    ]);

    // Now owned: the next derive's root delete opens an overlay, no clone.
    setGone("c");
    flush();
    expect(recordClones(spy, "a")).toBe(1);
    expect(Object.keys(proj)).toEqual(["a"]);
    expect(seenKeys).toHaveLength(3);
  });

  it("derived store setter root writes do not clone the record", () => {
    const [store, setStore] = createRoot(() =>
      createStore<Record<string, { n: number }>>(() => {}, seed(), { key: null })
    );
    void store.k0;
    flush();
    setStore(d => {
      d.k0 = { n: -1 };
    });
    flush(); // first fold privatizes the seed (the one legitimate clone)
    expect(store.k0).toEqual({ n: -1 });

    const spy = clones();
    for (let i = 1; i <= 5; i++) {
      setStore(d => {
        delete d[`k${i}`];
        d[`k${i}`] = { n: -1 - i };
      });
      flush();
      expect(store[`k${i}`]).toEqual({ n: -1 - i });
    }
    expect(recordClones(spy, "k0")).toBe(0);
    expect(Object.keys(store)).toHaveLength(KEYS);
  });

  it("post-await landings on a root key commit in place without cloning", async () => {
    let resolve!: (v: number) => void;
    const [tick, setTick] = createSignal(1);
    const proj = createRoot(() =>
      createProjection<Record<string, { n: number } | undefined>>(
        async draft => {
          const i = tick();
          const n = await new Promise<number>(r => (resolve = r));
          delete draft.k0;
          draft.k0 = { n };
          draft[`k${i}`] = { n: -n };
        },
        seed(),
        { key: null }
      )
    );
    flush();
    resolve(100);
    await Promise.resolve();
    await Promise.resolve();
    expect(proj.k0).toEqual({ n: 100 });
    expect(proj.k1).toEqual({ n: -100 });
    expect(proj.k2).toEqual({ n: 2 });
    flush();

    const spy = clones();
    setTick(7);
    flush();
    resolve(200);
    await Promise.resolve();
    await Promise.resolve();
    expect(proj.k0).toEqual({ n: 200 });
    expect(proj.k7).toEqual({ n: -200 });
    expect(recordClones(spy, "k0")).toBe(0);
    flush();
    expect(proj.k0).toEqual({ n: 200 });
    expect(proj.k7).toEqual({ n: -200 });
    expect(Object.keys(proj)).toHaveLength(KEYS);
  });

  it("a projection seeded with another store (chained backing) keeps deriving", () => {
    const source = { a: 1, b: 2 };
    const [extra, setExtra] = createSignal(10);
    const { src, setSrc, proj } = createRoot(() => {
      const [src, setSrc] = createStore<Record<string, number>>(source);
      const proj = createProjection<Record<string, number>>(
        draft => {
          draft.c = extra();
          delete draft.b;
        },
        src as any,
        { key: null }
      );
      return { src, setSrc, proj };
    });
    void proj.a;
    flush();
    expect(proj.a).toBe(1);
    expect(proj.c).toBe(10);
    expect("b" in proj).toBe(false);
    // The derive never writes the source family.
    expect(src.c).toBeUndefined();
    expect(src.b).toBe(2);
    expect(source).toEqual({ a: 1, b: 2 });

    setExtra(20);
    flush();
    expect(proj.c).toBe(20);
    expect("b" in proj).toBe(false);
    setSrc(s => {
      s.a = 5;
    });
    flush();
    expect(src.a).toBe(5);
    expect(source).toEqual({ a: 1, b: 2 });
    expect(src.c).toBeUndefined();
  });

  it("the seed object is never mutated", () => {
    const s = seed();
    const [tick, setTick] = createSignal(0);
    const proj = createRoot(() =>
      createProjection<Record<string, { n: number } | undefined>>(
        draft => {
          const i = tick();
          draft[`k${i}`] = { n: -1 - i };
          delete draft.k1999;
        },
        s,
        { key: null }
      )
    );
    void proj.k0;
    flush();
    setTick(1);
    flush();
    expect(proj.k1).toEqual({ n: -2 });
    expect("k1999" in proj).toBe(false);
    expect(s.k0).toEqual({ n: 0 });
    expect(s.k1).toEqual({ n: 1 });
    expect(s.k1999).toEqual({ n: 1999 });
  });
});
