import { createRoot, createSignal, createMemo } from "solid-js";
import { map } from "../src";

describe("Map operator", () => {
  test("simple map", () => {
    createRoot(() => {
      const [s, set] = createSignal("Hi"),
        r = createMemo(map(s, t => t + " " + t));
      expect(r()).toBe("Hi Hi");
      set("Lo");
      expect(r()).toBe("Lo Lo");
    });
  });

  test("simple map curried", () => {
    createRoot(() => {
      const [s, set] = createSignal("Hi"),
        repeat = map(t => t + " " + t),
        r = createMemo(repeat(s));
      expect(r()).toBe("Hi Hi");
      set("Lo");
      expect(r()).toBe("Lo Lo");
    });
  });
});
