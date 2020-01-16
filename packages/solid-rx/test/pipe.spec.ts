import { createRoot, createSignal, createMemo } from "solid-js";
import { pipe } from "../src";

describe("Pipe operator", () => {
  const multiply = (m: number) => (s: () => number) => () => s() * m;
  test("no ops", () => {
    createRoot(() => {
      const [s, set] = createSignal(0),
        r = createMemo(pipe()(s));
      expect(r()).toBe(0);
      set(2);
      expect(r()).toBe(2);
    });
  });

  test("single op", () => {
    createRoot(() => {
      const [s, set] = createSignal(1),
        r = createMemo(pipe(multiply(2))(s));
      expect(r()).toBe(2);
      set(2);
      expect(r()).toBe(4);
    });
  });

  test("multiple ops", () => {
    createRoot(() => {
      const [s, set] = createSignal(1),
        r = createMemo(pipe(multiply(2), multiply(3))(s));
      expect(r()).toBe(6);
      set(2);
      expect(r()).toBe(12);
    });
  });
});
