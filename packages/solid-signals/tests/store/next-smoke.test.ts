/**
 * Store rewrite increment 1 smoke — plain deep stores against the doc's
 * core rules: wrapping/identity, per-property tracking, signal-parity
 * batching (RUL-1 matrix), CoW privatization (no source mutation), draft
 * read-your-writes, transient-node laziness.
 */
import { describe, expect, it } from "vitest";
import { createEffect, createRoot, flush } from "../../src/index.js";
import { createStoreNext } from "../../src/store/next/store.js";
import { ownedRaw, storeNextLookup } from "../../src/store/next/target.js";

describe("store-next increment 1", () => {
  it("wraps, tracks per-property, and batches like signals", () => {
    const source = { a: 1, b: 2, nested: { c: 3 } };
    const [s, setS] = createStoreNext(source);
    expect(s.nested).not.toBe(source.nested); // wrapped
    expect(s.nested).toBe(s.nested); // stable proxy identity

    const seenA: number[] = [];
    const seenC: number[] = [];
    createRoot(() => {
      createEffect(
        () => s.a,
        v => {
          seenA.push(v);
        }
      );
      createEffect(
        () => s.nested.c,
        v => {
          seenC.push(v);
        }
      );
    });
    flush();
    expect(seenA).toEqual([1]);
    expect(seenC).toEqual([3]);

    setS(d => {
      d.a = 10;
    });
    // R24/R25: untracked context-free reads see committed until flush.
    expect(s.a).toBe(1);
    flush();
    expect(s.a).toBe(10);
    expect(seenA).toEqual([1, 10]);
    expect(seenC).toEqual([3]); // untouched leaf did not notify

    // Same-value write: no notification (R10).
    setS(d => {
      d.a = 10;
    });
    flush();
    expect(seenA).toEqual([1, 10]);

    // Nested write notifies only the nested subscriber.
    setS(d => {
      d.nested.c = 30;
    });
    flush();
    expect(seenC).toEqual([3, 30]);
    expect(seenA).toEqual([1, 10]);
  });

  it("drafts are read-your-writes; sources are never mutated (CoW)", () => {
    const source = { a: 1, nested: { c: 3 } };
    const [s, setS] = createStoreNext(source);
    createRoot(() => {
      createEffect(
        () => s.nested.c,
        () => {}
      );
    });
    flush();

    setS(d => {
      d.a = 5;
      expect(d.a).toBe(5); // read-your-writes inside the draft
      d.nested.c = 7;
      expect(d.nested.c).toBe(7);
    });
    flush();

    // View updated; user's source untouched at every level.
    expect(s.a).toBe(5);
    expect(s.nested.c).toBe(7);
    expect(source.a).toBe(1);
    expect(source.nested.c).toBe(3);

    // Backing privatized (owned), original still resolves to the same proxy.
    expect(storeNextLookup.get(source)).toBeDefined();
    expect(ownedRaw.has(storeNextLookup.get(source)!.b)).toBe(true);
    expect(storeNextLookup.get(source)!.b).not.toBe(source);
    expect(storeNextLookup.get(source)!.x).toBe(s);
  });

  it("writes outside the setter are silently ignored", () => {
    const [s] = createStoreNext({ a: 1 } as { a: number });
    expect(() => {
      (s as any).a = 99;
    }).not.toThrow();
    expect(s.a).toBe(1);
  });

  it("unobserved writes leave no permanent node (transient sweep)", () => {
    const source = { a: 1, b: 2 };
    const [s, setS] = createStoreNext(source);
    setS(d => {
      d.a = 42;
    });
    flush();
    expect(s.a).toBe(42);
    expect(source.a).toBe(1);
    const target = storeNextLookup.get(source)!;
    // Post-flush, the write-created node was swept (no subscribers).
    expect(target.n?.a).toBeUndefined();
    // Committed value lives in owned backing alone (single home).
    expect(target.b.a).toBe(42);
  });

  it("key add and delete round-trip", () => {
    const [s, setS] = createStoreNext({ a: 1 } as Record<string, number>);
    setS(d => {
      d.z = 9;
    });
    flush();
    expect(s.z).toBe(9);
    expect("z" in s).toBe(true);
    expect(Object.keys(s)).toEqual(["a", "z"]);

    setS(d => {
      delete d.z;
    });
    flush();
    expect(s.z).toBeUndefined();
    expect("z" in s).toBe(false);
    expect(Object.keys(s)).toEqual(["a"]);
  });
});
