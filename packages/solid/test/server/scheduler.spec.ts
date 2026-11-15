import { describe, expect, test } from "vitest";
import { cancelCallback, requestCallback } from "../../src/server/index.js";

describe("scheduler on the server", () => {
  test("exports cancelCallback alongside requestCallback", () => {
    expect(cancelCallback).toBeTypeOf("function");
    const task = requestCallback(() => {});
    expect(() => cancelCallback(task)).not.toThrow();
  });
});
