import "./MessageChannel";
import { cancelCallback, requestCallback } from "../src";
//@ts-ignore

describe("requestCallback basics", () => {
  test("queue a task", done => {
    requestCallback(() => {
      done();
    });
  });

  test("queue a task in correct order", done => {
    let count = 0;
    requestCallback(() => {
      expect(count).toBe(2);
      done();
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
  });

  test("supports cancelling a callback", done => {
    const task = requestCallback(() => { done(new Error('should not be called')) });
    cancelCallback(task);
    requestCallback(done);
  });

});
