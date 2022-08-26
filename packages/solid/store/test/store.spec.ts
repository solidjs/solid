import {
  createRoot,
  createSignal,
  createEffect,
  createMemo,
  batch,
  on,
  untrack,
  mapArray
} from "../../src";
import { createStore, unwrap, $RAW, NotWrappable } from "../src";

describe("State immutablity", () => {
  test("Setting a property", () => {
    const [state] = createStore({ name: "John" });
    expect(state.name).toBe("John");
    state.name = "Jake";
    expect(state.name).toBe("John");
  });

  test("Deleting a property", () => {
    const [state] = createStore({ name: "John" });
    expect(state.name).toBe("John");
    // @ts-expect-error can't delete required property
    delete state.name;
    expect(state.name).toBe("John");
  });

  test("Immutable state is not mutable even inside setter", () => {
    const [state, setState] = createStore({ name: "John" });
    expect(state.name).toBe("John");
    setState(() => {
      state.name = "Jake";
    });
    expect(state.name).toBe("John");
  });
});

describe("State Getters", () => {
  test("Testing an update from state", () => {
    let state: any, setState: Function;
    createRoot(() => {
      [state, setState] = createStore({
        name: "John",
        get greeting(): string {
          return `Hi, ${this.name}`;
        }
      });
    });
    expect(state!.greeting).toBe("Hi, John");
    setState!({ name: "Jake" });
    expect(state!.greeting).toBe("Hi, Jake");
  });

  test("Testing an update from state", () => {
    let state: any, setState: Function;
    createRoot(() => {
      let greeting: () => string;
      [state, setState] = createStore({
        name: "John",
        get greeting(): string {
          return greeting();
        }
      });
      greeting = createMemo(() => `Hi, ${state.name}`);
    });
    expect(state!.greeting).toBe("Hi, John");
    setState!({ name: "Jake" });
    expect(state!.greeting).toBe("Hi, Jake");
  });
});

describe("Simple setState modes", () => {
  test("Simple Key Value", () => {
    const [state, setState] = createStore({ key: "" });
    setState("key", "value");
    expect(state.key).toBe("value");
  });

  test("Top level merge", () => {
    const [state, setState] = createStore({ starting: 1, ending: 1 });
    setState({ ending: 2 });
    expect(state.starting).toBe(1);
    expect(state.ending).toBe(2);
  });

  test("Top level merge no arguments", () => {
    const [state, setState] = createStore({ starting: 1 });
    setState({});
    expect(state.starting).toBe(1);
  });

  test("Top level state function merge", () => {
    const [state, setState] = createStore({ starting: 1, ending: 1 });
    setState((s, t) => {
      expect(t).toStrictEqual([]);
      return { ending: s.starting + 1 };
    });
    expect(state.starting).toBe(1);
    expect(state.ending).toBe(2);
  });

  test("Nested merge", () => {
    const [state, setState] = createStore({ data: { starting: 1, ending: 1 } });
    setState("data", { ending: 2 });
    expect(state.data.starting).toBe(1);
    expect(state.data.ending).toBe(2);
  });

  test("Nested state function merge", () => {
    const [state, setState] = createStore({ data: { starting: 1, ending: 1 } });
    setState("data", (d, t) => {
      expect(t).toStrictEqual(["data"]);
      return { ending: d.starting + 1 };
    });
    expect(state.data.starting).toBe(1);
    expect(state.data.ending).toBe(2);
  });

  test("Test Array", () => {
    const [todos, setTodos] = createStore([
      { id: 1, title: "Go To Work", done: true },
      { id: 2, title: "Eat Lunch", done: false }
    ]);
    setTodos(1, { done: true });
    setTodos([...todos, { id: 3, title: "Go Home", done: false }]);
    setTodos(t => [...t.slice(1)]);
    expect(Array.isArray(todos)).toBe(true);
    expect(todos[0].done).toBe(true);
    expect(todos[1].title).toBe("Go Home");
  });

  test("Test Array Nested", () => {
    const [state, setState] = createStore({
      todos: [
        { id: 1, title: "Go To Work", done: true },
        { id: 2, title: "Eat Lunch", done: false }
      ]
    });
    setState("todos", 1, { done: true });
    setState("todos", [...state.todos, { id: 3, title: "Go Home", done: false }]);
    expect(Array.isArray(state.todos)).toBe(true);
    expect(state.todos[1].done).toBe(true);
    expect(state.todos[2].title).toBe("Go Home");
  });
});

describe("Array setState modes", () => {
  test("Update Specific", () => {
    const [state, setState] = createStore([1, 2, 3, 4, 5]);
    setState([1, 3], (r, t) => {
      expect(typeof t[0]).toBe("number");
      return r * 2;
    });
    expect(state[0]).toBe(1);
    expect(state[1]).toBe(4);
    expect(state[2]).toBe(3);
    expect(state[3]).toBe(8);
    expect(state[4]).toBe(5);
    expect(Object.keys(state)).toStrictEqual(["0", "1", "2", "3", "4"]);
  });
  test("Update Specific Object", () => {
    const [state, setState] = createStore([1, 2, 3, 4, 5]);
    setState({
      1: 4,
      3: 8
    });
    expect(state[0]).toBe(1);
    expect(state[1]).toBe(4);
    expect(state[2]).toBe(3);
    expect(state[3]).toBe(8);
    expect(state[4]).toBe(5);
    expect(Object.keys(state)).toStrictEqual(["0", "1", "2", "3", "4"]);
  });
  test("Update filterFn", () => {
    const [state, setState] = createStore([1, 2, 3, 4, 5]);
    setState(
      (r, i) => Boolean(i % 2),
      (r, t) => {
        expect(typeof t[0]).toBe("number");
        return r * 2;
      }
    );
    expect(state[0]).toBe(1);
    expect(state[1]).toBe(4);
    expect(state[2]).toBe(3);
    expect(state[3]).toBe(8);
    expect(state[4]).toBe(5);
  });
  test("Update traversal range", () => {
    const [state, setState] = createStore([1, 2, 3, 4, 5]);
    setState({ from: 1, to: 4, by: 2 }, (r, t) => {
      expect(typeof t[0]).toBe("number");
      return r * 2;
    });
    expect(state[0]).toBe(1);
    expect(state[1]).toBe(4);
    expect(state[2]).toBe(3);
    expect(state[3]).toBe(8);
    expect(state[4]).toBe(5);
  });
  test("Update traversal range defaults", () => {
    const [state, setState] = createStore([1, 2, 3, 4, 5]);
    setState({}, (r, t) => {
      expect(typeof t[0]).toBe("number");
      return r * 2;
    });
    expect(state[0]).toBe(2);
    expect(state[1]).toBe(4);
    expect(state[2]).toBe(6);
    expect(state[3]).toBe(8);
    expect(state[4]).toBe(10);
  });
});

describe("Unwrapping Edge Cases", () => {
  test("Unwrap nested frozen state object", () => {
    const [state] = createStore({
        data: Object.freeze({ user: { firstName: "John", lastName: "Snow" } })
      }),
      s = unwrap({ ...state });
    expect(s.data.user.firstName).toBe("John");
    expect(s.data.user.lastName).toBe("Snow");
    // @ts-ignore check if proxy still
    expect(s.data.user[$RAW]).toBeUndefined();
  });
  test("Unwrap nested frozen array", () => {
    const [state] = createStore({
        data: [{ user: { firstName: "John", lastName: "Snow" } }]
      }),
      s = unwrap({ data: state.data.slice(0) });
    expect(s.data[0].user.firstName).toBe("John");
    expect(s.data[0].user.lastName).toBe("Snow");
    // @ts-ignore check if proxy still
    expect(s.data[0].user[$RAW]).toBeUndefined();
  });
  test("Unwrap nested frozen state array", () => {
    const [state] = createStore({
        data: Object.freeze([{ user: { firstName: "John", lastName: "Snow" } }])
      }),
      s = unwrap({ ...state });
    expect(s.data[0].user.firstName).toBe("John");
    expect(s.data[0].user.lastName).toBe("Snow");
    // @ts-ignore check if proxy still
    expect(s.data[0].user[$RAW]).toBeUndefined();
  });
});

describe("Tracking State changes", () => {
  test("Track a state change", () => {
    const [state, setState] = createStore({ data: 2 });
    createRoot(() => {
      let executionCount = 0;

      expect.assertions(2);
      createEffect(() => {
        if (executionCount === 0) expect(state.data).toBe(2);
        else if (executionCount === 1) {
          expect(state.data).toBe(5);
        } else {
          // should never get here
          expect(executionCount).toBe(-1);
        }
        executionCount++;
      });
    });
    setState({ data: 5 });
    // same value again should not retrigger
    setState({ data: 5 });
  });

  test("Track a nested state change", () => {
    const [state, setState] = createStore({
      user: { firstName: "John", lastName: "Smith" }
    });
    createRoot(() => {
      let executionCount = 0;

      expect.assertions(2);
      createEffect(() => {
        if (executionCount === 0) {
          expect(state.user.firstName).toBe("John");
        } else if (executionCount === 1) {
          expect(state.user.firstName).toBe("Jake");
        } else {
          // should never get here
          expect(executionCount).toBe(-1);
        }
        executionCount++;
      });
    });
    setState("user", "firstName", "Jake");
  });

  test("Tracking Top-Level Array iteration", () => {
    const [state, setState] = createStore(["hi"]);
    let executionCount = 0;
    let executionCount2 = 0;
    let executionCount3 = 0;
    createRoot(() => {
      createEffect(() => {
        for (let i = 0; i < state.length; i++) state[i];
        untrack(() => {
          if (executionCount === 0) expect(state.length).toBe(1);
          else if (executionCount === 1) {
            expect(state.length).toBe(2);
            expect(state[1]).toBe("item");
          } else if (executionCount === 2) {
            expect(state.length).toBe(2);
            expect(state[1]).toBe("new");
          } else if (executionCount === 3) {
            expect(state.length).toBe(1);
          } else {
            // should never get here
            expect(executionCount).toBe(-1);
          }
        });
        executionCount++;
      });

      createEffect(() => {
        for (const item of state);
        untrack(() => {
          if (executionCount2 === 0) expect(state.length).toBe(1);
          else if (executionCount2 === 1) {
            expect(state.length).toBe(2);
            expect(state[1]).toBe("item");
          } else if (executionCount2 === 2) {
            expect(state.length).toBe(2);
            expect(state[1]).toBe("new");
          } else if (executionCount2 === 3) {
            expect(state.length).toBe(1);
          } else {
            // should never get here
            expect(executionCount2).toBe(-1);
          }
        });
        executionCount2++;
      });

      const mapped = mapArray(
        () => state,
        item => item
      );
      createEffect(() => {
        mapped();
        untrack(() => {
          if (executionCount3 === 0) expect(state.length).toBe(1);
          else if (executionCount3 === 1) {
            expect(state.length).toBe(2);
            expect(state[1]).toBe("item");
          } else if (executionCount3 === 2) {
            expect(state.length).toBe(2);
            expect(state[1]).toBe("new");
          } else if (executionCount3 === 3) {
            expect(state.length).toBe(1);
          } else {
            // should never get here
            expect(executionCount3).toBe(-1);
          }
        });
        executionCount3++;
      });
    });
    // add
    setState(1, "item");

    // update
    setState(1, "new");

    // delete
    setState(s => [s[0]]);
    expect.assertions(18);
  });

  test("Tracking iteration Object key addition/removal", () => {
    const [state, setState] = createStore<{ obj: { item?: number } }>({ obj: {} });
    let executionCount = 0;
    let executionCount2 = 0;
    createRoot(() => {
      createEffect(() => {
        const keys = Object.keys(state.obj);
        if (executionCount === 0) expect(keys.length).toBe(0);
        else if (executionCount === 1) {
          expect(keys.length).toBe(1);
          expect(keys[0]).toBe("item");
        } else if (executionCount === 2) {
          expect(keys.length).toBe(0);
        } else {
          // should never get here
          expect(executionCount).toBe(-1);
        }
        executionCount++;
      });

      createEffect(() => {
        for (const key in state.obj) {
          key;
        }
        const u = unwrap(state.obj);
        if (executionCount2 === 0) expect(u.item).toBeUndefined();
        else if (executionCount2 === 1) {
          expect(u.item).toBe(5);
        } else if (executionCount2 === 2) {
          expect(u.item).toBeUndefined();
        } else {
          // should never get here
          expect(executionCount2).toBe(-1);
        }
        executionCount2++;
      });
    });
    // add
    setState("obj", "item", 5);

    // update
    // setState("obj", "item", 10);

    // delete
    setState("obj", "item", undefined);
    expect.assertions(7);
  });

  test("Doesn't trigger object on addition/removal", () => {
    const [state, setState] = createStore<{ obj: { item?: number } }>({ obj: {} });
    let executionCount = 0;
    createRoot(() => {
      createEffect(
        on(
          () => state.obj,
          v => {
            if (executionCount === 0) expect(v.item).toBeUndefined();
            else if (executionCount === 1) {
              expect(v.item).toBe(5);
            } else {
              // should never get here
              expect(executionCount).toBe(-1);
            }
            executionCount++;
          }
        )
      );
    });
    // add
    setState("obj", "item", 5);

    // delete
    setState("obj", "item", undefined);
    expect.assertions(1);
  });

  test("Tracking Top level iteration Object key addition/removal", () => {
    const [state, setState] = createStore<{ item?: number }>({});
    let executionCount = 0;
    let executionCount2 = 0;
    createRoot(() => {
      createEffect(() => {
        const keys = Object.keys(state);
        if (executionCount === 0) expect(keys.length).toBe(0);
        else if (executionCount === 1) {
          expect(keys.length).toBe(1);
          expect(keys[0]).toBe("item");
        } else if (executionCount === 2) {
          expect(keys.length).toBe(0);
        } else {
          // should never get here
          expect(executionCount).toBe(-1);
        }
        executionCount++;
      });

      createEffect(() => {
        for (const key in state) {
          key;
        }
        const u = unwrap(state);
        if (executionCount2 === 0) expect(u.item).toBeUndefined();
        else if (executionCount2 === 1) {
          expect(u.item).toBe(5);
        } else if (executionCount2 === 2) {
          expect(u.item).toBeUndefined();
        } else {
          // should never get here
          expect(executionCount2).toBe(-1);
        }
        executionCount2++;
      });
    });
    // add
    setState("item", 5);

    // delete
    setState("item", undefined);
    expect.assertions(7);
  });

  test("Not Tracking Top level key addition/removal", () => {
    const [state, setState] = createStore<{ item?: number; item2?: number }>({});
    let executionCount = 0;
    createRoot(() => {
      createEffect(() => {
        if (executionCount === 0) expect(state.item2).toBeUndefined();
        else {
          // should never get here
          expect(executionCount).toBe(-1);
        }
        executionCount++;
      });
    });
    // add
    setState("item", 5);

    // delete
    setState("item", undefined);
    expect.assertions(1);
  });
});

describe("Handling functions in state", () => {
  test("Array Native Methods: Array.Filter", () => {
    createRoot(() => {
      const [state] = createStore({ list: [0, 1, 2] }),
        getFiltered = createMemo(() => state.list.filter(i => i % 2));
      expect(getFiltered()).toStrictEqual([1]);
    });
  });

  test("Track function change", () => {
    createRoot(() => {
      const [state, setState] = createStore<{ fn: () => number }>({
          fn: () => 1
        }),
        getValue = createMemo(() => state.fn());
      setState({ fn: () => 2 });
      expect(getValue()).toBe(2);
    });
  });
});

describe("Setting state from Effects", () => {
  test("Setting state from signal", () => {
    const [getData, setData] = createSignal("init"),
      [state, setState] = createStore({ data: "" });
    createRoot(() => {
      createEffect(() => setState("data", getData()));
    });
    setData("signal");
    expect(state.data).toBe("signal");
  });

  test("Select Promise", done => {
    createRoot(async () => {
      const p = new Promise<string>(resolve => {
        setTimeout(resolve, 20, "promised");
      });
      const [state, setState] = createStore({ data: "" });
      p.then(v => setState("data", v));
      await p;
      expect(state.data).toBe("promised");
      done();
    });
  });
});

describe("Batching", () => {
  test("Respects batch", () => {
    let data = 1;
    const [state, setState] = createStore({ data: 1 });
    const memo = createRoot(() => createMemo(() => (data = state.data)));

    batch(() => {
      expect(state.data).toBe(1);
      expect(memo()).toBe(1);
      expect(data).toBe(1);
      setState("data", 2);
      expect(state.data).toBe(2);
      expect(data).toBe(1);
      expect(memo()).toBe(2);
      expect(data).toBe(2);
    });
    expect(state.data).toBe(2);
    expect(memo!()).toBe(2);
    expect(data).toBe(2);
  });
  test("Respects batch in array", () => {
    let data = 1;
    const [state, setState] = createStore([1]);
    const memo = createRoot(() => createMemo(() => (data = state[0])));
    batch(() => {
      expect(state[0]).toBe(1);
      expect(memo()).toBe(1);
      expect(data).toBe(1);
      setState(0, 2);
      expect(state[0]).toBe(2);
      expect(data).toBe(1);
      expect(memo()).toBe(2);
      expect(data).toBe(2);
    });
    expect(state[0]).toBe(2);
    expect(memo()).toBe(2);
    expect(data).toBe(2);
  });
  test("Respects batch in array mutate", () => {
    let data = 1;
    const [state, setState] = createStore([1]);
    const memo = createRoot(() => createMemo(() => (data = state.length)));
    batch(() => {
      expect(state.length).toBe(1);
      expect(memo()).toBe(1);
      expect(data).toBe(1);
      setState([...state, 2]);
      expect(state.length).toBe(2);
      expect(data).toBe(1);
      expect(memo()).toBe(2);
      expect(data).toBe(2);
    });
    expect(state.length).toBe(2);
    expect(memo()).toBe(2);
    expect(data).toBe(2);
  });
});

describe("State wrapping", () => {
  test("Setting plain object", () => {
    const data = { withProperty: "y" },
      [state] = createStore({ data });
    // not wrapped
    expect(state.data).not.toBe(data);
  });
  test("Setting plain array", () => {
    const data = [1, 2, 3],
      [state] = createStore({ data });
    // not wrapped
    expect(state.data).not.toBe(data);
  });
  test("Setting non-wrappable", () => {
    const date = new Date(),
      [state] = createStore({ time: date });
    // not wrapped
    expect(state.time).toBe(date);
  });
});

describe("Array length", () => {
  test("Setting plain object", () => {
    const [state, setState] = createStore<{ list: number[] }>({ list: [] });
    let length;
    // isolate length tracking
    const list = state.list;
    createRoot(() => {
      createEffect(() => {
        length = list.length;
      });
    });
    expect(length).toBe(0);
    // insert at index 0
    setState("list", 0, 1);
    expect(length).toBe(1);
  });
});

describe("State recursion", () => {
  test("there is no infinite loop", () => {
    const x: { a: number; b: any } = { a: 1, b: undefined };
    x.b = x;

    const [state, setState] = createStore(x);
    expect(state.a).toBe(state.b.a);
  });
});

describe("Nested Classes", () => {
  test("wrapped nested class", () => {
    class CustomThing {
      a: number;
      b: number;
      constructor(value: number) {
        this.a = value;
        this.b = 10;
      }
    }

    const [inner] = createStore(new CustomThing(1));
    const [store, setStore] = createStore({ inner });

    expect(store.inner.a).toBe(1);
    expect(store.inner.b).toBe(10);

    let sum;
    createRoot(() => {
      createEffect(() => {
        sum = store.inner.a + store.inner.b;
      });
    });
    expect(sum).toBe(11);
    setStore("inner", "a", 10);
    expect(sum).toBe(20);
    setStore("inner", "b", 5);
    expect(sum).toBe(15);
  });

  test("not wrapped nested class", () => {
    class CustomThing {
      a: number;
      b: number;
      constructor(value: number) {
        this.a = value;
        this.b = 10;
      }
    }
    const [store, setStore] = createStore({ inner: new CustomThing(1) });

    expect(store.inner.a).toBe(1);
    expect(store.inner.b).toBe(10);

    let sum;
    createRoot(() => {
      createEffect(() => {
        sum = store.inner.a + store.inner.b;
      });
    });
    expect(sum).toBe(11);
    setStore("inner", "a", 10);
    expect(sum).toBe(11);
    setStore("inner", "b", 5);
    expect(sum).toBe(11);
  });
});

// type tests

// NotWrappable keys are ignored
() => {
  const [, setStore] = createStore<{
    a?:
      | undefined
      | {
          b: null | { c: number | { d: bigint | { e: Function | { f: symbol | { g: string } } } } };
        };
  }>({});
  setStore("a", "b", "c", "d", "e", "f", "g", "h");
};

// keys are narrowed
() => {
  const [store, setStore] = createStore({ a: { b: 1 }, c: { d: 2 } });
  setStore("a", "b", 3);
  setStore("c", "d", 4);
  // @ts-expect-error a.d is not valid
  setStore("a", "d", 5);
  // @ts-expect-error a.d is not valid
  store.a.d;
  // @ts-expect-error c.b is not valid
  setStore("c", "b", 6);
  // @ts-expect-error c.b is not valid
  store.c.b;
};

// array key types are inferred
() => {
  const [, setStore] = createStore({ list: [1, 2, 3] });
  setStore(
    "list",
    (v, i) => i === 0,
    (v, t) => v * 2
  );
  setStore("list", { from: 1, to: 2 }, 4);
  setStore("list", [2, 3], 4);
};

// fallback overload correctly infers keys and setter
() => {
  const [, setStore] = createStore({
    a: { b: { c: { d: { e: { f: { g: { h: { i: { j: { k: 1 } } } } } } } } } }
  });
  setStore("a", "b", "c", "d", "e", "f", "g", "h", "i", "j", (v, t) => ({
    k: 2
  }));
};

// tuples are correctly typed
() => {
  const [, setStore] = createStore({ data: ["a", 1] as [string, number] });
  setStore("data", 0, "hello");
  setStore("data", 1, 2);
  // @ts-expect-error number not assignable to string
  setStore("data", 0, 3);
  // @ts-expect-error string not assignable to number
  setStore("data", 1, "world");
};

// // cannot mutate a store directly
// () => {
//   const [store, setStore] = createStore({ a: 1, nested: { a: 1 } });
//   // @ts-expect-error cannot set
//   store.a = 1;
//   // @ts-expect-error cannot set
//   store.nested.a = 1;
//   // @ts-expect-error cannot delete
//   delete store.a;
//   // @ts-expect-error cannot delete
//   delete store.nested.a;
//   // @ts-expect-error cannot set in setter
//   setStore(s => (s.a = 1));
//   // @ts-expect-error cannot set in setter
//   setStore(s => (s.nested.a = 1));
// };

// cannot mutate unnested classes
() => {
  const [store, setStore] = createStore({ inner: new Uint8Array() });
  // TODO @ts-expect-error
  setStore("inner", 0, 2);
  const [inner] = createStore(new Uint8Array());
  const [, setNested] = createStore({ inner });
  setNested("inner", 0, 2);
};

// createStore initial value
() => {
  createStore();
  createStore<{ a?: { b: 1 } }>();
  createStore(() => 1);
  // @ts-expect-error cannot create store from null
  createStore(null);
  // @ts-expect-error cannot create store from number
  createStore(1);
  // @ts-expect-error cannot create store from string
  createStore("a");
  // @ts-expect-error cannot create store from symbol
  createStore(Symbol());
  // @ts-expect-error cannot create store from bigint
  createStore(BigInt(0));
  // @ts-expect-error must provide initial value if {} cannot be assigned to it
  createStore<{ a: 1 }>();
};

// recursive
() => {
  type Recursive = { a: Recursive };
  const [store, setStore] = createStore({} as Recursive);
  setStore("a", "a", "a", "a", {});
  // @ts-expect-error TODO should work with recursive types even at rest depth
  setStore("a", "a", "a", "a", "a", "a", "a", "a", "a", "a", {});
  store.a.a.a.a.a.a.a.a.a;
};

// TODO Wrappable instead of NotWrappable
() => {
  type User = {
    name: string;
    data: number[];
  };
  let user: User = { name: "Jake", data: [1, 2, 3] };
  // @ts-expect-error plain objects are wrappable
  let a: NotWrappable = user;
  let b: NotWrappable = 1;
  let c: NotWrappable = "string";
  let d: NotWrappable = BigInt(0);
  let e: NotWrappable = Symbol();
  let f: NotWrappable = undefined;
  let g: NotWrappable = null;
  let h: NotWrappable = () => 1;
  // @ts-expect-error TODO classes are not wrappable
  let i: NotWrappable = new Uint8Array();
};

// interactions with `any`
() => {
  const [, setStore] = createStore<{ a: any; b?: { c: string } }>({ a: {} });
  // allows anything when accessing `any`
  setStore("a", "b", "c", "d", "e", "f", "g", "h", "i");
  setStore("a", 1, "c", Symbol(), 2, 1, 2, 3, 4, 5, 6, 1, 2, 3, "a", Symbol());
  // still infers correctly on other paths
  setStore("b", "c", "d");
  // @ts-expect-error
  setStore("b", 2);
  setStore("b", "c", v => v);
};

// interactions with `unknown`
() => {
  const [, setStore] = createStore<{ a: unknown }>({ a: {} });
  // allows any setter
  setStore("a", "a");
  setStore("a", () => ({ a: { b: 1 } }));

  // @ts-expect-error doesn't allow string
  setStore("a", "b", 1);
  // @ts-expect-error doesn't allow number
  setStore("a", 1, 1);
  // @ts-expect-error doesn't allow symbol
  setStore("a", Symbol(), 1);
};

// interactions with generics
<T extends string>(v: T) => {
  type A = { a: T; b: Record<string, string>; c: Record<T, string> };
  const a = {} as A;
  const [store, setStore] = createStore<A>(a);
  // should allow
  setStore("a", v);
  setStore("b", "a", "c");
  setStore("b", v, "c");
  // @ts-expect-error TODO generic should index Record
  setStore("c", v, "c");
  const b = store.c[v];
  const c: typeof b = "1";
  const d = a.c[v];
  const e: typeof d = "1";
};

// traversed contains the correct types of keys
() => {
  const [, setStore] = createStore({ a: [{ b: 1 }] });
  setStore((v, t) => {
    const expectedT: [] = t;
    t = [] as [];
    return v;
  });
  setStore("a", (v, t) => {
    const expectedT: ["a"] = t;
    t = ["a"];
    return v;
  });
  setStore("a", 0, (v, t) => {
    const expectedT: [0, "a"] = t;
    t = [0, "a"];
    return v;
  });
  // array of keys
  setStore(["a"], [0], (v, t) => {
    const expectedT: [0, "a"] = t;
    t = [0, "a"];
    return v;
  });
  // callback
  setStore(
    ["a"],
    () => true,
    (v, t) => {
      const expectedT: [number, "a"] = t;
      t = [0, "a"];
      return v;
    }
  );
  // { from, to, by }
  setStore(["a"], {}, (v, t) => {
    const expectedT: [number, "a"] = t;
    t = [0, "a"];
    return v;
  });
};

// types with a string index signature are not wrongly assumed to be arrays in setStore
() => {
  const [store, setStore] = createStore<{ [x: string]: number }>({});
  // @ts-expect-error filter function not allowed for objects
  setStore(() => true, 1);
  // @ts-expect-error from to by not allowed for objects
  setStore({ from: 0, to: 10, by: 3 }, 1);
};

// can set overly complex? types
() => {
  const [store, setStore] = createStore<{ el?: Element }>({});
  setStore("el", {} as Element);
};

// can set tuple indices
() => {
  const [store, setStore] = createStore({ list: [0] as [number, number?] });
  setStore("list", { 0: 1, 1: 2 });
  setStore("list", { 0: 1 });
  setStore("list", { 1: 2 });
  setStore("list", {});
  // @ts-expect-error tuple only contains two items
  setStore("list", { 2: 3 });
};

// can set array indices
() => {
  const [store, setStore] = createStore({ list: [0] as number[] });
  setStore("list", { 0: 1, 1: 2 });
  setStore("list", { 0: 1 });
  setStore("list", { 1: 2 });
  setStore("list", { 99: 100 });
};

// can set top-level tuple indices
() => {
  const [store, setStore] = createStore([0] as [number, number?]);
  setStore({ 0: 1, 1: 2 });
  setStore({ 0: 1 });
  setStore({ 1: 2 });
  setStore({});
  // @ts-expect-error tuple only contains two items
  setStore({ 2: 3 });
};

// can set top-level array indices
() => {
  const [store, setStore] = createStore([0] as number[]);
  setStore({ 0: 1, 1: 2 });
  setStore({ 0: 1 });
  setStore({ 1: 2 });
  setStore({ 99: 100 });
};
