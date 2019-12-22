import { createRoot, createSignal, createEffect } from "solid-js";
import { tap } from "../src"

describe("Tap operator", () => {
  test("simple tap", () => {
    createRoot(() => {
      const [s, set] = createSignal("Hi");
      let out: string;
      createEffect(tap(s, t => out = t + " " + t));
      expect(out).toBe("Hi Hi");
      set("Lo");
      expect(out).toBe("Lo Lo");
    });
  });

  test("simple tap curried", () => {
    createRoot(() => {
      let out: string;
      const [s, set] = createSignal("Hi"),
        repeat = tap(t => out = t + " " + t);
      createEffect(repeat(s));
      expect(out).toBe("Hi Hi");
      set("Lo");
      expect(out).toBe("Lo Lo");
    });
  });
});