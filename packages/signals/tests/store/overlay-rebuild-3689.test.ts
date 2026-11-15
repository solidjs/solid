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
});
