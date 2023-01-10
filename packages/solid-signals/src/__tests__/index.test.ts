import { describe, it, expect } from "vitest";

import { createStore } from "../store";

describe("getters", () => {
  it("supports getters that return frozen objects", () => {
    const [store, setStore] = createStore({
      get foo() {
        return Object.freeze({ foo: "foo" });
      },
    });

    expect(() => store.foo).not.toThrow();
  });
});
