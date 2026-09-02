import { describe, expect, it, vi } from "vitest";
import { createSignal, flush, mapArray } from "../src/index.js";

/** SMALL-MOVE fast path (jfb-reorder profile, 2026-09-02): after prefix/
 * suffix trimming, a same-length window whose mismatches are ≤K displaced
 * identities commits as k in-place patches over sliced arrays — no window
 * Map, no staging arrays. These tests pin the semantics the fast path must
 * preserve: mapped identity moves with the item, the mapper never re-runs
 * for moved rows, index accessors update for exactly the moved positions,
 * and every non-move shape (replacement, duplicates, adds) still lands in
 * the general path with correct results. */

function rotateF<T>(a: readonly T[]): T[] {
  return [...a.slice(1), a[0]];
}
function rotateB<T>(a: readonly T[]): T[] {
  return [a[a.length - 1], ...a.slice(0, -1)];
}
function displace<T>(a: readonly T[], k: number): T[] {
  // move k evenly-spaced rows to new positions (jfb displace shape)
  const next = [...a];
  for (let i = 0; i < k; i++) {
    const from = Math.floor(((i + 1) * next.length) / (k + 2));
    const [row] = next.splice(from, 1);
    next.splice((from + 7) % next.length, 0, row);
  }
  return next;
}

function harness(n = 50) {
  const items = Array.from({ length: n }, (_, i) => ({ id: i }));
  const [$src, setSrc] = createSignal(items);
  const mapper = vi.fn((value: { id: number }, index: () => number) => ({
    item: value,
    get index() {
      return index();
    }
  }));
  const map = mapArray($src, mapper);
  map();
  return { $src, setSrc, map, mapper, items };
}

describe("mapArray small-move semantics", () => {
  it("rotate forward preserves every mapped identity and re-runs no mappers", () => {
    const { setSrc, map, mapper } = harness();
    const before = map();
    mapper.mockClear();
    setSrc(p => rotateF(p));
    flush();
    const after = map();
    expect(mapper).not.toHaveBeenCalled();
    expect(after.length).toBe(before.length);
    // row 0 moved to the end; everyone else shifted up one position
    expect(after[after.length - 1]).toBe(before[0]);
    for (let i = 0; i < after.length - 1; i++) expect(after[i]).toBe(before[i + 1]);
    // index accessors reflect the new positions
    after.forEach((m, i) => expect(m.index).toBe(i));
    // fresh array identity for downstream change propagation
    expect(after).not.toBe(before);
  });

  it("rotate backward preserves identity", () => {
    const { setSrc, map, mapper } = harness();
    const before = map();
    mapper.mockClear();
    setSrc(p => rotateB(p));
    flush();
    const after = map();
    expect(mapper).not.toHaveBeenCalled();
    expect(after[0]).toBe(before[before.length - 1]);
    for (let i = 1; i < after.length; i++) expect(after[i]).toBe(before[i - 1]);
    after.forEach((m, i) => expect(m.index).toBe(i));
  });

  it("displace-k preserves identity for k = 3..8", () => {
    for (const k of [3, 4, 5, 6, 8]) {
      const { setSrc, map, mapper, items } = harness(60);
      const before = map();
      const byItem = new Map(before.map(m => [m.item, m]));
      mapper.mockClear();
      setSrc(p => displace(p, k));
      flush();
      const after = map();
      expect(mapper).not.toHaveBeenCalled();
      expect(after.length).toBe(items.length);
      after.forEach((m, i) => {
        expect(byItem.get(m.item)).toBe(m); // identity moved with the item
        expect(m.index).toBe(i);
      });
    }
  });

  it("adjacent swap (jfb swap) preserves identity", () => {
    const { setSrc, map, mapper } = harness(20);
    const before = map();
    mapper.mockClear();
    setSrc(p => {
      const next = [...p];
      const tmp = next[1];
      next[1] = next[18];
      next[18] = tmp;
      return next;
    });
    flush();
    const after = map();
    expect(mapper).not.toHaveBeenCalled();
    expect(after[1]).toBe(before[18]);
    expect(after[18]).toBe(before[1]);
    expect(after[1].index).toBe(1);
    expect(after[18].index).toBe(18);
  });

  it("REPLACEMENT inside a same-length window creates a new row and disposes the old", () => {
    const { setSrc, map, mapper } = harness(10);
    const before = map();
    mapper.mockClear();
    const fresh = { id: 99 };
    setSrc(p => {
      const next = [...p];
      next[4] = fresh; // same length, not a move — must NOT fast-path
      return next;
    });
    flush();
    const after = map();
    expect(mapper).toHaveBeenCalledTimes(1);
    expect(after[4].item).toBe(fresh);
    for (let i = 0; i < 10; i++) {
      if (i !== 4) expect(after[i]).toBe(before[i]);
    }
  });

  it("MIXED move + replacement in one window stays correct", () => {
    const { setSrc, map, mapper } = harness(12);
    const before = map();
    mapper.mockClear();
    const fresh = { id: 77 };
    setSrc(p => {
      const next = [...p];
      // swap 2 and 9, replace 5
      const tmp = next[2];
      next[2] = next[9];
      next[9] = tmp;
      next[5] = fresh;
      return next;
    });
    flush();
    const after = map();
    expect(mapper).toHaveBeenCalledTimes(1);
    expect(after[2]).toBe(before[9]);
    expect(after[9]).toBe(before[2]);
    expect(after[5].item).toBe(fresh);
    after.forEach((m, i) => expect(m.index).toBe(i));
  });

  it("DUPLICATE items moving within the window stay correct", () => {
    const dup = { id: 1000 };
    const items = [{ id: 0 }, dup, { id: 2 }, dup, { id: 4 }, { id: 5 }];
    const [$src, setSrc] = createSignal(items);
    const map = mapArray($src, (value: any, index: () => number) => ({
      item: value,
      get index() {
        return index();
      }
    }));
    const before = map();
    setSrc(p => {
      // move both duplicates and a neighbor
      return [p[1], p[0], p[2], p[4], p[3], p[5]];
    });
    flush();
    const after = map();
    expect(after.map(m => m.item)).toEqual([dup, items[0], items[2], items[4], dup, items[5]]);
    after.forEach((m, i) => expect(m.index).toBe(i));
    expect(new Set(after).size).toBe(6); // no shared mapped rows
    expect(before.filter(m => after.includes(m)).length).toBe(6); // all reused
  });

  it("custom-keyed small moves match by KEY, not identity", () => {
    const [$src, setSrc] = createSignal([
      { id: "a", v: 1 },
      { id: "b", v: 1 },
      { id: "c", v: 1 }
    ]);
    const mapper = vi.fn((value: () => any, index: () => number) => ({
      get id() {
        return value().id;
      },
      get v() {
        return value().v;
      },
      get index() {
        return index();
      }
    }));
    const map = mapArray($src, mapper, { keyed: (item: any) => item.id });
    const [a, b, c] = map();
    mapper.mockClear();
    // rotate with FRESH objects (same keys, new identities, new values)
    setSrc([
      { id: "b", v: 2 },
      { id: "c", v: 2 },
      { id: "a", v: 2 }
    ]);
    flush();
    const [x, y, z] = map();
    expect(mapper).not.toHaveBeenCalled();
    expect(x).toBe(b);
    expect(y).toBe(c);
    expect(z).toBe(a);
    // row signals must carry the NEW objects' values
    expect(x.v).toBe(2);
    expect(y.v).toBe(2);
    expect(z.v).toBe(2);
    expect(x.index).toBe(0);
    expect(y.index).toBe(1);
    expect(z.index).toBe(2);
  });

  it("large scrambles (beyond the fast-path bound) still work via the general path", () => {
    const { setSrc, map, mapper } = harness(200);
    const before = map();
    const byItem = new Map(before.map(m => [m.item, m]));
    mapper.mockClear();
    setSrc(p => {
      // seeded shuffle — far more than K displaced
      const next = [...p];
      let seed = 42;
      for (let i = next.length - 1; i > 0; i--) {
        seed = (seed * 16807) % 2147483647;
        const j = seed % (i + 1);
        const tmp = next[i];
        next[i] = next[j];
        next[j] = tmp;
      }
      return next;
    });
    flush();
    const after = map();
    expect(mapper).not.toHaveBeenCalled();
    after.forEach((m, i) => {
      expect(byItem.get(m.item)).toBe(m);
      expect(m.index).toBe(i);
    });
  });

  it("jfb-scale (1000 rows): rotate/displace/swap/removefirst all preserve identity", () => {
    for (const op of [
      (p: any[]) => rotateF(p),
      (p: any[]) => rotateB(p),
      (p: any[]) => displace(p, 8),
      (p: any[]) => {
        const next = [...p];
        const tmp = next[1];
        next[1] = next[998];
        next[998] = tmp;
        return next;
      },
      (p: any[]) => p.slice(1)
    ]) {
      const { setSrc, map, mapper } = harness(1000);
      const before = map();
      const byItem = new Map(before.map(m => [m.item, m]));
      mapper.mockClear();
      setSrc(p => op(p as any[]) as any);
      flush();
      const after = map();
      expect(mapper).not.toHaveBeenCalled();
      after.forEach((m, i) => {
        expect(byItem.get(m.item)).toBe(m);
        expect(m.index).toBe(i);
      });
    }
  });

  it("removefirst (length change) keeps identities through the general path", () => {
    const { setSrc, map, mapper } = harness(30);
    const before = map();
    mapper.mockClear();
    setSrc(p => p.slice(1));
    flush();
    const after = map();
    expect(mapper).not.toHaveBeenCalled();
    expect(after.length).toBe(29);
    for (let i = 0; i < 29; i++) expect(after[i]).toBe(before[i + 1]);
    after.forEach((m, i) => expect(m.index).toBe(i));
  });
});
