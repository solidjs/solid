import { createRoot, createSignal, createMemo, createEffect } from "solid-js";
import { filter } from "../src"

describe("Filter operator", () => {
  test("simple filter", () => {
    createRoot(() => {
      const [s, set] = createSignal(0),
        r = createMemo(filter(s, n => n % 2 === 0));
      let executions = 0;
      createEffect(() => {
        r();
        executions++;
      })
      expect(r()).toBe(0);
      expect(executions).toBe(1);
      set(1);
      expect(r()).toBe(0);
      expect(executions).toBe(1);
      set(2);
      expect(r()).toBe(2);
      expect(executions).toBe(2);
      set(3);
      expect(r()).toBe(2);
      expect(executions).toBe(2);
      set(4);
      expect(r()).toBe(4);
      expect(executions).toBe(3);
    });
  });

  test("simple filter curried", () => {
    createRoot(() => {
      const [s, set] = createSignal(0),
        even = filter<number>(n => n % 2 === 0),
        r = createMemo(even(s));
      let executions = 0;
      createEffect(() => {
        r();
        executions++;
      })
      expect(r()).toBe(0);
      expect(executions).toBe(1);
      set(1);
      expect(r()).toBe(0);
      expect(executions).toBe(1);
      set(2);
      expect(r()).toBe(2);
      expect(executions).toBe(2);
      set(3);
      expect(r()).toBe(2);
      expect(executions).toBe(2);
      set(4);
      expect(r()).toBe(4);
      expect(executions).toBe(3);
    });
  });
});
