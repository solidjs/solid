import { createReaction, createRoot, createSignal, flushSync } from "../src/index.js";

describe("createReaction", () => {
  test("Create and trigger a Reaction", () => {
    createRoot(() => {
      let count = 0;
      let value;
      const [sign, setSign] = createSignal("thoughts");
      const track = createReaction(() => {
        count++;
        value = sign();
      });
      expect(count).toBe(0);
      expect(value).toBe("thoughts");
      track(sign); // track
      expect(count).toBe(0);
      expect(value).toBe("thoughts");
      flushSync();
      expect(count).toBe(0);
      expect(value).toBe("thoughts");
      setSign("mind");
      flushSync(); // no longer tracking
      expect(count).toBe(1);
      expect(value).toBe("mind");
      setSign("body");
      flushSync();
      expect(count).toBe(1);
      expect(value).toBe("mind");
      track(sign); // track again
      setSign("everything");
      flushSync();
      expect(count).toBe(2);
      expect(value).toBe("everything");
    });
  });
});
