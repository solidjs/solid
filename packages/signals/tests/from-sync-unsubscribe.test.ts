import { describe, expect, it } from "vitest";
import { from } from "../src/index.js";

describe("from() synchronous completion unsubscribe", () => {
  for (const synchronous of [false, true]) {
    for (const failed of [false, true]) {
      for (const object of [false, true]) {
        it(`contains teardown throws (sync=${synchronous}, failed=${failed}, object=${object})`, async () => {
          const sourceError = new Error("source failed");
          let finish!: () => void;
          let closed = 0;
          const iterator = from<number>((next, error, complete) => {
            if (!failed) next(7);
            finish = () => (failed ? error(sourceError) : complete());
            if (synchronous) finish();
            const unsubscribe = () => {
              closed++;
              throw new Error("unsubscribe failed");
            };
            return object ? { unsubscribe } : unsubscribe;
          })[Symbol.asyncIterator]();
          if (!synchronous) finish();
          if (failed) await expect(iterator.next()).rejects.toBe(sourceError);
          else expect(await iterator.next()).toEqual({ value: 7, done: false });
          expect(await iterator.next()).toEqual({ value: undefined, done: true });
          await iterator.return?.();
          expect(closed).toBe(1);
        });
      }
    }
  }
});
