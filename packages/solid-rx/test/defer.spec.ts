import { createRoot, createSignal, createMemo } from "solid-js";
import { defer } from "../src";
import { MessageChannel } from "worker_threads";
//@ts-ignore
global.MessageChannel = MessageChannel;

describe("Defer operator", () => {
  test("simple defer", done => {
    createRoot(() => {
      const [s, set] = createSignal(),
        r = createMemo(defer(s, { timeoutMs: 20 }));
      expect(r()).not.toBeDefined();
      set("Hi");
      expect(r()).not.toBeDefined();
      setTimeout(() => {
        expect(r()).toBe("Hi");
        done();
      }, 25);
    });
  });

  test("simple defer curried", done => {
    createRoot(() => {
      const [s, set] = createSignal(),
        deferred = defer({ timeoutMs: 20 }),
        r = createMemo(deferred(s));
      expect(r()).not.toBeDefined();
      set("Hi");
      expect(r()).not.toBeDefined();
      setTimeout(() => {
        expect(r()).toBe("Hi");
        done();
      }, 25);
    });
  });
});
