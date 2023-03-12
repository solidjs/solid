/** @vitest-environment jsdom */
import { cancelCallback, requestCallback } from "../src";
import "./MessageChannel";

describe("requestCallback basics", () => {
  test("queue a task", () =>
    new Promise(done => {
      requestCallback(() => {
        done(undefined);
      });
    }));

  test("queue a task in correct order", () =>
    new Promise(done => {
      let count = 0;
      requestCallback(() => {
        expect(count).toBe(2);
        done(undefined);
      });
      requestCallback(
        () => {
          count++;
          expect(count).toBe(1);
        },
        { timeout: 10 }
      );
      requestCallback(
        () => {
          count++;
          expect(count).toBe(2);
        },
        { timeout: 40 }
      );
    }));

  test("supports cancelling a callback", () =>
    new Promise((done, reject) => {
      const task = requestCallback(() => {
        reject(new Error("should not be called"));
      });
      cancelCallback(task);
      requestCallback(() => done(undefined));
    }));
});
