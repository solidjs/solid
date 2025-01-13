import { describe, expect, test } from "vitest";
import { createStore, reconcile, unwrap } from "../../src/index.js";

describe("setState with reconcile", () => {
  test("Reconcile a simple object", () => {
    const [state, setState] = createStore<{ data: number; missing?: string }>({
      data: 2,
      missing: "soon"
    });
    expect(state.data).toBe(2);
    expect(state.missing).toBe("soon");
    setState(reconcile({ data: 5 }, "id"));
    expect(state.data).toBe(5);
    expect(state.missing).toBeUndefined();
  });

  test("Reconcile array with nulls", () => {
    const [state, setState] = createStore<Array<string | null>>([null, "a"]);
    expect(state[0]).toBe(null);
    expect(state[1]).toBe("a");
    setState(reconcile(["b", null], "id"));
    expect(state[0]).toBe("b");
    expect(state[1]).toBe(null);
  });

  test("Reconcile a simple object on a nested path", () => {
    const [state, setState] = createStore<{
      data: { user: { firstName: string; middleName: string; lastName?: string } };
    }>({
      data: { user: { firstName: "John", middleName: "", lastName: "Snow" } }
    });
    expect(state.data.user.firstName).toBe("John");
    expect(state.data.user.lastName).toBe("Snow");
    setState(s => {
      s.data.user = reconcile({ firstName: "Jake", middleName: "R" }, "id")(s.data.user);
    });
    expect(state.data.user.firstName).toBe("Jake");
    expect(state.data.user.middleName).toBe("R");
    expect(state.data.user.lastName).toBeUndefined();
  });

  test("Reconcile reorder a keyed array", () => {
    const JOHN = { id: 1, firstName: "John", lastName: "Snow" },
      NED = { id: 2, firstName: "Ned", lastName: "Stark" },
      BRANDON = { id: 3, firstName: "Brandon", lastName: "Start" },
      ARYA = { id: 4, firstName: "Arya", lastName: "Start" };
    const [state, setState] = createStore({ users: [JOHN, NED, BRANDON] });
    expect(Object.is(unwrap(state.users[0]), JOHN)).toBe(true);
    expect(Object.is(unwrap(state.users[1]), NED)).toBe(true);
    expect(Object.is(unwrap(state.users[2]), BRANDON)).toBe(true);
    setState(s => {
      s.users = reconcile([NED, JOHN, BRANDON], "id")(s.users);
    });
    expect(Object.is(unwrap(state.users[0]), NED)).toBe(true);
    expect(Object.is(unwrap(state.users[1]), JOHN)).toBe(true);
    expect(Object.is(unwrap(state.users[2]), BRANDON)).toBe(true);
    setState(s => {
      s.users = reconcile([NED, BRANDON, JOHN], "id")(s.users);
    });
    expect(Object.is(unwrap(state.users[0]), NED)).toBe(true);
    expect(Object.is(unwrap(state.users[1]), BRANDON)).toBe(true);
    expect(Object.is(unwrap(state.users[2]), JOHN)).toBe(true);
    setState(s => {
      s.users = reconcile([NED, BRANDON, JOHN, ARYA], "id")(s.users);
    });
    expect(Object.is(unwrap(state.users[0]), NED)).toBe(true);
    expect(Object.is(unwrap(state.users[1]), BRANDON)).toBe(true);
    expect(Object.is(unwrap(state.users[2]), JOHN)).toBe(true);
    expect(Object.is(unwrap(state.users[3]), ARYA)).toBe(true);
    setState(s => {
      s.users = reconcile([BRANDON, JOHN, ARYA], "id")(s.users);
    });
    expect(Object.is(unwrap(state.users[0]), BRANDON)).toBe(true);
    expect(Object.is(unwrap(state.users[1]), JOHN)).toBe(true);
    expect(Object.is(unwrap(state.users[2]), ARYA)).toBe(true);
  });

  test("Reconcile overwrite in non-keyed merge mode", () => {
    const JOHN = { id: 1, firstName: "John", lastName: "Snow" },
      NED = { id: 2, firstName: "Ned", lastName: "Stark" },
      BRANDON = { id: 3, firstName: "Brandon", lastName: "Start" };
    const [state, setState] = createStore({
      users: [{ ...JOHN }, { ...NED }, { ...BRANDON }]
    });
    expect(state.users[0].id).toBe(1);
    expect(state.users[0].firstName).toBe("John");
    expect(state.users[1].id).toBe(2);
    expect(state.users[1].firstName).toBe("Ned");
    expect(state.users[2].id).toBe(3);
    expect(state.users[2].firstName).toBe("Brandon");
    setState(s => {
      s.users = reconcile([{ ...NED }, { ...JOHN }, { ...BRANDON }], "")(s.users);
    });
    expect(state.users[0].id).toBe(2);
    expect(state.users[0].firstName).toBe("Ned");
    expect(state.users[1].id).toBe(1);
    expect(state.users[1].firstName).toBe("John");
    expect(state.users[2].id).toBe(3);
    expect(state.users[2].firstName).toBe("Brandon");
  });

  test("Reconcile top level key mismatch", () => {
    const JOHN = { id: 1, firstName: "John", lastName: "Snow" },
      NED = { id: 2, firstName: "Ned", lastName: "Stark" };

    const [user, setUser] = createStore(JOHN);
    expect(user.id).toBe(1);
    expect(user.firstName).toBe("John");
    expect(() => setUser(reconcile(NED, "id"))).toThrow();
    // expect(user.id).toBe(2);
    // expect(user.firstName).toBe("Ned");
  });

  test("Reconcile nested top level key mismatch", () => {
    const JOHN = { id: 1, firstName: "John", lastName: "Snow" },
      NED = { id: 2, firstName: "Ned", lastName: "Stark" };

    const [user, setUser] = createStore({ user: JOHN });
    expect(user.user.id).toBe(1);
    expect(user.user.firstName).toBe("John");
    expect(() =>
      setUser(s => {
        s.user = reconcile(NED, "id")(s.user);
      })
    ).toThrow();
    // expect(user.user.id).toBe(2);
    // expect(user.user.firstName).toBe("Ned");
  });

  test("Reconcile top level key missing", () => {
    const [store, setStore] = createStore<{ id?: number; value?: string }>({
      id: 0,
      value: "value"
    });
    expect(() => setStore(reconcile({}, "id"))).toThrow();
    // expect(store.id).toBe(undefined);
    // expect(store.value).toBe(undefined);
  });

  test("Reconcile overwrite an object with an array", () => {
    const [store, setStore] = createStore<{ value: {} | [] }>({
      value: { a: { b: 1 } }
    });

    setStore(reconcile({ value: { c: [1, 2, 3] } }, "id"));
    expect(store.value).toEqual({ c: [1, 2, 3] });
  });

  test("Reconcile overwrite an array with an object", () => {
    const [store, setStore] = createStore<{ value: {} | [] }>({
      value: [1, 2, 3]
    });
    setStore(reconcile({ value: { name: "John" } }, "id"));
    expect(Array.isArray(store.value)).toBeFalsy();
    expect(store.value).toEqual({ name: "John" });
    setStore(reconcile({ value: [1, 2, 3] }, "id"));
    expect(store.value).toEqual([1, 2, 3]);
    setStore(reconcile({ value: { q: "aa" } }, "id"));
    expect(store.value).toEqual({ q: "aa" });
  });
});
// type tests

// reconcile
() => {
  const [state, setState] = createStore<{ data: number; missing: string; partial?: { v: number } }>(
    {
      data: 2,
      missing: "soon"
    }
  );
  // @ts-expect-error should not be able to reconcile partial type
  setState(reconcile({ data: 5 }));
};
