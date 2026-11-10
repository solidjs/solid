import { describe, expect, test } from "vitest";
import { createStore } from "../../store/src/server.js";

describe("createStore initial state on the server", () => {
  test("initializes an empty store when the initial value is omitted", () => {
    const [state, setState] = createStore();
    expect(state).toEqual({});
    setState({ greeting: "hello" });
    expect(state).toEqual({ greeting: "hello" });
  });

  test("initializes an empty store when the initial value is undefined", () => {
    const [state, setState] = createStore<{ greeting?: string }>(undefined);
    expect(state).toEqual({});
    setState("greeting", "hello");
    expect(state.greeting).toBe("hello");
  });

  test("creates a separate object for each empty store", () => {
    const [first, setFirst] = createStore();
    const [second] = createStore();
    expect(first).not.toBe(second);
    setFirst({ greeting: "hello" });
    expect(second).toEqual({});
  });

  test("preserves the identity and updates of an initial object", () => {
    const initial = { greeting: "hello" };
    const [state, setState] = createStore(initial);
    expect(state).toBe(initial);
    setState("greeting", "hi");
    expect(state).toEqual({ greeting: "hi" });
  });

  test("preserves the identity and updates of an initial array", () => {
    const initial = [1, 2];
    const [state, setState] = createStore(initial);
    expect(state).toBe(initial);
    setState([3]);
    expect(state).toEqual([3]);
  });
});
