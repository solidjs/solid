import { describe, expect, test } from "vitest";
import { createStore, produce, reconcile } from "../../store/src/server.js";

describe("null-prototype stores on the server", () => {
  test("runs producers on a null-prototype object", () => {
    const original = Object.assign(Object.create(null), { count: 1 });
    const [state, setState] = createStore<{ count: number }>(original);

    setState(produce(state => state.count++));

    expect(state.count).toBe(2);
    expect(state).toBe(original);
    expect(Object.getPrototypeOf(state)).toBeNull();
  });

  test("reconciles removed properties of a null-prototype object", () => {
    const original = Object.assign(Object.create(null), { count: 1, removed: true });
    const [state, setState] = createStore<{ count: number; removed?: boolean }>(original);

    setState(reconcile({ count: 2 }));

    expect(state.count).toBe(2);
    expect("removed" in state).toBe(false);
    expect(state).toBe(original);
    expect(Object.getPrototypeOf(state)).toBeNull();
  });

  test("merges partial updates into a nested null-prototype object", () => {
    const original = Object.assign(Object.create(null), { count: 1, label: "kept" });
    const [state, setState] = createStore<{ data: { count: number; label: string } }>({
      data: original
    });

    setState("data", { count: 2 });

    expect(state.data.count).toBe(2);
    expect(state.data.label).toBe("kept");
    expect(state.data).toBe(original);
    expect(Object.getPrototypeOf(state.data)).toBeNull();
  });
});
