import { describe, expect, test } from "vitest";
import { from } from "../../src/server/index.js";

describe("from on the server", () => {
  test("starts with the initial value when given a producer function", () => {
    const value = from(() => () => {}, "initial");
    expect(value()).toBe("initial");
  });

  test("starts with the initial value when given an observable", () => {
    const value = from({ subscribe: () => () => {} }, "initial");
    expect(value()).toBe("initial");
  });

  test("lets a value set synchronously by the producer replace the initial value", () => {
    const value = from(set => {
      set("next");
      return () => {};
    }, "initial");
    expect(value()).toBe("next");
  });

  test("starts as undefined without an initial value", () => {
    const value = from(() => () => {});
    expect(value()).toBeUndefined();
  });
});
