import {
  createRoot,
  createState,
  createSignal,
  createComputed,
  createMemo,
  unwrap,
  $RAW
} from "../src";

describe("State immutablity", () => {
  test("Setting a property", () => {
    const [state] = createState({ name: "John" });
    expect(state.name).toBe("John");
    state.name = "Jake";
    expect(state.name).toBe("John");
  });

  test("Deleting a property", () => {
    const [state] = createState({ name: "John" });
    expect(state.name).toBe("John");
    // @ts-ignore
    delete state.name;
    expect(state.name).toBe("John");
  });

  test("Immutable state is not mutable even inside setter", () => {
    const [state, setState] = createState({ name: "John" });
    expect(state.name).toBe("John");
    setState(() => {
      state.name = "Jake";
    });
    expect(state.name).toBe("John");
  });
});

describe("State Getters", () => {
  test("Testing an update from state", () => {
    const [state, setState] = createState({
      name: "John",
      get greeting(): string {
        return `Hi, ${state.name}`;
      }
    });
    expect(state.greeting).toBe("Hi, John");
    setState({ name: "Jake" });
    expect(state.greeting).toBe("Hi, Jake");
  });
});

describe("Simple setState modes", () => {
  test("Simple Key Value", () => {
    const [state, setState] = createState({ key: "" });
    setState("key", "value");
    expect(state.key).toBe("value");
  });

  test("Top level merge", () => {
    const [state, setState] = createState({ starting: 1, ending: 1 });
    setState({ ending: 2 });
    expect(state.starting).toBe(1);
    expect(state.ending).toBe(2);
  });

  test("Top level merge no arguments", () => {
    const [state, setState] = createState({ starting: 1 });
    setState({});
    expect(state.starting).toBe(1);
  });

  test("Top level state function merge", () => {
    const [state, setState] = createState({ starting: 1, ending: 1 });
    setState(s => ({ ending: s.starting + 1 }));
    expect(state.starting).toBe(1);
    expect(state.ending).toBe(2);
  });

  test("Nested merge", () => {
    const [state, setState] = createState({ data: { starting: 1, ending: 1 } });
    setState("data", { ending: 2 });
    expect(state.data.starting).toBe(1);
    expect(state.data.ending).toBe(2);
  });

  test("Nested state function merge", () => {
    const [state, setState] = createState({ data: { starting: 1, ending: 1 } });
    setState("data", d => ({ ending: d.starting + 1 }));
    expect(state.data.starting).toBe(1);
    expect(state.data.ending).toBe(2);
  });

  test("Test Array", () => {
    const [state, setState] = createState({
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
    const [state, setState] = createState({ rows: [1, 2, 3, 4, 5] });
    setState("rows", [1, 3], r => r * 2);
    expect(state.rows[0]).toBe(1);
    expect(state.rows[1]).toBe(4);
    expect(state.rows[2]).toBe(3);
    expect(state.rows[3]).toBe(8);
    expect(state.rows[4]).toBe(5);
  });
  test("Update filterFn", () => {
    const [state, setState] = createState({ rows: [1, 2, 3, 4, 5] });
    setState(
      "rows",
      (r, i) => !!(i % 2),
      r => r * 2
    );
    expect(state.rows[0]).toBe(1);
    expect(state.rows[1]).toBe(4);
    expect(state.rows[2]).toBe(3);
    expect(state.rows[3]).toBe(8);
    expect(state.rows[4]).toBe(5);
  });
  test("Update traversal range", () => {
    const [state, setState] = createState({ rows: [1, 2, 3, 4, 5] });
    setState("rows", { from: 1, to: 4, by: 2 }, r => r * 2);
    expect(state.rows[0]).toBe(1);
    expect(state.rows[1]).toBe(4);
    expect(state.rows[2]).toBe(3);
    expect(state.rows[3]).toBe(8);
    expect(state.rows[4]).toBe(5);
  });
  test("Update traversal range defaults", () => {
    const [state, setState] = createState({ rows: [1, 2, 3, 4, 5] });
    setState("rows", {}, r => r * 2);
    expect(state.rows[0]).toBe(2);
    expect(state.rows[1]).toBe(4);
    expect(state.rows[2]).toBe(6);
    expect(state.rows[3]).toBe(8);
    expect(state.rows[4]).toBe(10);
  });
});

describe("Unwrapping Edge Cases", () => {
  test("Unwrap nested frozen state object", () => {
    var [state] = createState({
        data: Object.freeze({ user: { firstName: "John", lastName: "Snow" } })
      }),
      s = unwrap({ ...state });
    expect(s.data.user.firstName).toBe("John");
    expect(s.data.user.lastName).toBe("Snow");
    // check if proxy still
    expect(s.data.user[$RAW]).toBeUndefined();
  });
  test("Unwrap nested frozen array", () => {
    var [state] = createState({
        data: [{ user: { firstName: "John", lastName: "Snow" } }]
      }),
      s = unwrap({ data: state.data.slice(0) });
    expect(s.data[0].user.firstName).toBe("John");
    expect(s.data[0].user.lastName).toBe("Snow");
    // check if proxy still
    expect(s.data[0].user[$RAW]).toBeUndefined();
  });
  test("Unwrap nested frozen state array", () => {
    var [state] = createState({
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
      var [state, setState] = createState({ data: 2 }),
        executionCount = 0;

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

      setState({ data: 5 });

      // same value again should not retrigger
      setState({ data: 5 });
    });
  });

  test("Track a nested state change", () => {
    createRoot(() => {
      var [state, setState] = createState({
          user: { firstName: "John", lastName: "Smith" }
        }),
        executionCount = 0;

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

      setState("user", "firstName", "Jake");
    });
  });
});

describe("Handling functions in state", () => {
  test("Array Native Methods: Array.Filter", () => {
    createRoot(() => {
      var [state] = createState({ list: [0, 1, 2] }),
        getFiltered = createMemo(() => state.list.filter(i => i % 2));
      expect(getFiltered()).toStrictEqual([1]);
    });
  });

  test("Track function change", () => {
    createRoot(() => {
      var [state, setState] = createState<{ fn: () => number }>({
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
    createRoot(() => {
      var [getData, setData] = createSignal("init"),
        [state, setState] = createState({ data: "" });
      createComputed(() => setState("data", getData()));
      setData("signal");
      expect(state.data).toBe("signal");
    });
  });

  test("Select Promise", done => {
    createRoot(async () => {
      var p = new Promise<string>(resolve => {
          setTimeout(resolve, 20, "promised");
        }),
        [state, setState] = createState({ data: "" });
      p.then(v => setState("data", v));
      await p;
      expect(state.data).toBe("promised");
      done();
    });
  });
});

describe("State wrapping", () => {
  test("Setting plain object", () => {
    const data = { withProperty: "y" },
      [state] = createState({ data });
    // not wrapped
    expect(state.data).not.toBe(data);
  });
  test("Setting plain array", () => {
    const data = [1, 2, 3],
      [state] = createState({ data });
    // not wrapped
    expect(state.data).not.toBe(data);
  });
  test("Setting non-wrappable", () => {
    const date = new Date(),
      [state] = createState({ time: date });
    // not wrapped
    expect(state.time).toBe(date);
  });
});
