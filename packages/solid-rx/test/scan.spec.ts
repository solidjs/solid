import { createRoot, createSignal, createMemo } from "solid-js";
import { scan } from "../src"

describe("Scan operator", () => {
  test("simple scan", () => {
    createRoot(() => {
      const [s, set] = createSignal(1),
        r = createMemo(scan(s, (m, t) => m + t, 1));
      expect(r()).toBe(2);
      set(2);
      expect(r()).toBe(4);
    });
  });

  test("simple scan curried", () => {
    createRoot(() => {
      const [s, set] = createSignal(1),
        sum = scan<number, number>((m, t) => m + t, 1),
        r = createMemo(sum(s));
      expect(r()).toBe(2);
      set(2);
      expect(r()).toBe(4);
    });
  });
});
