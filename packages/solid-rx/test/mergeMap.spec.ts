import { createRoot, createSignal, createMemo } from "solid-js";
import { mergeMap } from "../src";

describe("Merge Map operator", () => {
  test("simple mergeMap", () => {
    createRoot(() => {
      const [s, set] = createSignal(1),
        [s2, set2] = createSignal(1),
        r = createMemo(mergeMap(s, t => () => t * s2()));
      expect(r()).toBe(1);
      set2(2);
      expect(r()).toBe(2);
      set(2);
      expect(r()).toBe(4);
      set2(3);
      expect(r()).toBe(6);
    });
  });

  test("simple mergeMap curried", () => {
    createRoot(() => {
      const [s, set] = createSignal(1),
        [s2, set2] = createSignal(1),
        multiply = mergeMap<number, number>(t => () => t * s2()),
        r = createMemo(multiply(s));
      expect(r()).toBe(1);
      set2(2);
      expect(r()).toBe(2);
      set(2);
      expect(r()).toBe(4);
      set2(3);
      expect(r()).toBe(6);
    });
  });
});
