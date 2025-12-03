import {
  $TARGET,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  createStore,
  flush,
  mapArray,
  snapshot,
  untrack
} from "../../src/index.js";

describe("State immutability", () => {
  test("Setting a property", () => {
    const [state] = createStore({ name: "John" });
    expect(state.name).toBe("John");
    // @ts-expect-error can't write readonly property
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
});

describe("State Getters", () => {
  test("Testing an update from state", () => {
    const [state, setState] = createStore({
      name: "John",
      get greeting(): string {
        return `Hi, ${this.name}`;
      }
    });
    expect(state!.greeting).toBe("Hi, John");
    setState(s => {
      s.name = "Jake";
    });
    expect(state!.greeting).toBe("Hi, Jake");
  });

  test("Testing an update from state", () => {
    let greeting: () => string;
    const [state, setState] = createStore({
      name: "John",
      get greeting(): string {
        return greeting();
      }
    });
    createRoot(() => {
      greeting = createMemo(() => `Hi, ${state.name}`);
    });
    expect(state!.greeting).toBe("Hi, John");
    setState(s => {
      s.name = "Jake";
    });
    flush();
    expect(state!.greeting).toBe("Hi, Jake");
  });
});

describe("Simple setState modes", () => {
  test("Simple Key Value", () => {
    const [state, setState] = createStore({ key: "" });
    setState(s => {
      s.key = "value";
    });
    expect(state.key).toBe("value");
  });

  test("Test Array", () => {
    const [todos, setTodos] = createStore([
      { id: 1, title: "Go To Work", done: true },
      { id: 2, title: "Eat Lunch", done: false }
    ]);
    setTodos(t => {
      t[1].done = true;
    });
    setTodos(t => {
      t.push({ id: 3, title: "Go Home", done: false });
    });
    setTodos(t => {
      t.shift();
    });
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
    setState(s => {
      s.todos[1].done = true;
    });
    setState(s => {
      s.todos.push({ id: 3, title: "Go Home", done: false });
    });
    expect(Array.isArray(state.todos)).toBe(true);
    expect(state.todos[1].done).toBe(true);
    expect(state.todos[2].title).toBe("Go Home");
  });
});

describe("Unwrapping Edge Cases", () => {
  test("Unwrap nested frozen state object", () => {
    const [state] = createStore({
        data: Object.freeze({ user: { firstName: "John", lastName: "Snow" } })
      }),
      s = snapshot(state);
    expect(s.data.user.firstName).toBe("John");
    expect(s.data.user.lastName).toBe("Snow");
    // @ts-ignore check if proxy still
    expect(s.data.user[$TARGET]).toBeUndefined();
  });
  test("Unwrap nested frozen array", () => {
    const [state] = createStore({
        data: [{ user: { firstName: "John", lastName: "Snow" } }]
      }),
      s = snapshot({ data: state.data });
    expect(s.data[0].user.firstName).toBe("John");
    expect(s.data[0].user.lastName).toBe("Snow");
    // @ts-ignore check if proxy still
    expect(s.data[0].user[$TARGET]).toBeUndefined();
  });
  test("Unwrap nested frozen state array", () => {
    const [state] = createStore({
        data: Object.freeze([{ user: { firstName: "John", lastName: "Snow" } }])
      }),
      s = snapshot(state);
    expect(s.data[0].user.firstName).toBe("John");
    expect(s.data[0].user.lastName).toBe("Snow");
    // @ts-ignore check if proxy still
    expect(s.data[0].user[$TARGET]).toBeUndefined();
  });
});

describe("Tracking State changes", () => {
  test("Track a state change", () => {
    const [state, setState] = createStore({ data: 2 });
    createRoot(() => {
      let executionCount = 0;

      expect.assertions(2);
      createEffect(
        () => {
          if (executionCount === 0) expect(state.data).toBe(2);
          else if (executionCount === 1) {
            expect(state.data).toBe(5);
          } else {
            // should never get here
            expect(executionCount).toBe(-1);
          }
        },
        () => {
          executionCount++;
        }
      );
    });
    flush();
    setState(s => {
      s.data = 5;
    });
    flush();
    // same value again should not retrigger
    setState(s => {
      s.data = 5;
    });
    flush();
  });

  test("Track a nested state change", () => {
    const [state, setState] = createStore({
      user: { firstName: "John", lastName: "Smith" }
    });
    createRoot(() => {
      let executionCount = 0;

      expect.assertions(2);
      createEffect(
        () => {
          if (executionCount === 0) {
            expect(state.user.firstName).toBe("John");
          } else if (executionCount === 1) {
            expect(state.user.firstName).toBe("Jake");
          } else {
            // should never get here
            expect(executionCount).toBe(-1);
          }
        },
        () => {
          executionCount++;
        }
      );
    });
    flush();
    setState(s => {
      s.user.firstName = "Jake";
    });
    flush();
  });

  test("Track array item on removal", () => {
    const [state, setState] = createStore([1]);
    createRoot(() => {
      let executionCount = 0;

      expect.assertions(2);
      createEffect(
        () => {
          if (executionCount === 0) {
            expect(state[0]).toBe(1);
          } else if (executionCount === 1) {
            expect(state[0]).toBe(undefined);
          } else {
            // should never get here
            expect(executionCount).toBe(-1);
          }
        },
        () => {
          executionCount++;
        }
      );
    });
    flush();
    setState(s => {
      s.pop();
    });
    flush();
  });

  test("Tracking Top-Level Array iteration", () => {
    const [state, setState] = createStore<String[]>(["hi"]);
    let executionCount = 0;
    let executionCount2 = 0;
    let executionCount3 = 0;
    createRoot(() => {
      createEffect(
        () => {
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
        },
        () => {
          executionCount++;
        }
      );

      createEffect(
        () => {
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
        },
        () => {
          executionCount2++;
        }
      );

      const mapped = mapArray(
        () => state,
        item => item
      );
      createEffect(
        () => {
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
        },
        () => {
          executionCount3++;
        }
      );
    });
    flush();
    // add
    setState(s => {
      s[1] = "item";
    });
    flush();

    // update
    setState(s => {
      s[1] = "new";
    });
    flush();

    // delete
    setState(s => [s[0]]);
    flush();
    expect.assertions(15);
  });

  test("Tracking iteration Object key addition/removal", () => {
    const [state, setState] = createStore<{ obj: { item?: number } }>({ obj: {} });
    let executionCount = 0;
    let executionCount2 = 0;
    createRoot(() => {
      createEffect(
        () => {
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
        },
        () => {
          executionCount++;
        }
      );

      createEffect(
        () => {
          for (const key in state.obj) {
            key;
          }
          const u = snapshot(state.obj);
          if (executionCount2 === 0) expect(u.item).toBeUndefined();
          else if (executionCount2 === 1) {
            expect(u.item).toBe(5);
          } else if (executionCount2 === 2) {
            expect(u.item).toBeUndefined();
          } else {
            // should never get here
            expect(executionCount2).toBe(-1);
          }
        },
        () => {
          executionCount2++;
        }
      );
    });
    flush();
    // add
    setState(s => {
      s.obj.item = 5;
    });
    flush();

    // update
    // setState(s => { s.obj.item = 10; });
    // flush();

    // delete
    setState(s => {
      delete s.obj.item;
    });
    flush();
    expect.assertions(7);
  });

  test("Doesn't trigger object on addition/removal", () => {
    const [state, setState] = createStore<{ obj: { item?: number } }>({ obj: {} });
    let executionCount = 0;
    createRoot(() => {
      createEffect(
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
      );
    });
    flush();
    // add
    setState(s => {
      s.obj.item = 5;
    });
    flush();

    // delete
    setState(s => {
      delete s.obj.item;
    });
    flush();
    expect.assertions(1);
  });

  test("Tracking Top level iteration Object key addition/removal", () => {
    const [state, setState] = createStore<{ item?: number }>({});
    let executionCount = 0;
    let executionCount2 = 0;
    createRoot(() => {
      createEffect(
        () => {
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
        },
        () => {
          executionCount++;
        }
      );

      createEffect(
        () => {
          for (const key in state) {
            key;
          }
          const u = snapshot(state);
          if (executionCount2 === 0) expect(u.item).toBeUndefined();
          else if (executionCount2 === 1) {
            expect(u.item).toBe(5);
          } else if (executionCount2 === 2) {
            expect(u.item).toBeUndefined();
          } else {
            // should never get here
            expect(executionCount2).toBe(-1);
          }
        },
        () => {
          executionCount2++;
        }
      );
    });
    flush();
    // add
    setState(s => {
      s.item = 5;
    });
    flush();

    // delete
    setState(s => {
      delete s.item;
    });
    flush();
    expect.assertions(7);
  });

  test("Not Tracking Top level key addition/removal", () => {
    const [state, setState] = createStore<{ item?: number; item2?: number }>({});
    let executionCount = 0;
    createRoot(() => {
      createEffect(
        () => {
          if (executionCount === 0) expect(state.item2).toBeUndefined();
          else {
            // should never get here
            expect(executionCount).toBe(-1);
          }
        },
        () => {
          executionCount++;
        }
      );
    });
    flush();
    // add
    setState(s => {
      s.item = 5;
    });
    flush();

    // delete
    setState(s => {
      delete s.item;
    });
    flush();
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
      setState(s => {
        s.fn = () => 2;
      });
      flush();
      expect(getValue()).toBe(2);
    });
  });
});

describe("Setting state from Effects", () => {
  test("Setting state from signal", () => {
    const [getData, setData] = createSignal("init"),
      [state, setState] = createStore({ data: "" });
    createRoot(() => {
      createEffect(getData, v =>
        setState(s => {
          s.data = v;
        })
      );
    });
    setData("signal");
    flush();
    expect(state.data).toBe("signal");
  });

  test("Select Promise", () =>
    new Promise(done => {
      createRoot(async () => {
        const p = new Promise<string>(resolve => {
          setTimeout(resolve, 20, "promised");
        });
        const [state, setState] = createStore({ data: "" });
        p.then(v =>
          setState(s => {
            s.data = v;
          })
        );
        await p;
        expect(state.data).toBe("promised");
        done(undefined);
      });
    }));
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
});

describe("Array length", () => {
  test("Setting plain object", () => {
    const [state, setState] = createStore<{ list: number[] }>({ list: [] });
    let length;
    // isolate length tracking
    const list = state.list;
    createRoot(() => {
      createEffect(
        () => list.length,
        v => {
          length = v;
        }
      );
    });
    flush();
    expect(length).toBe(0);
    // insert at index 0
    setState(s => {
      s.list[0] = 1;
    });
    flush();
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
    const [store, setStore] = createStore<{ inner: CustomThing }>({ inner });

    expect(store.inner.a).toBe(1);
    expect(store.inner.b).toBe(10);

    let sum;
    createRoot(() => {
      createEffect(
        () => store.inner.a + store.inner.b,
        v => {
          sum = v;
        }
      );
    });
    flush();
    expect(sum).toBe(11);
    setStore(s => {
      s.inner.a = 10;
    });
    flush();
    expect(sum).toBe(20);
    setStore(s => {
      s.inner.b = 5;
    });
    flush();
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
      createEffect(
        () => store.inner.a + store.inner.b,
        v => {
          sum = v;
        }
      );
    });
    flush();
    expect(sum).toBe(11);
    setStore(s => {
      s.inner.a = 10;
    });
    flush();
    expect(sum).toBe(20);
    setStore(s => {
      s.inner.b = 5;
    });
    flush();
    expect(sum).toBe(15);
  });
});

describe("In Operator", () => {
  test("wrapped nested class", () => {
    let access = 0;
    const [store, setStore] = createStore<{ a?: number; b?: number; c?: number }>({
      a: 1,
      get b() {
        access++;
        return 2;
      }
    });

    expect("a" in store).toBe(true);
    expect("b" in store).toBe(true);
    expect("c" in store).toBe(false);
    expect(access).toBe(0);

    const [a, b, c] = createRoot(() => {
      return [
        createMemo(() => "a" in store),
        createMemo(() => "b" in store),
        createMemo(() => "c" in store)
      ];
    });

    expect(a()).toBe(true);
    expect(b()).toBe(true);
    expect(c()).toBe(false);
    expect(access).toBe(0);

    setStore(s => {
      s.c = 3;
    });
    flush();

    expect(a()).toBe(true);
    expect(b()).toBe(true);
    expect(c()).toBe(true);
    expect(access).toBe(0);

    setStore(s => {
      delete s.a;
    });
    flush();
    expect(a()).toBe(false);
    expect(b()).toBe(true);
    expect(c()).toBe(true);
    expect(access).toBe(0);

    expect("a" in store).toBe(false);
    expect("b" in store).toBe(true);
    expect("c" in store).toBe(true);
    expect(access).toBe(0);
  });
});

describe("getters", () => {
  it("supports getters that return frozen objects", () => {
    const [store, setStore] = createStore({
      get foo() {
        return Object.freeze({ foo: "foo" });
      }
    });

    expect(() => store.foo).not.toThrow();
  });
});

describe("objects", () => {
  it("updates", () => {
    const [store, setStore] = createStore({ foo: "foo" });
    const effect = vi.fn();
    createRoot(() =>
      createEffect(
        () => store.foo,
        v => effect(v)
      )
    );
    flush();
    expect(effect).toHaveBeenCalledTimes(1);
    expect(effect).toHaveBeenCalledWith("foo");

    setStore(s => {
      s.foo = "bar";
    });
    flush();
    expect(effect).toHaveBeenCalledTimes(2);
    expect(store.foo).toBe("bar");
  });

  it("updates with nested object", () => {
    const [store, setStore] = createStore({ foo: { bar: "bar" } });
    const effect = vi.fn();
    createRoot(() =>
      createEffect(
        () => store.foo.bar,
        v => effect(v)
      )
    );
    flush();
    expect(effect).toHaveBeenCalledTimes(1);
    expect(effect).toHaveBeenCalledWith("bar");

    setStore(s => {
      s.foo.bar = "baz";
    });
    flush();
    expect(effect).toHaveBeenCalledTimes(2);
    expect(effect).toHaveBeenCalledWith("baz");
  });

  it("is immutable from the outside", () => {
    const [store, setStore] = createStore({ foo: "foo" });
    const effect = vi.fn();
    createRoot(() =>
      createEffect(
        () => store.foo,
        v => effect(v)
      )
    );
    flush();
    expect(effect).toHaveBeenCalledTimes(1);
    expect(effect).toHaveBeenCalledWith("foo");

    /* @ts-ignore */
    store.foo = "bar";
    flush();
    expect(effect).toHaveBeenCalledTimes(1);
    expect(store.foo).toBe("foo");
  });

  it("has properties", () => {
    const [store, setStore] = createStore<{ foo?: string }>({});
    const effect = vi.fn();
    createRoot(() =>
      createEffect(
        () => "foo" in store,
        v => effect(v)
      )
    );
    flush();
    expect(effect).toHaveBeenCalledTimes(1);
    expect(effect).toHaveBeenCalledWith(false);

    setStore(s => {
      s.foo = "bar";
    });
    flush();
    expect(effect).toHaveBeenCalledTimes(2);
    expect(effect).toHaveBeenCalledWith(true);

    setStore(s => {
      s.foo = undefined;
    });
    flush();
    expect(effect).toHaveBeenCalledTimes(2);
    expect(effect).toHaveBeenCalledWith(true);

    setStore(s => {
      delete s.foo;
    });
    flush();
    expect(effect).toHaveBeenCalledTimes(3);
    expect(effect).toHaveBeenCalledWith(false);
  });
});

describe("arrays", () => {
  it("supports arrays", () => {
    const [store, setStore] = createStore([{ i: 1 }, { i: 2 }, { i: 3 }]);
    const effectA = vi.fn();
    const effectB = vi.fn();
    const effectC = vi.fn();
    createRoot(() => {
      createEffect(
        () => store.reduce((m, n) => m + n.i, 0),
        v => effectA(v)
      );
      createEffect(
        () => {
          const row = store[0];
          createEffect(
            () => row.i,
            v => effectC(v)
          );
          return row;
        },
        v => effectB(v.i)
      );
    });
    flush();
    expect(effectA).toHaveBeenCalledTimes(1);
    expect(effectA).toHaveBeenCalledWith(6);
    expect(effectB).toHaveBeenCalledTimes(1);
    expect(effectB).toHaveBeenCalledWith(1);
    expect(effectC).toHaveBeenCalledTimes(1);
    expect(effectC).toHaveBeenCalledWith(1);

    setStore(s => {
      s[0].i = 2;
    });
    flush();
    expect(effectA).toHaveBeenCalledTimes(2);
    expect(effectA).toHaveBeenCalledWith(7);
    expect(effectB).toHaveBeenCalledTimes(1);
    expect(effectC).toHaveBeenCalledTimes(2);
    expect(effectC).toHaveBeenCalledWith(2);

    setStore(s => {
      s.push({ i: 4 });
    });
    flush();
    expect(effectA).toHaveBeenCalledTimes(3);
    expect(effectA).toHaveBeenCalledWith(11);
    expect(effectB).toHaveBeenCalledTimes(1);
    expect(effectC).toHaveBeenCalledTimes(2);
  });
});
