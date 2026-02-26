import { createEffect, createRoot, createStore, flush, storePath } from "../../src/index.js";

afterEach(() => flush());

describe("storePath helper", () => {
  test("Set a simple property", () => {
    const [store, setStore] = createStore({ name: "John", age: 30 });
    expect(store.name).toBe("John");
    setStore(storePath("name", "Jake"));
    expect(store.name).toBe("Jake");
    expect(store.age).toBe(30);
  });

  test("Set a nested property", () => {
    const [store, setStore] = createStore({
      user: { name: "John", address: { city: "London" } }
    });
    expect(store.user.address.city).toBe("London");
    setStore(storePath("user", "address", "city", "Paris"));
    expect(store.user.address.city).toBe("Paris");
    expect(store.user.name).toBe("John");
  });

  test("Set array item by index", () => {
    const [store, setStore] = createStore({ items: ["a", "b", "c"] });
    expect(store.items[1]).toBe("b");
    setStore(storePath("items", 1, "B"));
    expect(store.items[0]).toBe("a");
    expect(store.items[1]).toBe("B");
    expect(store.items[2]).toBe("c");
  });

  test("Set nested property in array item", () => {
    const [store, setStore] = createStore({
      todos: [
        { id: 1, text: "Learn", completed: false },
        { id: 2, text: "Build", completed: false }
      ]
    });
    setStore(storePath("todos", 0, "completed", true));
    expect(store.todos[0].completed).toBe(true);
    expect(store.todos[1].completed).toBe(false);
  });

  test("Array of indices", () => {
    const [store, setStore] = createStore({
      todos: [
        { id: 1, completed: false },
        { id: 2, completed: false },
        { id: 3, completed: false }
      ]
    });
    setStore(storePath("todos", [0, 2], "completed", true));
    expect(store.todos[0].completed).toBe(true);
    expect(store.todos[1].completed).toBe(false);
    expect(store.todos[2].completed).toBe(true);
  });

  test("Filter function on array", () => {
    const [store, setStore] = createStore({
      todos: [
        { id: 1, text: "a", completed: false },
        { id: 2, text: "b", completed: true },
        { id: 3, text: "c", completed: false }
      ]
    });
    setStore(storePath("todos", (todo: any) => !todo.completed, "completed", true));
    expect(store.todos[0].completed).toBe(true);
    expect(store.todos[1].completed).toBe(true);
    expect(store.todos[2].completed).toBe(true);
  });

  test("Range object on array", () => {
    const [store, setStore] = createStore({
      items: [0, 0, 0, 0, 0, 0]
    });
    setStore(storePath("items", { from: 1, to: 4, by: 2 }, 99));
    expect(store.items[0]).toBe(0);
    expect(store.items[1]).toBe(99);
    expect(store.items[2]).toBe(0);
    expect(store.items[3]).toBe(99);
    expect(store.items[4]).toBe(0);
    expect(store.items[5]).toBe(0);
  });

  test("Range with defaults", () => {
    const [store, setStore] = createStore({ items: [1, 2, 3] });
    setStore(storePath("items", {}, 0));
    expect(store.items[0]).toBe(0);
    expect(store.items[1]).toBe(0);
    expect(store.items[2]).toBe(0);
  });

  test("Functional setter", () => {
    const [store, setStore] = createStore({ count: 5 });
    setStore(storePath("count", (prev: number) => prev + 1));
    expect(store.count).toBe(6);
  });

  test("Functional setter on nested value", () => {
    const [store, setStore] = createStore({
      user: { name: "John", age: 30 }
    });
    setStore(storePath("user", "age", (prev: number) => prev * 2));
    expect(store.user.age).toBe(60);
  });

  test("Functional setter no-op when returning same value", () => {
    const [store, setStore] = createStore({ count: 5 });
    let effectCount = 0;
    createRoot(() => {
      createEffect(
        () => store.count,
        () => {
          effectCount++;
        }
      );
    });
    flush();
    expect(effectCount).toBe(1);
    setStore(storePath("count", (prev: number) => prev));
    flush();
    expect(effectCount).toBe(1);
  });

  test("Root-level merge", () => {
    const [store, setStore] = createStore({ name: "John", age: 30 });
    setStore(storePath({ name: "Jake" }));
    expect(store.name).toBe("Jake");
    expect(store.age).toBe(30);
  });

  test("Nested object merge (wrappable value)", () => {
    const [store, setStore] = createStore({
      user: { name: "John", age: 30, city: "London" }
    });
    setStore(storePath("user", { name: "Jake", age: 31 }));
    expect(store.user.name).toBe("Jake");
    expect(store.user.age).toBe(31);
    expect(store.user.city).toBe("London");
  });

  test("Direct set replaces non-wrappable values", () => {
    const [store, setStore] = createStore({ value: "hello" });
    setStore(storePath("value", "world"));
    expect(store.value).toBe("world");
  });

  test("Direct set replaces with array", () => {
    const [store, setStore] = createStore<{ items: number[] }>({ items: [1, 2, 3] });
    setStore(storePath("items", [4, 5]));
    expect(store.items[0]).toBe(4);
    expect(store.items[1]).toBe(5);
    expect(store.items.length).toBe(2);
  });

  test("Filter function receives index", () => {
    const [store, setStore] = createStore({ items: [10, 20, 30, 40, 50] });
    setStore(
      storePath("items", (_: number, i: number) => i % 2 === 0, (v: number) => v * 10)
    );
    expect(store.items[0]).toBe(100);
    expect(store.items[1]).toBe(20);
    expect(store.items[2]).toBe(300);
    expect(store.items[3]).toBe(40);
    expect(store.items[4]).toBe(500);
  });

  test("Triggers reactive updates", () => {
    const [store, setStore] = createStore({ count: 0 });
    let observed: number | undefined;
    createRoot(() => {
      createEffect(
        () => store.count,
        v => {
          observed = v;
        }
      );
    });
    flush();
    expect(observed).toBe(0);
    setStore(storePath("count", 42));
    flush();
    expect(observed).toBe(42);
  });

  test("Deeply nested reactive updates", () => {
    const [store, setStore] = createStore({
      a: { b: { c: { d: 0 } } }
    });
    let observed: number | undefined;
    createRoot(() => {
      createEffect(
        () => store.a.b.c.d,
        v => {
          observed = v;
        }
      );
    });
    flush();
    expect(observed).toBe(0);
    setStore(storePath("a", "b", "c", "d", 99));
    flush();
    expect(observed).toBe(99);
  });
});

describe("storePath.DELETE", () => {
  test("Delete a property", () => {
    const [store, setStore] = createStore<{ name: string; nickname?: string }>({
      name: "John",
      nickname: "Johnny"
    });
    expect(store.nickname).toBe("Johnny");
    setStore(storePath("nickname", storePath.DELETE));
    expect(store.nickname).toBeUndefined();
    expect("nickname" in store).toBe(false);
  });

  test("Delete a nested property", () => {
    const [store, setStore] = createStore<{
      user: { name: string; middle?: string; last: string };
    }>({
      user: { name: "John", middle: "M", last: "Doe" }
    });
    expect(store.user.middle).toBe("M");
    setStore(storePath("user", "middle", storePath.DELETE));
    expect(store.user.middle).toBeUndefined();
    expect("middle" in store.user).toBe(false);
    expect(store.user.name).toBe("John");
    expect(store.user.last).toBe("Doe");
  });

  test("Delete triggers reactive updates", () => {
    const [store, setStore] = createStore<{ value?: string }>({ value: "hello" });
    let observed: string | undefined;
    createRoot(() => {
      createEffect(
        () => store.value,
        v => {
          observed = v;
        }
      );
    });
    flush();
    expect(observed).toBe("hello");
    setStore(storePath("value", storePath.DELETE));
    flush();
    expect(observed).toBeUndefined();
  });

  test("Functional setter returning DELETE", () => {
    const [store, setStore] = createStore<{ items: (string | undefined)[] }>({
      items: ["a", "b", "c"]
    });
    setStore(storePath("items", 1, () => storePath.DELETE as any));
    expect(store.items[1]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Type-level tests (not executed, just checked by tsc)
// ---------------------------------------------------------------------------
() => {
  const [store, setStore] = createStore({
    name: "John",
    count: 0,
    user: { age: 30, address: { city: "London" } },
    todos: [{ id: 1, completed: false }]
  });

  // Valid paths
  setStore(storePath("name", "Jake"));
  setStore(storePath("count", 5));
  setStore(storePath("count", (prev) => prev + 1));
  setStore(storePath("user", "age", 31));
  setStore(storePath("user", "address", "city", "Paris"));
  setStore(storePath("todos", 0, "completed", true));
  setStore(storePath("user", { age: 31 }));
  setStore(storePath({ name: "Jake" }));

  // @ts-expect-error invalid key at root
  setStore(storePath("nonexistent", 5));
  // @ts-expect-error invalid key at nested level
  setStore(storePath("user", "nonexistent", 5));
  // @ts-expect-error wrong value type
  setStore(storePath("count", "not a number"));
  // @ts-expect-error wrong nested value type
  setStore(storePath("user", "age", "not a number"));
};
