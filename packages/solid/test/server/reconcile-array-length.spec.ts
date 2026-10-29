import { describe, expect, test } from "vitest";
import { createStore, reconcile, unwrap } from "../../store/src/server.js";

describe("reconcile array length on the server", () => {
  const cases: [string, (number | undefined)[], (number | undefined)[]][] = [
    ["shortens an array", [1, 2, 3], [4]],
    ["clears an array", [1, 2], []],
    ["grows an array", [1], [1, 2, 3]],
    ["preserves trailing undefined entries", [1], [1, undefined]],
    ["preserves sparse array length", [1], new Array(3)]
  ];

  test.each(cases)("%s at the root", (_, initial, next) => {
    const original = initial.slice();
    const [state, setState] = createStore(original);
    setState(reconcile(next));
    expect(state).toHaveLength(next.length);
    expect([...state]).toEqual([...next]);
    expect(unwrap(state)).toBe(original);
  });

  test.each(cases)("%s on a nested path", (_, initial, next) => {
    const original = initial.slice();
    const [state, setState] = createStore({ items: original });
    setState("items", reconcile(next));
    expect(state.items).toHaveLength(next.length);
    expect([...state.items]).toEqual([...next]);
    expect(unwrap(state.items)).toBe(original);
  });
});
