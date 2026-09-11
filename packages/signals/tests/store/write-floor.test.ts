/**
 * #3360: per-write floor of narrow stores.
 *
 * Drafts on plain-data containers clone by spread and swap the clone in at
 * commit; only WIDE owned containers open as prototype overlays (#3044). The
 * fast paths are gated on a one-time scan grade — these pin the cases the
 * grade must exclude (accessors, non-enumerable keys, custom prototypes,
 * non-plain defineProperty through the draft) and the cases it must keep
 * (symbol keys, frozen sources, growth past the overlay threshold).
 */
import { describe, expect, it } from "vitest";
import { createStore, flush, snapshot } from "../../src/index.js";

describe("narrow store writes (#3360)", () => {
  it("a one-key store round-trips writes and snapshots", () => {
    const [s, set] = createStore({ value: 0 });
    for (let i = 1; i <= 3; i++) {
      set(d => {
        d.value = i;
      });
      flush();
      expect(s.value).toBe(i);
      expect(snapshot(s)).toEqual({ value: i });
    }
  });

  it("enumerable symbol keys survive the spread clone", () => {
    const sym = Symbol("tag");
    const [s, set] = createStore<{ a: number; [sym]?: string }>({ a: 1, [sym]: "x" });
    set(d => {
      d.a = 2;
    });
    flush();
    expect(s.a).toBe(2);
    expect(s[sym]).toBe("x");
    expect(Reflect.ownKeys(snapshot(s))).toEqual(["a", sym]);
  });

  it("a non-enumerable own key keeps its attributes through a write (descriptor clone)", () => {
    const src: { a: number; hidden?: number } = { a: 1 };
    Object.defineProperty(src, "hidden", {
      value: 7,
      enumerable: false,
      writable: true,
      configurable: true
    });
    const [s, set] = createStore(src);
    set(d => {
      d.a = 2;
    });
    flush();
    expect(s.a).toBe(2);
    expect(s.hidden).toBe(7);
    expect(Object.keys(s)).toEqual(["a"]);
    expect(Object.getOwnPropertyDescriptor(snapshot(s), "hidden")?.enumerable).toBe(false);
  });

  it("a custom prototype survives the clone", () => {
    class Point {
      constructor(
        public x = 0,
        public y = 0
      ) {}
      get len() {
        return Math.hypot(this.x, this.y);
      }
    }
    const [s, set] = createStore(new Point(3, 4));
    set(d => {
      d.x = 6;
      d.y = 8;
    });
    flush();
    expect(s.len).toBe(10);
    expect(snapshot(s)).toBeInstanceOf(Point);
  });

  it("a frozen source clones unfrozen and stays writable (R51)", () => {
    const [s, set] = createStore(Object.freeze({ a: 1 }) as { a: number });
    set(d => {
      d.a = 2;
    });
    flush();
    set(d => {
      d.a = 3;
    });
    flush();
    expect(s.a).toBe(3);
    expect(Object.isFrozen(snapshot(s))).toBe(false);
  });

  it("a non-plain defineProperty through the draft is preserved by later writes", () => {
    const [s, set] = createStore<{ a: number; ro?: number }>({ a: 1 });
    set(d => {
      Object.defineProperty(d, "ro", {
        value: 5,
        enumerable: false,
        writable: false,
        configurable: true
      });
    });
    flush();
    expect(s.ro).toBe(5);
    // Later writes must not launder `ro` into a plain enumerable slot.
    set(d => {
      d.a = 2;
    });
    flush();
    set(d => {
      d.a = 3;
    });
    flush();
    expect(s.a).toBe(3);
    expect(s.ro).toBe(5);
    expect(Object.keys(s)).toEqual(["a"]);
    // Enumerability is preserved; writability normalizes to writable on the
    // descriptor clone (R51: non-writable is writable through the store).
    expect(Object.getOwnPropertyDescriptor(snapshot(s), "ro")?.enumerable).toBe(false);
  });

  it("an accessor installed through the draft stays live", () => {
    const [s, set] = createStore<{ a: number; double?: number }>({ a: 1 });
    set(d => {
      Object.defineProperty(d, "double", {
        get() {
          return this.a * 2;
        },
        enumerable: true,
        configurable: true
      });
    });
    flush();
    set(d => {
      d.a = 21;
    });
    flush();
    expect(s.double).toBe(42);
  });

  it("a record that grows from empty past the overlay threshold keeps every key", () => {
    const [s, set] = createStore<Record<string, number>>({});
    const N = 200;
    for (let i = 0; i < N; i++) {
      set(d => {
        d[`k${i}`] = i;
      });
      flush();
    }
    expect(Object.keys(s)).toHaveLength(N);
    expect(s.k0).toBe(0);
    expect(s[`k${N - 1}`]).toBe(N - 1);
    // Deletes and re-adds keep working once the container is on the overlay path.
    set(d => {
      delete d.k0;
      d.k0 = -1;
      delete d.k1;
    });
    flush();
    expect(s.k0).toBe(-1);
    expect("k1" in s).toBe(false);
    expect(Object.keys(s)).toHaveLength(N - 1);
  });

  it("many narrow stores written in one batch each commit their own value", () => {
    const stores = Array.from({ length: 500 }, (_, i) => createStore({ value: i }));
    for (const [, set] of stores)
      set(d => {
        d.value = -d.value;
      });
    flush();
    stores.forEach(([s], i) => expect(s.value).toBe(-i));
  });
});
