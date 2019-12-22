import { createRoot, createSignal, createMemo } from "solid-js";
import { delay } from "../src"

describe("Delay operator", () => {
  test("simple delay", done => {
    createRoot(() => {
      const [s, set] = createSignal(),
        r = createMemo(delay(s, 10));
      expect(r()).not.toBeDefined();
      set("Hi");
      expect(r()).not.toBeDefined();
      setTimeout(() => {
        expect(r()).toBe("Hi");
        done();
      }, 15);
    });
  });

  test("simple delay curried", done => {
    createRoot(() => {
      const [s, set] = createSignal(),
        delayed = delay(10),
        r = createMemo(delayed(s));
      expect(r()).not.toBeDefined();
      set("Hi");
      expect(r()).not.toBeDefined();
      setTimeout(() => {
        expect(r()).toBe("Hi");
        done();
      }, 15);
    });
  });
});
