import { createRoot } from "solid-js";
import { from } from "../src";

describe("From operator", () => {
  test("from promise", async () => {
    let resolve;
    const signal = from<string>(set => {
      new Promise(r => (resolve = r)).then(set);
    });
    expect(signal()).toBeUndefined();
    resolve("Hi");
    await Promise.resolve();
    expect(signal()).toBe("Hi");
  });

  test("from interval", done => {
    createRoot(dispose => {
      let i = 0,
        disposed = false;
      const signal = from<number>(set => {
        const n = setInterval(() => set(++i), 20);
        return () => ((disposed = true), clearInterval(n));
      });
      expect(signal()).toBeUndefined();
      expect(disposed).toBe(false);
      setTimeout(() => expect(signal()).toBe(1), 35);
      setTimeout(() => expect(signal()).toBe(2), 55);
      setTimeout(() => {
        expect(signal()).toBe(3);
        dispose();
        expect(disposed).toBe(true);
        done();
      }, 75);
    });
  });
});
