import { mapArray, indexArray, createSignal, createMemo, createRoot } from "../src";

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
