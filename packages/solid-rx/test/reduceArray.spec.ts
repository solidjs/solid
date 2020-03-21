import { createRoot, createSignal, createMemo } from "solid-js";
import { reduceArray } from "../src";

describe("Reduce operator", () => {
  test("simple addition", () => {
    createRoot(() => {
      const [s, set] = createSignal([1, 2, 3, 4]),
        r = createMemo(reduceArray(s, (m: number, v: number) => m + v, 0));
      expect(r()).toBe(10);
      set([3, 4, 5]);
      expect(r()).toBe(12);
    });
  });

  test("simple addition curried", () => {
    createRoot(() => {
      const [s, set] = createSignal([1, 2, 3, 4]),
        sum = reduceArray((m: number, v: number) => m + v, 0),
        r = createMemo(sum(s));
      expect(r()).toBe(10);
      set([3, 4, 5]);
      expect(r()).toBe(12);
    });
  });

  test("filter list", () => {
    createRoot(() => {
      const [s, set] = createSignal([1, 2, 3, 4]),
        filterOdd = reduceArray((m: number[], v: number) => (v % 2 ? [...m, v] : m), []),
        r = createMemo(filterOdd(s));
      expect(r()).toEqual([1, 3]);
      set([3, 4, 5]);
      expect(r()).toEqual([3, 5]);
    });
  });
});
