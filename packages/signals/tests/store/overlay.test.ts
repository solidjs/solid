import { describe, expect, it } from "vitest";
import { createEffect, createRoot, createStore, flush, snapshot } from "../../src/index.js";

/**
 * Prototype-overlay pending backings (#3044): plain-data object drafts open
 * as `Object.create(committed)` — O(written) per flush — with deletes
 * tracked aside and commit flattening in place. These tests pin the overlay
 * semantics directly (the fix landed as 222 implementation lines; this is
 * its targeted coverage) plus the adoption-reset staleness class the audit
 * flagged: adoptPB must not carry `ovl`/`del`/`sc`/`a` from the outgoing
 * backing onto a swapped-in container.
 */
describe("overlay pending backings (#3044)", () => {
  it("in-draft reads see writes and merged keys; committed stays clean until flush", () => {
    const source = { a: 1, b: 2 };
    const [store, setStore] = createStore(source);
    setStore(s => {
      s.a = 10;
      (s as any).c = 3;
      expect(s.a).toBe(10);
      expect(s.b).toBe(2); // read-through to committed
      expect((s as any).c).toBe(3);
      expect(Object.keys(s)).toEqual(["a", "b", "c"]);
      expect("c" in s).toBe(true);
    });
    // Never mutate user-ingested data (privatize-on-commit).
    flush();
    expect(source.a).toBe(1);
    expect((source as any).c).toBeUndefined();
    expect(store.a).toBe(10);
    expect((store as any).c).toBe(3);
  });

  it("deletes read as absent in the draft and commit for real", () => {
    const [store, setStore] = createStore<{ a: number; b?: number }>({ a: 1, b: 2 });
    setStore(s => {
      delete s.b;
      expect(s.b).toBeUndefined();
      expect("b" in s).toBe(false);
      expect(Object.keys(s)).toEqual(["a"]);
      expect(Object.getOwnPropertyDescriptor(s, "b")).toBeUndefined();
    });
    flush();
    expect("b" in store).toBe(false);
    expect(Object.keys(store)).toEqual(["a"]);
  });

  it("delete then rewrite in one draft restores the key", () => {
    const [store, setStore] = createStore<{ a?: number }>({ a: 1 });
    setStore(s => {
      delete s.a;
      s.a = 5;
      expect(s.a).toBe(5);
      expect("a" in s).toBe(true);
    });
    flush();
    expect(store.a).toBe(5);
  });

  it("writes through non-writable committed properties (R51 parity)", () => {
    const source: { locked?: string } = {};
    Object.defineProperty(source, "locked", {
      value: "sealed",
      writable: false,
      enumerable: true,
      configurable: false
    });
    const [store, setStore] = createStore(source);
    setStore(s => {
      s.locked = "open";
      expect(s.locked).toBe("open");
    });
    flush();
    expect(store.locked).toBe("open");
  });

  it("repeated few-key writes into a wide store stay O(written) (#3044 shape)", () => {
    const [, setStore] = createStore<Record<string, boolean>>({});
    const N = 2000;
    const start = performance.now();
    for (let i = 1; i < N; i++) {
      setStore(s => {
        s[i - 1] = false;
        s[i] = true;
      });
      flush();
    }
    // The quadratic clone regime measured ~350ms here; overlays take ~5ms.
    // Generous bound so CI noise never flakes, while the O(N²) regime fails.
    expect(performance.now() - start).toBeLessThan(150);
  });

  it("adoption resets overlay state: no crash and no stale view after a setter-return replacement", () => {
    const [store, setStore] = createStore<{ a?: number; b?: number }>({ a: 1, b: 2 });
    setStore(s => {
      s.a = 9; // opens an overlay
      delete s.b; // populates the delete set
      return { a: 100, b: 200 }; // adoption discards the overlay
    });
    // Stale `ovl` beside a nulled pb crashed materializePB through
    // snapshot/unwrapValue before the reset.
    expect(() => snapshot(store)).not.toThrow();
    flush();
    expect(store.a).toBe(100);
    // Stale `del` would read the adoptee's `b` as deleted.
    expect(store.b).toBe(200);
    expect("b" in store).toBe(true);
    expect(Object.keys(store)).toEqual(["a", "b"]);
  });

  it("adoption resets the accessor-scan verdict: an accessor-bearing adoptee leaves the overlay path", () => {
    const [store, setStore] = createStore<{ value: number }>({ value: 1 });
    // First draft scans the plain backing (overlay-eligible verdict).
    setStore(s => {
      s.value = 2;
    });
    flush();
    // Adopt an accessor-bearing container: the stale plain verdict must not
    // admit it to the overlay path — an overlay write would define an own
    // data prop that SHADOWS the setter instead of invoking it.
    const withAccessor = {
      _v: 3,
      get value() {
        return this._v;
      },
      set value(n: number) {
        this._v = n * 10;
      }
    };
    setStore(() => withAccessor as any);
    flush();
    expect(store.value).toBe(3);
    // The setter must run AT WRITE TIME (R29 installed accessors stay
    // live): the clone path invokes it (draft reads 5 * 10 = 50); a stale
    // overlay verdict shadows it with an own data prop (draft reads 5) and
    // only the commit-time flatten rescues the final value.
    setStore(s => {
      s.value = 5;
      expect(s.value).toBe(50);
    });
    flush();
    expect(store.value).toBe(50);
  });

  it("draft self-reference escaping into the store materializes (cycle preserved)", () => {
    const [store, setStore] = createStore<{ node: { name: string; self?: unknown } }>({
      node: { name: "n" }
    });
    setStore(s => {
      s.node.self = s.node;
    });
    flush();
    const snap = snapshot(store);
    expect(snap.node.self as any).toBe(snap.node);
  });

  it("overlay writes notify observers exactly like clone-path writes", () => {
    const [store, setStore] = createStore<{ a: number; b?: number }>({ a: 1, b: 2 });
    let reads: number[] = [];
    let keys = 0;
    createRoot(() => {
      createEffect(
        () => store.a,
        v => {
          reads.push(v);
        }
      );
      createEffect(
        () => Object.keys(store).length,
        n => {
          keys = n;
        }
      );
    });
    flush();
    expect(reads).toEqual([1]);
    expect(keys).toBe(2);
    setStore(s => {
      s.a = 7;
      delete s.b;
    });
    flush();
    expect(reads).toEqual([1, 7]);
    expect(keys).toBe(1);
  });
});
