import { mapArray, createSignal, createMemo, createRoot } from "../src";

describe("Map operator", () => {
  test("simple mapArray", () => {
    createRoot(() => {
      const [s, set] = createSignal([1, 2, 3, 4]),
        r = createMemo(mapArray(s, (v: number) => v * 2));
      expect(r()).toEqual([2, 4, 6, 8]);
      set([3, 4, 5]);
      expect(r()).toEqual([6, 8, 10]);
    });
  });

  test("simple mapArray curried", () => {
    createRoot(() => {
      const [s, set] = createSignal([1, 2, 3, 4]),
        double = mapArray((v: number) => v * 2),
        r = createMemo(double(s));
      expect(r()).toEqual([2, 4, 6, 8]);
      set([3, 4, 5]);
      expect(r()).toEqual([6, 8, 10]);
    });
  });

  test("show fallback", () => {
    createRoot(() => {
      const [s, set] = createSignal([1, 2, 3, 4]),
        double = mapArray<number, number | string>(v => v * 2, {
          fallback: () => "Empty"
        }),
        r = createMemo(double(s));
      expect(r()).toEqual([2, 4, 6, 8]);
      set([]);
      expect(r()).toEqual(["Empty"]);
      set([3, 4, 5]);
      expect(r()).toEqual([6, 8, 10]);
    });
  });
});
