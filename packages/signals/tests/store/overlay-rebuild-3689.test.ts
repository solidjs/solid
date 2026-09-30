import { describe, expect, it } from "vitest";
import {
  createEffect,
  createProjection,
  createRoot,
  createSignal,
  createStore,
  flush
} from "../../src/index.js";
import { $TARGET } from "../../src/store/store.js";

/** The committed backing (between flushes: no draft is open). */
const unwrap = (proxy: object): Record<PropertyKey, any> => (proxy as any)[$TARGET].v;

/**
 * Wide-record folds that change the key set rebuild the backing (#3689).
 *
 * A committed backing that has served as a prototype overlay (#3044) is a
 * V8 prototype object, and below V8's descriptor limit every in-place add or
 * delete on it is O(keys): a 400-key keyed record churning 100 keys per
 * commit paid 4.7 ms per step, 60× a per-key signal. The commit now decides
 * per fold: a pure rewrite of existing keys flattens in place (the overlay's
 * home case, identity-stable); a fold that deleted anything, or added more
 * than a handful of keys, materializes a fresh backing and takes the clone
 * path's swap, so the prototype object is never mutated. Past the descriptor
 * limit (1024 keys as counted) V8 keeps the backing in dictionary mode, in-
 * place is O(1) per op, and the fold stays in place — the growing record
 * #3044 was about.
 *
 * The guard is deterministic, not timed: the committed backing's identity
 * tells which path a fold took.
 */
const KEYS = 400;
const seed = (n = KEYS, from = 0) =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${from + i}`, { n: from + i }]));
type Rec = Record<string, { n: number }>;
const owned = (s: Rec) => {
  const [store, set] = createRoot(() => createStore<Rec>(s));
  // First fold privatizes the user's seed — from here the backing is owned
  // and drafts open as overlays.
  set(d => {
    d.k0 = { n: -0 };
  });
  flush();
  return [store, set] as const;
};

describe("wide overlay folds that change the key set rebuild the backing (#3689)", () => {
  it("rewrites and a few adds flatten in place; deletes and many adds rebuild", () => {
    const [store, set] = owned(seed());
    const v0 = unwrap(store);
    const k5 = store.k5;

    set(d => {
      d.k1 = { n: -1 };
      d.k2 = { n: -2 };
    });
    flush();
    expect(unwrap(store)).toBe(v0);
    set(d => {
      d.k400 = { n: 400 };
    });
    flush();
    expect(unwrap(store)).toBe(v0);
    expect(Object.keys(store)).toHaveLength(KEYS + 1);

    set(d => {
      delete d.k0;
      delete d.k1;
    });
    flush();
    const v1 = unwrap(store);
    expect(v1).not.toBe(v0);
    expect("k0" in store).toBe(false);
    expect("k1" in store).toBe(false);
    expect(store.k0).toBeUndefined();
    expect(Object.keys(store)).toHaveLength(KEYS - 1);
    expect(store.k2).toEqual({ n: -2 });
    expect(store.k400).toEqual({ n: 400 });
    // Untouched children keep identity through the rebuild — the raws are
    // copied by reference and the proxies resolve to the same targets.
    expect(store.k5).toBe(k5);
    expect(unwrap(store).k5).toBe(v0.k5);

    set(d => {
      for (let i = 500; i < 520; i++) d[`k${i}`] = { n: i };
    });
    flush();
    expect(unwrap(store)).not.toBe(v1);
    expect(Object.keys(store)).toHaveLength(KEYS - 1 + 20);
    expect(store.k519).toEqual({ n: 519 });
    expect(store.k5).toBe(k5);
  });

  it("a delete then re-add of the same key is a rewrite — in place", () => {
    const [store, set] = owned(seed());
    const v0 = unwrap(store);
    set(d => {
      delete d.k7;
      d.k7 = { n: 77 };
    });
    flush();
    expect(unwrap(store)).toBe(v0);
    expect(store.k7).toEqual({ n: 77 });
  });

  it("the user's seed is never mutated by a rebuild", () => {
    const s = seed();
    const [store, set] = createRoot(() => createStore<Record<string, { n: number }>>(s));
    set(d => {
      delete d.k0;
      d.k400 = { n: 400 };
    });
    flush();
    // Not yet owned: the first fold is the one legitimate clone.
    set(d => {
      delete d.k1;
      delete d.k2;
      d.k401 = { n: 401 };
    });
    flush();
    expect("k1" in store).toBe(false);
    expect(store.k401).toEqual({ n: 401 });
    expect(Object.keys(s)).toHaveLength(KEYS);
    expect(s.k0).toEqual({ n: 0 });
    expect(s.k1).toEqual({ n: 1 });
    expect((s as any).k401).toBeUndefined();
  });

  it("a nested wide record re-points its parent slot on rebuild", () => {
    const [store, set] = createRoot(() =>
      createStore<{ label: string; items: Record<string, { n: number }> }>({
        label: "x",
        items: seed()
      })
    );
    set(d => {
      d.items.k0 = { n: -0 };
    });
    flush();
    const items0 = unwrap(store.items);
    expect(unwrap(store).items).toBe(items0);

    set(d => {
      delete d.items.k0;
      delete d.items.k1;
      d.items.k400 = { n: 400 };
    });
    flush();
    const items1 = unwrap(store.items);
    expect(items1).not.toBe(items0);
    // The parent's committed backing points at the rebuilt child.
    expect(unwrap(store).items).toBe(items1);
    expect("k0" in store.items).toBe(false);
    expect(store.items.k400).toEqual({ n: 400 });
    expect(Object.keys(store.items)).toHaveLength(KEYS - 1);
    expect(store.label).toBe("x");

    // And the next fold on the rebuilt child works from the new backing.
    set(d => {
      d.items.k2 = { n: -2 };
    });
    flush();
    expect(unwrap(store.items)).toBe(items1);
    expect(store.items.k2).toEqual({ n: -2 });
  });

  it("membership readers notify exactly across a rebuild", () => {
    const [store, set] = owned(seed());
    const seen: Record<string, boolean[]> = {};
    createRoot(() => {
      for (const id of ["k0", "k5", "k999"])
        createEffect(
          () => id in store,
          v => {
            (seen[id] ??= []).push(v);
          }
        );
    });
    flush();
    expect(seen).toEqual({ k0: [true], k5: [true], k999: [false] });

    set(d => {
      delete d.k0;
      d.k999 = { n: 999 };
    });
    flush();
    expect(seen).toEqual({ k0: [true, false], k5: [true], k999: [false, true] });

    set(d => {
      delete d.k999;
      d.k0 = { n: 0 };
    });
    flush();
    expect(seen).toEqual({ k0: [true, false, true], k5: [true], k999: [false, true, false] });
  });

  it("the reporter's shape: a keyed-record projection sliding a 400-key window", () => {
    const F = 100;
    const [tick, setTick] = createSignal(0);
    const window = (i: number) => Array.from({ length: KEYS }, (_, k) => `k${i * F + k}`);
    const seen: Record<string, boolean[]> = {};
    const proj = createRoot(() => {
      const mirror = new Set<string>();
      const proj = createProjection<Record<string, boolean>>(
        draft => {
          const next = new Set(window(tick()));
          for (const id of mirror)
            if (!next.has(id)) {
              mirror.delete(id);
              delete draft[id];
            }
          for (const id of next)
            if (!mirror.has(id)) {
              mirror.add(id);
              draft[id] = true;
            }
        },
        {},
        { key: null }
      );
      for (const id of ["k0", "k150", "k450"])
        createEffect(
          () => id in proj,
          v => {
            (seen[id] ??= []).push(v);
          }
        );
      return proj;
    });
    flush();
    expect(Object.keys(proj).sort()).toEqual(window(0).sort());
    expect(seen).toEqual({ k0: [true], k150: [true], k450: [false] });

    const v0 = unwrap(proj);
    setTick(1);
    flush();
    expect(unwrap(proj)).not.toBe(v0);
    expect(Object.keys(proj).sort()).toEqual(window(1).sort());
    expect(seen).toEqual({ k0: [true, false], k150: [true], k450: [false, true] });

    for (let i = 2; i <= 6; i++) {
      setTick(i);
      flush();
      expect(Object.keys(proj).sort()).toEqual(window(i).sort());
    }
    // k150 left at tick 2, k450 at tick 5; nothing re-ran in between.
    expect(seen).toEqual({ k0: [true, false], k150: [true, false], k450: [false, true, false] });
  });

  it("post-await landings with deletes commit immediately from a rebuilt backing", async () => {
    let resolve!: (v: number) => void;
    const [tick, setTick] = createSignal(1);
    const proj = createRoot(() =>
      createProjection<Record<string, { n: number } | undefined>>(
        async draft => {
          const i = tick();
          const n = await new Promise<number>(r => (resolve = r));
          delete draft[`k${i}`];
          delete draft[`k${i + 1}`];
          draft[`k${1000 + i}`] = { n };
        },
        seed(),
        { key: null }
      )
    );
    flush();
    resolve(100);
    await Promise.resolve();
    await Promise.resolve();
    // First landing privatizes the seed (clone path).
    expect("k1" in proj).toBe(false);
    expect(proj.k1001).toEqual({ n: 100 });
    flush();
    const v0 = unwrap(proj);

    setTick(7);
    flush();
    resolve(200);
    await Promise.resolve();
    await Promise.resolve();
    // Landed truth is visible before any flush — the immediate commit took
    // the rebuild's swap.
    expect("k7" in proj).toBe(false);
    expect("k8" in proj).toBe(false);
    expect(proj.k1007).toEqual({ n: 200 });
    expect(unwrap(proj)).not.toBe(v0);
    flush();
    expect(proj.k1007).toEqual({ n: 200 });
    expect(proj.k9).toEqual({ n: 9 });
    expect(Object.keys(proj)).toHaveLength(KEYS - 4 + 2);
  });

  it("past the descriptor-limit gate deletes stay in place, and the count follows them back down", () => {
    const [store, set] = owned(seed(1100));
    const v0 = unwrap(store);
    // 1100 keys: above the gate — a delete fold flattens in place.
    set(d => {
      for (let i = 0; i < 300; i++) delete d[`k${i}`];
    });
    flush();
    expect(unwrap(store)).toBe(v0);
    expect(Object.keys(store)).toHaveLength(800);
    expect("k0" in store).toBe(false);
    // Now 800 as counted: the next delete fold rebuilds.
    set(d => {
      delete d.k300;
    });
    flush();
    expect(unwrap(store)).not.toBe(v0);
    expect(Object.keys(store)).toHaveLength(799);
    expect(store.k301).toEqual({ n: 301 });
  });
});
