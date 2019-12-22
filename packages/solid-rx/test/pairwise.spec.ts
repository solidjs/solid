import { createRoot, createSignal, createMemo } from "solid-js";
import { pairwise } from "../src";

describe("Pairwise operator", () => {
  test("simple pairwise", () => {
    createRoot(() => {
      const [s, set] = createSignal("Hi"),
        r = createMemo(pairwise(s));
      expect(r()).toEqual([undefined, "Hi"]);
      set("Lo");
      expect(r()).toEqual(["Hi", "Lo"]);
    });
  });

  test("simple pairwise curried", () => {
    createRoot(() => {
      const [s, set] = createSignal("Hi"),
        pair = pairwise(),
        r = createMemo(pair(s));
      expect(r()).toEqual([undefined, "Hi"]);
      set("Lo");
      expect(r()).toEqual(["Hi", "Lo"]);
    });
  });
});
