import { describe, expect, test, vi } from "vitest";
import {
  mapArray,
  indexArray,
  createSignal,
  createMemo,
  createRoot,
  onCleanup
} from "../src/index.js";

describe("Map operator", () => {
  test("simple mapArray", () => {
    createRoot(() => {
      const [s, set] = createSignal([1, 2, 3, 4]),
        r = createMemo(mapArray(s, v => v * 2));
      expect(r()).toEqual([2, 4, 6, 8]);
      set([3, 4, 5]);
      expect(r()).toEqual([6, 8, 10]);
    });
  });

  test("show fallback", () => {
    createRoot(() => {
      const [s, set] = createSignal([1, 2, 3, 4]),
        double = mapArray<number, number | string>(s, v => v * 2, {
          fallback: () => "Empty"
        }),
        r = createMemo(double);
      expect(r()).toEqual([2, 4, 6, 8]);
      set([]);
      expect(r()).toEqual(["Empty"]);
      set([3, 4, 5]);
      expect(r()).toEqual([6, 8, 10]);
    });
  });

  test("reuses mapped items and updates their indexes when reordered", () => {
    createRoot(dispose => {
      const a = {},
        b = {},
        c = {},
        d = {},
        e = {};
      const [list, setList] = createSignal([a, b, c, d]);
      const mapped = createMemo(
        mapArray(list, (value, index) => {
          const cleanup = vi.fn();
          onCleanup(cleanup);
          return { value, index, cleanup };
        })
      );
      const initial = mapped().slice();

      setList([a, d, c, e]);
      const inserted = mapped()[3];
      expect(mapped()[0]).toBe(initial[0]);
      expect(mapped()[1]).toBe(initial[3]);
      expect(mapped()[2]).toBe(initial[2]);
      expect(inserted.value).toBe(e);
      expect(mapped().map(item => item.index())).toEqual([0, 1, 2, 3]);
      expect(initial[1].cleanup).toHaveBeenCalledTimes(1);
      for (const item of mapped()) expect(item.cleanup).not.toHaveBeenCalled();

      setList([e, a, d]);
      expect(mapped()[0]).toBe(inserted);
      expect(mapped()[1]).toBe(initial[0]);
      expect(mapped()[2]).toBe(initial[3]);
      expect(mapped().map(item => item.index())).toEqual([0, 1, 2]);
      expect(initial[2].cleanup).toHaveBeenCalledTimes(1);

      dispose();
      for (const item of [...initial, inserted]) expect(item.cleanup).toHaveBeenCalledTimes(1);
    });
  });

  test("keeps separate mapped items for duplicate values and disposes removed occurrences", () => {
    createRoot(dispose => {
      const a = { id: "a" },
        b = { id: "b" },
        c = { id: "c" };
      const [list, setList] = createSignal([a, b, a, c, a]);
      const mapped = createMemo(
        mapArray(list, (value, index) => {
          const cleanup = vi.fn();
          onCleanup(cleanup);
          return { value, index, cleanup };
        })
      );
      const initial = mapped().slice();
      expect(new Set(initial).size).toBe(5);

      setList([c, a, b, a]);
      const retained = mapped().slice();
      expect(retained.map(item => item.value)).toEqual([c, a, b, a]);
      expect(retained.map(item => item.index())).toEqual([0, 1, 2, 3]);
      expect(new Set(retained).size).toBe(4);
      for (const item of retained) {
        expect(initial).toContain(item);
        expect(item.cleanup).not.toHaveBeenCalled();
      }
      const removed = initial.filter(item => !retained.includes(item));
      expect(removed).toHaveLength(1);
      expect(removed[0].value).toBe(a);
      expect(removed[0].cleanup).toHaveBeenCalledTimes(1);

      setList([b, a, c, a, b]);
      const expanded = mapped().slice();
      expect(expanded.map(item => item.value)).toEqual([b, a, c, a, b]);
      expect(expanded.map(item => item.index())).toEqual([0, 1, 2, 3, 4]);
      expect(new Set(expanded).size).toBe(5);
      for (const item of retained) expect(expanded).toContain(item);
      const added = expanded.filter(item => !retained.includes(item));
      expect(added).toHaveLength(1);
      expect(added[0].value).toBe(b);

      setList([]);
      expect(mapped()).toEqual([]);
      for (const item of [...initial, ...added]) expect(item.cleanup).toHaveBeenCalledTimes(1);
      dispose();
      for (const item of [...initial, ...added]) expect(item.cleanup).toHaveBeenCalledTimes(1);
    });
  });
});

describe("Index operator", () => {
  test("simple indexArray", () => {
    createRoot(() => {
      const [s, set] = createSignal([1, 2, 3, 4]),
        r = createMemo(indexArray(s, v => v() * 2));
      expect(r()).toEqual([2, 4, 6, 8]);
    });
  });

  test("show fallback", () => {
    createRoot(() => {
      const [s, set] = createSignal([1, 2, 3, 4]),
        double = indexArray<number, number | string>(s, v => v() * 2, {
          fallback: () => "Empty"
        }),
        r = createMemo(double);
      expect(r()).toEqual([2, 4, 6, 8]);
      set([]);
      expect(r()).toEqual(["Empty"]);
      set([3, 4, 5]);
      expect(r()).toEqual([6, 8, 10]);
    });
  });
});
