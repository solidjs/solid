import { createRoot, createSignal, createEffect } from "../../src";
import { createStore, createMutable, reconcile, produce, unwrap, modifyMutable } from "../src";

describe("setState with reconcile", () => {
  test("Reconcile a simple object", () => {
    const [state, setState] = createStore<{ data: number; missing?: string }>({
      data: 2,
      missing: "soon"
    });
    expect(state.data).toBe(2);
    expect(state.missing).toBe("soon");
    setState(reconcile({ data: 5 }));
    expect(state.data).toBe(5);
    expect(state.missing).toBeUndefined();
  });

  test("Reconcile array with nulls", () => {
    const [state, setState] = createStore([null, "a"]);
    expect(state[0]).toBe(null);
    expect(state[1]).toBe("a");
    setState(reconcile(["b", null]));
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
    setState("data", "user", reconcile({ firstName: "Jake", middleName: "R" }));
    expect(state.data.user.firstName).toBe("Jake");
    expect(state.data.user.middleName).toBe("R");
    expect(state.data.user.lastName).toBeUndefined();
  });

  test("Reconcile a simple object on a nested path with no prev state", () => {
    const [state, setState] = createStore<{ user?: { firstName: string; middleName: string } }>({});
    expect(state.user).toBeUndefined();
    setState("user", reconcile({ firstName: "Jake", middleName: "R" }));
    expect(state.user!.firstName).toBe("Jake");
    expect(state.user!.middleName).toBe("R");
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
    setState("users", reconcile([NED, JOHN, BRANDON]));
    expect(Object.is(unwrap(state.users[0]), NED)).toBe(true);
    expect(Object.is(unwrap(state.users[1]), JOHN)).toBe(true);
    expect(Object.is(unwrap(state.users[2]), BRANDON)).toBe(true);
    setState("users", reconcile([NED, BRANDON, JOHN]));
    expect(Object.is(unwrap(state.users[0]), NED)).toBe(true);
    expect(Object.is(unwrap(state.users[1]), BRANDON)).toBe(true);
    expect(Object.is(unwrap(state.users[2]), JOHN)).toBe(true);
    setState("users", reconcile([NED, BRANDON, JOHN, ARYA]));
    expect(Object.is(unwrap(state.users[0]), NED)).toBe(true);
    expect(Object.is(unwrap(state.users[1]), BRANDON)).toBe(true);
    expect(Object.is(unwrap(state.users[2]), JOHN)).toBe(true);
    expect(Object.is(unwrap(state.users[3]), ARYA)).toBe(true);
    setState("users", reconcile([BRANDON, JOHN, ARYA]));
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
    setState(
      "users",
      reconcile([{ ...NED }, { ...JOHN }, { ...BRANDON }], {
        merge: true,
        key: null
      })
    );
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
    setUser(reconcile(NED));
    expect(user.id).toBe(2);
    expect(user.firstName).toBe("Ned");
  });

  test("Reconcile nested top level key mismatch", () => {
    const JOHN = { id: 1, firstName: "John", lastName: "Snow" },
      NED = { id: 2, firstName: "Ned", lastName: "Stark" };

    const [user, setUser] = createStore({ user: JOHN });
    expect(user.user.id).toBe(1);
    expect(user.user.firstName).toBe("John");
    setUser("user", reconcile(NED));
    expect(user.user.id).toBe(2);
    expect(user.user.firstName).toBe("Ned");
  });

  test("Reconcile top level key missing", () => {
    const [store, setStore] = createStore<{ id?: number; value?: string }>({
      id: 0,
      value: "value"
    });
    setStore(reconcile({}));
    expect(store.id).toBe(undefined);
    expect(store.value).toBe(undefined);
  });
});

describe("setState with produce", () => {
  interface DataState {
    data: { ending?: number; starting: number };
  }
  test("Top Level Mutation", () => {
    const [state, setState] = createStore<DataState>({ data: { starting: 1, ending: 1 } });
    setState(
      produce(s => {
        s.data.ending = s.data.starting + 1;
      })
    );
    expect(state.data.starting).toBe(1);
    expect(state.data.ending).toBe(2);
  });
  test("referential equality", () => {
    const [state, setState] = createStore<DataState>({ data: { starting: 1, ending: 1 } });
    setState(
      produce(s => {
        if (s.data === s.data) s.data.ending!++;
      })
    );
    expect(state.data.starting).toBe(1);
    expect(state.data.ending).toBe(2);
  });
  test("Top Level Mutation in computation", () => {
    createRoot(() => {
      const [s, set] = createSignal(1);
      const [state, setState] = createStore<{ data: number[] }>({ data: [] });
      createEffect(() => {
        setState(
          produce(state => {
            state.data.push(s());
          })
        );
      });
      createEffect(() => state.data.length);
    });
    expect(true).toBe(true);
  });
  test("Nested Level Mutation", () => {
    const [state, setState] = createStore({ data: { starting: 1, ending: 1 } });
    setState(
      "data",
      produce(s => {
        s.ending = s.starting + 1;
      })
    );
    expect(state.data.starting).toBe(1);
    expect(state.data.ending).toBe(2);
  });
  test("Top Level Deletion", () => {
    const [state, setState] = createStore<DataState>({ data: { starting: 1, ending: 1 } });
    setState(
      produce(s => {
        delete s.data.ending;
      })
    );
    expect(state.data.starting).toBe(1);
    expect(state.data.ending).not.toBeDefined();
  });
  test("Top Level Object Mutation", () => {
    const [state, setState] = createStore<DataState>({ data: { starting: 1, ending: 1 } }),
      next = { starting: 3, ending: 6 };
    setState(
      produce(s => {
        s.data = next;
      })
    );
    expect(unwrap(state.data)).toBe(next);
    expect(state.data.starting).toBe(3);
    expect(state.data.ending).toBe(6);
  });
  test("Test Array Mutation", () => {
    interface TodoState {
      todos: { id: number; title: string; done: boolean }[];
    }
    const [state, setState] = createStore<TodoState>({
      todos: [
        { id: 1, title: "Go To Work", done: true },
        { id: 2, title: "Eat Lunch", done: false }
      ]
    });
    setState(
      produce(s => {
        s.todos[1].done = true;
        s.todos.push({ id: 3, title: "Go Home", done: false });
      })
    );
    expect(Array.isArray(state.todos)).toBe(true);
    expect(state.todos[1].done).toBe(true);
    expect(state.todos[2].title).toBe("Go Home");
  });

  test("Test Top-Level Array Mutation", () => {
    type TodoState = Array<{
      id: number;
      title: string;
      done: boolean;
    }>;
    const [state, setState] = createStore<TodoState>([
      { id: 1, title: "Go To Work", done: true },
      { id: 2, title: "Eat Lunch", done: false }
    ]);
    setState(
      produce(s => {
        s[1].done = true;
        s.push({ id: 3, title: "Go Home", done: false });
      })
    );
    expect(Array.isArray(state)).toBe(true);
    expect(state[1].done).toBe(true);
    expect(state[2].title).toBe("Go Home");
  });
});

describe("modifyMutable with reconcile", () => {
  test("Reconcile a simple object", () => {
    const state = createMutable<{ data: number; missing?: string }>({
      data: 2,
      missing: "soon"
    });
    expect(state.data).toBe(2);
    expect(state.missing).toBe("soon");
    modifyMutable(state, reconcile({ data: 5 }));
    expect(state.data).toBe(5);
    expect(state.missing).toBeUndefined();
  });

  test("Reconcile a simple object on a nested path", () => {
    const state = createMutable<{
      data: { user: { firstName: string; middleName: string; lastName?: string } };
    }>({
      data: { user: { firstName: "John", middleName: "", lastName: "Snow" } }
    });
    expect(state.data.user.firstName).toBe("John");
    expect(state.data.user.lastName).toBe("Snow");
    modifyMutable(state.data.user, reconcile({ firstName: "Jake", middleName: "R" }));
    expect(state.data.user.firstName).toBe("Jake");
    expect(state.data.user.middleName).toBe("R");
    expect(state.data.user.lastName).toBeUndefined();
  });

  test("Reconcile reorder a keyed array", () => {
    const JOHN = { id: 1, firstName: "John", lastName: "Snow" },
      NED = { id: 2, firstName: "Ned", lastName: "Stark" },
      BRANDON = { id: 3, firstName: "Brandon", lastName: "Start" },
      ARYA = { id: 4, firstName: "Arya", lastName: "Start" };
    const state = createMutable({ users: [JOHN, NED, BRANDON] });
    expect(Object.is(unwrap(state.users[0]), JOHN)).toBe(true);
    expect(Object.is(unwrap(state.users[1]), NED)).toBe(true);
    expect(Object.is(unwrap(state.users[2]), BRANDON)).toBe(true);
    modifyMutable(state.users, reconcile([NED, JOHN, BRANDON]));
    expect(Object.is(unwrap(state.users[0]), NED)).toBe(true);
    expect(Object.is(unwrap(state.users[1]), JOHN)).toBe(true);
    expect(Object.is(unwrap(state.users[2]), BRANDON)).toBe(true);
    modifyMutable(state.users, reconcile([NED, BRANDON, JOHN]));
    expect(Object.is(unwrap(state.users[0]), NED)).toBe(true);
    expect(Object.is(unwrap(state.users[1]), BRANDON)).toBe(true);
    expect(Object.is(unwrap(state.users[2]), JOHN)).toBe(true);
    modifyMutable(state.users, reconcile([NED, BRANDON, JOHN, ARYA]));
    expect(Object.is(unwrap(state.users[0]), NED)).toBe(true);
    expect(Object.is(unwrap(state.users[1]), BRANDON)).toBe(true);
    expect(Object.is(unwrap(state.users[2]), JOHN)).toBe(true);
    expect(Object.is(unwrap(state.users[3]), ARYA)).toBe(true);
    modifyMutable(state.users, reconcile([BRANDON, JOHN, ARYA]));
    expect(Object.is(unwrap(state.users[0]), BRANDON)).toBe(true);
    expect(Object.is(unwrap(state.users[1]), JOHN)).toBe(true);
    expect(Object.is(unwrap(state.users[2]), ARYA)).toBe(true);
  });

  test("Reconcile overwrite in non-keyed merge mode", () => {
    const JOHN = { id: 1, firstName: "John", lastName: "Snow" },
      NED = { id: 2, firstName: "Ned", lastName: "Stark" },
      BRANDON = { id: 3, firstName: "Brandon", lastName: "Start" };
    const state = createMutable({
      users: [{ ...JOHN }, { ...NED }, { ...BRANDON }]
    });
    expect(state.users[0].id).toBe(1);
    expect(state.users[0].firstName).toBe("John");
    expect(state.users[1].id).toBe(2);
    expect(state.users[1].firstName).toBe("Ned");
    expect(state.users[2].id).toBe(3);
    expect(state.users[2].firstName).toBe("Brandon");
    modifyMutable(
      state.users,
      reconcile([{ ...NED }, { ...JOHN }, { ...BRANDON }], {
        merge: true,
        key: null
      })
    );
    expect(state.users[0].id).toBe(2);
    expect(state.users[0].firstName).toBe("Ned");
    expect(state.users[1].id).toBe(1);
    expect(state.users[1].firstName).toBe("John");
    expect(state.users[2].id).toBe(3);
    expect(state.users[2].firstName).toBe("Brandon");
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
  // should be able to reconcile unwrappable types
  setState("partial", reconcile(undefined));
};

// produce
() => {
  const [store, setStore] = createStore({ todos: [{ id: 1, text: "" }] });
  // should be able to strip readonly from arrays
  setStore(
    "todos",
    produce(todos => {
      todos.push({ id: todos[todos.length - 1].id + 1, text: "" });
    })
  );
};

// works regardless of depth
() => {
  const [store, setStore] = createStore({
    a: { b: { c: { d: { e: { f: { g: { h: { i: 1 } } } } } } } }
  });
  setStore(produce(v => v));
  setStore(reconcile({ ...store }));
  setStore(
    "a",
    "b",
    "c",
    "d",
    "e",
    "f",
    "g",
    "h",
    produce(v => ({ i: v.i }))
  );
  setStore("a", "b", "c", "d", "e", "f", "g", "h", reconcile({ i: 2 }));
};
