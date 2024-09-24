import { describe, expect, test } from "vitest";
import { createRoot, createSignal, createMemo, batch, createEffect } from "../../src/index.js";
import { Accessor, Setter } from "../../types/index.js";
import { createMutable, unwrap, $RAW } from "../src/index.js";

test("Object.create(null) is allowed", () => {
  const user = createMutable(Object.assign(Object.create(null), { name: "John" }));
  expect(user.name).toBe("John");
});

describe("State Mutability", () => {
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
    // @ts-ignore check if proxy still
    expect(s.data.user[$RAW]).toBeUndefined();
  });
  test("Unwrap nested frozen array", () => {
    const state = createMutable({
        data: [{ user: { firstName: "John", lastName: "Snow" } }]
      }),
      s = unwrap({ data: state.data.slice(0) });
    expect(s.data[0].user.firstName).toBe("John");
    expect(s.data[0].user.lastName).toBe("Snow");
    // @ts-ignore check if proxy still
    expect(s.data[0].user[$RAW]).toBeUndefined();
  });
  test("Unwrap nested frozen state array", () => {
    const state = createMutable({
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
    let state: { data: number };
    createRoot(() => {
      state = createMutable({ data: 2 });
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
    state!.data = 5;
    // same value again should not retrigger
    state!.data = 5;
  });

  test("Deleting an undefined property", () => {
    let state: { firstName: string; lastName: string | undefined };
    let executionCount = 0;
    createRoot(() => {
      state = createMutable({
        firstName: "John",
        lastName: undefined
      });

      createEffect(() => {
        state.lastName;
        executionCount++;
      });
      //this should retrigger the execution despite it being undefined
    });
    delete state!.lastName;
    expect(executionCount).toBe(2);
  });

  test("Track a nested state change", () => {
    let executionCount = 0;
    let state: { user: { firstName: string; lastName: string } };
    createRoot(() => {
      state = createMutable({
        user: { firstName: "John", lastName: "Smith" }
      });
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
    state!.user.firstName = "Jake";
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
    let state: { data: string };
    let getData: Accessor<string>, setData: Setter<string>;
    createRoot(() => {
      ([getData, setData] = createSignal("init")), (state = createMutable({ data: "" }));
      // don't do this often
      createEffect(() => (state.data = getData()));
    });
    setData!("signal");
    expect(state!.data).toBe("signal");
  });

  test("Select Promise", () =>
    new Promise(done => {
      createRoot(async () => {
        const p = new Promise<string>(resolve => {
            setTimeout(resolve, 20, "promised");
          }),
          state = createMutable({ data: "" });
        p.then(v => (state.data = v));
        await p;
        expect(state.data).toBe("promised");
        done(undefined);
      });
    }));
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
  test("Respects batch in array mutate 2", () => {
    const state = createMutable([1, 2, 3]);
    batch(() => {
      expect(state.length).toBe(3);
      const move = state.splice(1, 1);
      expect(state.length).toBe(2);
      state.splice(0, 0, ...move);
      expect(state.length).toBe(3);
      expect(state).toEqual([2, 1, 3]);
    });
    expect(state.length).toBe(3);
    expect(state).toEqual([2, 1, 3]);
  });
});

describe("In Operator", () => {
  test("wrapped nested class", () => {
    let access = 0;
    const store = createMutable<{ a?: number; b?: number; c?: number }>({
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

    store.c = 3;

    expect(a()).toBe(true);
    expect(b()).toBe(true);
    expect(c()).toBe(true);
    expect(access).toBe(0);

    delete store.a;
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
