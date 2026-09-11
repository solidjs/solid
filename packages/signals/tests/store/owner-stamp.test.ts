/**
 * #3360 (part two): store-owned backings carry their owner under the
 * enumerable `$OWNER` symbol instead of registering in two weak collections
 * per draft. The stamp is an implementation detail of the raw — these pin
 * that it never surfaces (proxy traps, snapshots, key walks, notifications)
 * and that ownership/lookup semantics survive the swap (same-family alias,
 * cross-family hand-off).
 */
import { describe, expect, it } from "vitest";
import {
  createEffect,
  createProjection,
  createRoot,
  createStore,
  deep,
  flush,
  snapshot
} from "../../src/index.js";
import { $OWNER, isOwned, storeNextLookup } from "../../src/store/next/target.js";

describe("ownership stamp (#3360)", () => {
  it("stamps the committed backing after a write; the user's object stays clean", () => {
    const src = { a: 1, nested: { x: 1 } };
    const [s, set] = createStore(src);
    expect(isOwned(src)).toBe(false);
    set(d => {
      d.a = 2;
      d.nested.x = 2;
    });
    flush();
    const t = storeNextLookup.get(src)!;
    expect(t.v).not.toBe(src);
    expect(isOwned(t.v)).toBe(true);
    expect((t.v as any)[$OWNER]).toBe(t);
    expect(isOwned(t.v.nested)).toBe(true);
    expect(Object.getOwnPropertySymbols(src)).toEqual([]);
    expect(src).toEqual({ a: 1, nested: { x: 1 } });
    void s;
  });

  it("is invisible through every proxy trap", () => {
    const [s, set] = createStore<{ a: number; nested: { x: number }; [k: symbol]: unknown }>({
      a: 1,
      nested: { x: 1 }
    });
    set(d => {
      d.a = 2;
      d.nested.x = 2;
    });
    flush();
    for (const o of [s, s.nested]) {
      expect(Object.getOwnPropertySymbols(o)).toEqual([]);
      expect(Reflect.ownKeys(o)).toEqual(o === s ? ["a", "nested"] : ["x"]);
      expect($OWNER in o).toBe(false);
      expect(Object.getOwnPropertyDescriptor(o, $OWNER)).toBeUndefined();
      expect((o as any)[$OWNER]).toBeUndefined();
      expect(Reflect.ownKeys({ ...o })).toEqual(Reflect.ownKeys(o));
    }
    // A user symbol still enumerates — only the stamp is filtered.
    const sym = Symbol("user");
    set(d => {
      d[sym] = 1;
    });
    flush();
    expect(Object.getOwnPropertySymbols(s)).toEqual([sym]);
    expect(Reflect.ownKeys(s)).toEqual(["a", "nested", sym]);
  });

  it("never leaks into a snapshot", () => {
    const [s, set] = createStore({ a: 1, nested: { x: 1 }, list: [{ y: 1 }] });
    set(d => {
      d.a = 2;
      d.nested.x = 2;
      d.list[0].y = 2;
    });
    flush();
    const snap = snapshot(s);
    expect(snap).toEqual({ a: 2, nested: { x: 2 }, list: [{ y: 2 }] });
    expect(Object.getOwnPropertySymbols(snap)).toEqual([]);
    expect(Object.getOwnPropertySymbols(snap.nested)).toEqual([]);
    expect(Object.getOwnPropertySymbols(snap.list)).toEqual([]);
    expect(Object.getOwnPropertySymbols(snap.list[0])).toEqual([]);
    expect(isOwned(snap)).toBe(false);
    expect(isOwned(snap.nested)).toBe(false);
  });

  it("never acquires a node or a has-node", () => {
    const src = { a: 1 };
    const [s, set] = createStore(src);
    createRoot(() => {
      createEffect(
        () => [s.a, Object.keys(s).length, "a" in s, deep(s)],
        () => {}
      );
    });
    flush();
    set(d => {
      d.a = 2;
    });
    flush();
    const t = storeNextLookup.get(src)!;
    expect(Reflect.ownKeys(t.n!)).toEqual(["a"]);
    expect(t.h === null || !($OWNER in t.h)).toBe(true);
  });

  it("the first commit onto an unowned backing does not report a membership change", () => {
    const [s, set] = createStore({ a: 1, b: 2 });
    let keyRuns = 0;
    createRoot(() => {
      createEffect(
        () => Object.keys(s).join(),
        () => {
          keyRuns++;
        }
      );
    });
    flush();
    expect(keyRuns).toBe(1);
    set(d => {
      d.a = 10;
    });
    flush();
    expect(keyRuns).toBe(1); // value write: same key set
    set(d => {
      d.c = 3;
    });
    flush();
    expect(keyRuns).toBe(2); // a real add
  });

  it("a same-value index write on an unowned array does not bump the deep witness", () => {
    const [s, set] = createStore({ list: [1, 2, 3] });
    let deepRuns = 0;
    createRoot(() => {
      createEffect(
        () => deep(s.list),
        () => {
          deepRuns++;
        }
      );
    });
    flush();
    expect(deepRuns).toBe(1);
    // Arrays have no written-keys bound: the fold walks every own key of the
    // (stamped) clone against the unstamped old side.
    set(d => {
      d.list[1] = 2;
    });
    flush();
    expect(deepRuns).toBe(1);
    set(d => {
      d.list[1] = 20;
    });
    flush();
    expect(deepRuns).toBe(2);
  });

  it("a same-value write on a non-plain record does not bump the deep witness", () => {
    class Point {
      constructor(
        public x = 1,
        public y = 2
      ) {}
    }
    const [s, set] = createStore({ p: new Point() });
    let deepRuns = 0;
    createRoot(() => {
      createEffect(
        () => deep(s.p),
        () => {
          deepRuns++;
        }
      );
    });
    flush();
    expect(deepRuns).toBe(1);
    // Non-plain prototype: the fold walks every pb key (no written-keys
    // bound) — the stamp must not read as a changed slot.
    set(d => {
      d.p.x = 1;
    });
    flush();
    expect(deepRuns).toBe(1);
    set(d => {
      d.p.x = 5;
    });
    flush();
    expect(deepRuns).toBe(2);
  });

  it("an owned backing aliased into another slot of the same store resolves to its target", () => {
    const [s, set] = createStore<{ a: { x: number }; b?: { x: number } }>({ a: { x: 1 } });
    set(d => {
      d.a.x = 2; // a's backing is now store-owned
    });
    flush();
    set(d => {
      d.b = d.a;
    });
    flush();
    expect(s.b).toBe(s.a);
    set(d => {
      d.b!.x = 3;
    });
    flush();
    expect(s.a.x).toBe(3);
    expect(snapshot(s)).toEqual({ a: { x: 3 }, b: { x: 3 } });
  });

  it("a store's owned backing handed to a projection stays owned across families", () => {
    const src = { item: { x: 1 } };
    const [s, set] = createStore(src);
    set(d => {
      d.item.x = 2;
    });
    flush();
    const ownedRaw = storeNextLookup.get(src)!.v.item;
    expect(isOwned(ownedRaw)).toBe(true);

    const proj = createRoot(() =>
      createProjection<{ item?: { x: number } }>(
        draft => {
          draft.item = s.item;
        },
        {},
        { key: null }
      )
    );
    expect(proj.item!.x).toBe(2);
    flush();
    // The projection wraps the foreign owned raw in its own family; snapshot
    // copies owned subtrees instead of sharing them.
    const snap = snapshot(proj);
    expect(snap.item).toEqual({ x: 2 });
    expect(snap.item).not.toBe(ownedRaw);
    expect(Object.getOwnPropertySymbols(snap.item!)).toEqual([]);
    expect(Object.getOwnPropertySymbols(proj.item!)).toEqual([]);
  });
});
