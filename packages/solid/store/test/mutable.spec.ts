import { createRoot, createSignal, createComputed, createMemo, batch } from "../../src";
import { createMutable, unwrap, $RAW } from "../src";

describe("State Mutablity", () => {
  test("Setting a property", () => {
    const user = createMutable({ name: "John" });
    expect(user.name).toBe("John");
    user.name = "Jake";
    expect(user.name).toBe("Jake");
  });

  test("Deleting a property", () => {
    const user = createMutable({ name: "John" });
    expect(user.name).toBe("John");
    // @ts-ignore
    delete user.name;
    expect(user.name).toBeUndefined();
  });
});

describe("State Getter/Setters", () => {
  test("Testing an update from state", () => {
    let user: any;
    createRoot(() => {
      user = createMutable({
        name: "John",
        get greeting(): string {
          return `Hi, ${this.name}`;
        }
      });
    });
    expect(user.greeting).toBe("Hi, John");
    user.name = "Jake";
    expect(user.greeting).toBe("Hi, Jake");
  });

  test("setting a value with setters", () => {
    let user: any;
    createRoot(() => {
      user = createMutable({
        firstName: "John",
        lastName: "Smith",
        get fullName(): string {
          return `${this.firstName} ${this.lastName}`;
        },
        set fullName(value) {
          const parts = value.split(" ");
          this.firstName = parts[0];
          this.lastName = parts[1];
        }
      });
    });
    expect(user.fullName).toBe("John Smith");
    user.fullName = "Jake Murray";
    expect(user.firstName).toBe("Jake");
    expect(user.lastName).toBe("Murray");
  });
});

describe("Simple update modes", () => {
  test("Simple Key Value", () => {
    const state = createMutable({ key: "" });
    state.key = "value";
    expect(state.key).toBe("value");
  });

  test("Nested update", () => {
    const state = createMutable({ data: { starting: 1, ending: 1 } });
    state.data.ending = 2;
    expect(state.data.starting).toBe(1);
    expect(state.data.ending).toBe(2);
  });

  test("Test Array", () => {
    const todos = createMutable([
        { id: 1, title: "Go To Work", done: true },
        { id: 2, title: "Eat Lunch", done: false }
      ]);
    todos[1].done = true;
    todos.push({ id: 3, title: "Go Home", done: false });
    expect(Array.isArray(todos)).toBe(true);
    expect(todos[1].done).toBe(true);
    expect(todos[2].title).toBe("Go Home");
  });
});

describe("Unwrapping Edge Cases", () => {
  test("Unwrap nested frozen state object", () => {
    const state = createMutable({
        data: Object.freeze({ user: { firstName: "John", lastName: "Snow" } })
      }),
      s = unwrap({ ...state });
    expect(s.data.user.firstName).toBe("John");
    expect(s.data.user.lastName).toBe("Snow");
    // check if proxy still
    expect(s.data.user[$RAW]).toBeUndefined();
  });
  test("Unwrap nested frozen array", () => {
    const state = createMutable({
        data: [{ user: { firstName: "John", lastName: "Snow" } }]
      }),
      s = unwrap({ data: state.data.slice(0) });
    expect(s.data[0].user.firstName).toBe("John");
    expect(s.data[0].user.lastName).toBe("Snow");
    // check if proxy still
    expect(s.data[0].user[$RAW]).toBeUndefined();
  });
  test("Unwrap nested frozen state array", () => {
    const state = createMutable({
        data: Object.freeze([{ user: { firstName: "John", lastName: "Snow" } }])
      }),
      s = unwrap({ ...state });
    expect(s.data[0].user.firstName).toBe("John");
    expect(s.data[0].user.lastName).toBe("Snow");
    // check if proxy still
    expect(s.data[0].user[$RAW]).toBeUndefined();
  });
});

describe("Tracking State changes", () => {
  test("Track a state change", () => {
    createRoot(() => {
      const state = createMutable({ data: 2 })
      let executionCount = 0;

      expect.assertions(2);
      createComputed(() => {
        if (executionCount === 0) expect(state.data).toBe(2);
        else if (executionCount === 1) {
          expect(state.data).toBe(5);
        } else {
          // should never get here
          expect(executionCount).toBe(-1);
        }
        executionCount++;
      });

      state.data = 5;
      // same value again should not retrigger
      state.data = 5;
    });
  });

  test("Track a nested state change", () => {
    createRoot(() => {
      const state = createMutable({
          user: { firstName: "John", lastName: "Smith" }
        })
      let executionCount = 0;

      expect.assertions(2);
      createComputed(() => {
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

      state.user.firstName = "Jake";
    });
  });
});

describe("Handling functions in state", () => {
  test("Array Native Methods: Array.Filter", () => {
    createRoot(() => {
      const list = createMutable([0, 1, 2]),
        getFiltered = createMemo(() => list.filter(i => i % 2));
      expect(getFiltered()).toStrictEqual([1]);
    });
  });

  test("Track function change", () => {
    createRoot(() => {
      const state = createMutable<{ fn: () => number }>({
          fn: () => 1
        }),
        getValue = createMemo(() => state.fn());
      state.fn = () => 2;
      expect(getValue()).toBe(2);
    });
  });
});

describe("Setting state from Effects", () => {
  test("Setting state from signal", () => {
    createRoot(() => {
      const [getData, setData] = createSignal("init"),
        state = createMutable({ data: "" });
      createComputed(() => (state.data = getData()));
      setData("signal");
      expect(state.data).toBe("signal");
    });
  });

  test("Select Promise", done => {
    createRoot(async () => {
      const p = new Promise<string>(resolve => {
          setTimeout(resolve, 20, "promised");
        }),
        state = createMutable({ data: "" });
      p.then(v => (state.data = v));
      await p;
      expect(state.data).toBe("promised");
      done();
    });
  });
});

describe("State wrapping", () => {
  test("Setting plain object", () => {
    const data = { withProperty: "y" },
      state = createMutable({ data });
    // not wrapped
    expect(state.data).not.toBe(data);
  });
  test("Setting plain array", () => {
    const data = [1, 2, 3],
      state = createMutable({ data });
    // not wrapped
    expect(state.data).not.toBe(data);
  });
  test("Setting non-wrappable", () => {
    const date = new Date(),
      state = createMutable({ time: date });
    // not wrapped
    expect(state.time).toBe(date);
  });
});

describe("Batching", () => {
  test("Respects batch", () => {
    const state = createMutable({ data: 1 });
    batch(() => {
      expect(state.data).toBe(1);
      state.data = 2;
      expect(state.data).toBe(1);
    })
    expect(state.data).toBe(2);
  });
  test("Respects batch in array", () => {
    const state = createMutable([1]);
    batch(() => {
      expect(state[0]).toBe(1);
      state[0] = 2;
      expect(state[0]).toBe(1);
    })
    expect(state[0]).toBe(2);
  });
  test("Respects batch in array mutate", () => {
    const state = createMutable([1]);
    batch(() => {
      expect(state.length).toBe(1);
      state[1] = 2;
      expect(state.length).toBe(1);
    })
    expect(state.length).toBe(2);
  })
})
