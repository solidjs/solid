import {
  action,
  affects,
  createEffect,
  createMemo,
  createOptimisticStore,
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  deep,
  flush,
  isPending,
  latest,
  mapArray,
  refresh,
  snapshot,
  until,
  untrack,
  type Refreshable
} from "../../src/index.js";

afterEach(() => flush());

describe("createOptimisticStore", () => {
  describe("basic behavior", () => {
    it("should store and return value on read", () => {
      const [state] = createOptimisticStore({ name: "John", age: 30 });
      expect(state.name).toBe("John");
      expect(state.age).toBe(30);
    });

    it("should update store via setter and revert on flush", () => {
      const [state, setState] = createOptimisticStore({ name: "John" });
      setState(s => {
        s.name = "Jake";
      });
      // Optimistic update should be immediately visible
      expect(state.name).toBe("Jake");
      // Without an active transition, flush reverts to original value
      flush();
      expect(state.name).toBe("John");
    });

    it("should allow multiple optimistic updates before flush", () => {
      const [state, setState] = createOptimisticStore({ count: 1 });
      setState(s => {
        s.count = 2;
      });
      expect(state.count).toBe(2);
      setState(s => {
        s.count = 3;
      });
      expect(state.count).toBe(3);
      setState(s => {
        s.count = s.count + 10;
      });
      expect(state.count).toBe(13);
      // All revert on flush
      flush();
      expect(state.count).toBe(1);
    });

    it("should handle multiple properties independently", () => {
      const [state, setState] = createOptimisticStore({ a: 1, b: 10 });
      setState(s => {
        s.a = 2;
      });
      expect(state.a).toBe(2);
      expect(state.b).toBe(10);

      setState(s => {
        s.b = 20;
      });
      expect(state.a).toBe(2);
      expect(state.b).toBe(20);

      flush();
      expect(state.a).toBe(1);
      expect(state.b).toBe(10);
    });
  });

  describe("nested objects", () => {
    it("should update nested properties and revert on flush", () => {
      const [state, setState] = createOptimisticStore({
        user: { name: "John", address: { city: "NYC" } }
      });

      setState(s => {
        s.user.name = "Jake";
      });
      expect(state.user.name).toBe("Jake");
      expect(state.user.address.city).toBe("NYC");

      setState(s => {
        s.user.address.city = "LA";
      });
      expect(state.user.address.city).toBe("LA");

      flush();
      expect(state.user.name).toBe("John");
      expect(state.user.address.city).toBe("NYC");
    });

    it("should handle replacing nested objects and revert", () => {
      const [state, setState] = createOptimisticStore({
        user: { name: "John" }
      });

      setState(s => {
        s.user = { name: "Jake" };
      });
      expect(state.user.name).toBe("Jake");

      flush();
      expect(state.user.name).toBe("John");
    });
  });

  describe("arrays", () => {
    it("should update array items and revert on flush", () => {
      const [state, setState] = createOptimisticStore({
        todos: [
          { id: 1, text: "First", done: false },
          { id: 2, text: "Second", done: false }
        ]
      });

      setState(s => {
        s.todos[0].done = true;
      });
      expect(state.todos[0].done).toBe(true);
      expect(state.todos[1].done).toBe(false);

      flush();
      expect(state.todos[0].done).toBe(false);
    });

    it("should handle array push and revert", () => {
      const [state, setState] = createOptimisticStore({
        items: [1, 2, 3]
      });

      setState(s => {
        s.items.push(4);
      });
      expect(state.items.length).toBe(4);
      expect(state.items[3]).toBe(4);

      flush();
      expect(state.items.length).toBe(3);
      expect(state.items[3]).toBeUndefined();
    });

    it("should handle array splice and revert", () => {
      const [state, setState] = createOptimisticStore({
        items: ["a", "b", "c"]
      });

      setState(s => {
        s.items.splice(1, 1); // remove "b"
      });
      expect(state.items).toEqual(["a", "c"]);

      flush();
      expect(state.items).toEqual(["a", "b", "c"]);
    });

    it("should handle top-level array store", () => {
      const [state, setState] = createOptimisticStore([
        { id: 1, name: "First" },
        { id: 2, name: "Second" }
      ]);

      setState(s => {
        s[0].name = "Updated First";
      });
      expect(state[0].name).toBe("Updated First");

      setState(s => {
        s.push({ id: 3, name: "Third" });
      });
      expect(state.length).toBe(3);

      flush();
      expect(state[0].name).toBe("First");
      expect(state.length).toBe(2);
    });
  });

  describe("async transitions", () => {
    it("should show optimistic value during async transition and revert when complete", async () => {
      const [state, setState] = createOptimisticStore({ count: 0 });
      const values: number[] = [];

      createRoot(() => {
        createRenderEffect(
          () => state.count,
          v => {
            values.push(v);
          }
        );
      });

      flush();
      expect(values).toEqual([0]);

      const doAsync = action(function* () {
        setState(s => {
          s.count = 1;
        });
        yield Promise.resolve();
      });

      doAsync();
      flush();

      expect(state.count).toBe(1);
      expect(values).toEqual([0, 1]);

      await Promise.resolve();

      expect(state.count).toBe(0);
      expect(values).toEqual([0, 1, 0]);
    });

    it("should show each optimistic update during transition", async () => {
      const [state, setState] = createOptimisticStore({ count: 0 });
      const values: number[] = [];

      createRoot(() => {
        createRenderEffect(
          () => state.count,
          v => {
            values.push(v);
          }
        );
      });

      flush();

      const doAsync = action(function* () {
        setState(s => {
          s.count = 1;
        });
        yield Promise.resolve();
        setState(s => {
          s.count = 2;
        });
        yield Promise.resolve();
      });

      doAsync();
      flush();
      expect(state.count).toBe(1);

      await Promise.resolve();
      expect(state.count).toBe(2);

      await Promise.resolve();
      expect(state.count).toBe(0);

      expect(values).toEqual([0, 1, 2, 0]);
    });

    it("should not trigger effect if optimistic value matches original", async () => {
      const [state, setState] = createOptimisticStore({ value: 5 });
      const effectRuns = vi.fn();

      createRoot(() => {
        createRenderEffect(
          () => state.value,
          v => effectRuns(v)
        );
      });

      flush();
      expect(effectRuns).toHaveBeenCalledTimes(1);
      expect(effectRuns).toHaveBeenLastCalledWith(5);

      const doAsync = action(function* () {
        setState(s => {
          s.value = 5; // same as original
        });
        yield Promise.resolve();
      });

      doAsync();
      flush();
      expect(effectRuns).toHaveBeenCalledTimes(1);

      await Promise.resolve();
      expect(effectRuns).toHaveBeenCalledTimes(1);
    });

    it("should hold regular store value during transition while showing optimistic", async () => {
      const [regular, setRegular] = createStore({ value: 10 });
      const [optimistic, setOptimistic] = createOptimisticStore({ value: 1 });
      const values: Array<{ r: number; o: number }> = [];

      createRoot(() => {
        createRenderEffect(
          () => ({ r: regular.value, o: optimistic.value }),
          v => {
            values.push(v);
          }
        );
      });

      flush();
      expect(values).toEqual([{ r: 10, o: 1 }]);

      const doAsync = action(function* () {
        setOptimistic(s => {
          s.value = 100;
        });
        setRegular(s => {
          s.value = 20;
        });
        yield Promise.resolve();
      });

      doAsync();
      flush();
      expect(values).toEqual([
        { r: 10, o: 1 },
        { r: 10, o: 100 }
      ]);

      await Promise.resolve();
      expect(regular.value).toBe(20);
      expect(optimistic.value).toBe(1);
      expect(values).toEqual([
        { r: 10, o: 1 },
        { r: 10, o: 100 },
        { r: 20, o: 1 }
      ]);
    });

    it("should revert nested object changes when transition completes", async () => {
      const [state, setState] = createOptimisticStore({
        user: { name: "John", settings: { theme: "light" } }
      });

      const doAsync = action(function* () {
        setState(s => {
          s.user.name = "Jake";
          s.user.settings.theme = "dark";
        });
        yield Promise.resolve();
      });

      doAsync();
      flush();
      expect(state.user.name).toBe("Jake");
      expect(state.user.settings.theme).toBe("dark");

      await Promise.resolve();
      expect(state.user.name).toBe("John");
      expect(state.user.settings.theme).toBe("light");
    });
  });

  describe("derived optimistic stores (projections)", () => {
    it("should derive from source signal and revert optimistic writes", () => {
      const [$x, setX] = createSignal(1);
      const [state, setState] = createOptimisticStore(
        s => {
          s.value = $x() + 1;
        },
        { value: 0 }
      );

      flush();
      expect(state.value).toBe(2);

      // Optimistic write
      setState(s => {
        s.value = 100;
      });
      expect(state.value).toBe(100);

      // On flush, reverts to derived value
      flush();
      expect(state.value).toBe(2);

      // Source change propagates through
      setX(5);
      flush();
      expect(state.value).toBe(6);
    });

    it("should allow return value reconciliation and revert optimistic", () => {
      const [$x, setX] = createSignal(1);
      const [state, setState] = createOptimisticStore(() => ({ value: $x() * 2 }), { value: 0 });

      flush();
      expect(state.value).toBe(2);

      setState(s => {
        s.value = 50;
      });
      expect(state.value).toBe(50);

      flush();
      expect(state.value).toBe(2);

      setX(10);
      flush();
      expect(state.value).toBe(20);
    });

    it("swaps when the derive returns a different entity", () => {
      const [$id, setId] = createSignal(1);
      const [state] = createOptimisticStore<{ id: number; name: string }>(
        () => ({ id: $id(), name: `user ${$id()}` }),
        {} as any
      );

      flush();
      expect(state.name).toBe("user 1");

      setId(2);
      flush();
      expect(state.id).toBe(2);
      expect(state.name).toBe("user 2");
    });

    it("swaps entity with an optimistic overlay in flight", () => {
      const [$id, setId] = createSignal(1);
      const [state, setState] = createOptimisticStore<{ id: number; name: string }>(
        () => ({ id: $id(), name: `user ${$id()}` }),
        {} as any
      );

      flush();
      // Overlay shadows `id`, so the identity probe reads through the layer
      // rather than the raw — the swap must still resolve against the base.
      setState(s => {
        s.id = 99;
        s.name = "optimistic";
      });
      expect(state.id).toBe(99);

      setId(2);
      flush();
      expect(state.id).toBe(2);
      expect(state.name).toBe("user 2");
    });

    it('honours key: null instead of defaulting to "id"', () => {
      const [$id, setId] = createSignal(1);
      let firstPost!: { id: number; title: string };
      const [state] = createOptimisticStore<{ id: number; posts: { id: number; title: string }[] }>(
        () => ({ id: $id(), posts: [{ id: $id() * 10, title: `t${$id()}` }] }),
        {} as any,
        { key: null }
      );

      createRoot(() => {
        createRenderEffect(
          () => state.posts[0],
          p => {
            firstPost = p;
          }
        );
      });

      flush();
      const before = firstPost;
      setId(2);
      flush();
      expect(firstPost).toBe(before);
      expect(firstPost.title).toBe("t2");
    });

    it("should handle async projection and revert optimistic writes", async () => {
      const [$x, setX] = createSignal(1);
      const [state, setState] = createOptimisticStore(
        async s => {
          const v = $x();
          await Promise.resolve();
          s.value = v * 2;
        },
        { value: 0 }
      );

      createRoot(() => {
        createRenderEffect(
          () => state.value,
          () => {}
        );
      });

      flush();
      await Promise.resolve();
      await Promise.resolve();
      expect(state.value).toBe(2);

      // Optimistic write
      setState(s => {
        s.value = 8;
      });
      expect(state.value).toBe(8);

      // Just flush without source update - this simpler case should still revert
      flush();
      // After the async projection completes and transition ends, optimistic should revert
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      // The projection still computes from x=1, so base value is 2
      expect(state.value).toBe(2);
    });

    it("should work with projection that modifies nested data", async () => {
      const [$items] = createSignal([
        { id: 1, name: "A" },
        { id: 2, name: "B" }
      ]);

      const [state, setState] = createOptimisticStore(
        s => {
          const items = $items();
          s.items = items;
          s.count = items.length;
        },
        { items: [] as { id: number; name: string }[], count: 0 }
      );

      flush();
      expect(state.count).toBe(2);
      expect(state.items[0].name).toBe("A");

      // Optimistic update
      const doAsync = action(function* () {
        setState(s => {
          s.items[0].name = "Updated A";
          s.count = 99;
        });
        yield Promise.resolve();
      });

      doAsync();
      flush();
      expect(state.items[0].name).toBe("Updated A");
      expect(state.count).toBe(99);

      await Promise.resolve();
      expect(state.items[0].name).toBe("A");
      expect(state.count).toBe(2);
    });
  });

  describe("reactivity tracking", () => {
    it("should track property changes through effects", () => {
      const [state, setState] = createOptimisticStore({ name: "John" });
      const values: string[] = [];

      createRoot(() => {
        createRenderEffect(
          () => state.name,
          v => {
            values.push(v);
          }
        );
      });

      flush();
      expect(values).toEqual(["John"]);

      setState(s => {
        s.name = "Jake";
      });
      flush();
      expect(values).toEqual(["John", "Jake", "John"]); // optimistic then revert
    });

    it("should track Object.keys changes", async () => {
      const [state, setState] = createOptimisticStore<{ a?: number; b?: number }>({ a: 1 });
      const keyCounts: number[] = [];

      createRoot(() => {
        createRenderEffect(
          () => Object.keys(state).length,
          v => {
            keyCounts.push(v);
          }
        );
      });

      flush();
      expect(keyCounts).toEqual([1]);

      const doAsync = action(function* () {
        setState(s => {
          s.b = 2;
        });
        yield Promise.resolve();
      });

      doAsync();
      flush();
      expect(keyCounts).toEqual([1, 2]);

      await Promise.resolve();
      expect(keyCounts).toEqual([1, 2, 1]); // reverts
    });

    it("should track 'in' operator changes", async () => {
      const [state, setState] = createOptimisticStore<{ item?: number }>({});
      const hasItem: boolean[] = [];

      createRoot(() => {
        createRenderEffect(
          () => "item" in state,
          v => {
            hasItem.push(v);
          }
        );
      });

      flush();
      expect(hasItem).toEqual([false]);

      const doAsync = action(function* () {
        setState(s => {
          s.item = 5;
        });
        yield Promise.resolve();
      });

      doAsync();
      flush();
      expect(hasItem).toEqual([false, true]);

      await Promise.resolve();
      expect(hasItem).toEqual([false, true, false]);
    });
  });

  describe("multiple sequential cycles", () => {
    it("should revert correctly across multiple optimistic cycles", async () => {
      const [state, setState] = createOptimisticStore({ count: 0 });
      const values: number[] = [];

      createRoot(() => {
        createRenderEffect(
          () => state.count,
          v => {
            values.push(v);
          }
        );
      });

      flush();
      expect(values).toEqual([0]);

      // First cycle
      let resolve1: () => void;
      const promise1 = new Promise<void>(r => (resolve1 = r));
      const action1 = action(function* () {
        yield promise1;
      });

      setState(s => {
        s.count = 1;
      });
      action1();
      await Promise.resolve();

      expect(state.count).toBe(1);
      expect(values).toEqual([0, 1]);

      resolve1!();
      await Promise.resolve();
      await Promise.resolve();

      expect(state.count).toBe(0);
      expect(values).toEqual([0, 1, 0]);

      // Second cycle
      let resolve2: () => void;
      const promise2 = new Promise<void>(r => (resolve2 = r));
      const action2 = action(function* () {
        yield promise2;
      });

      setState(s => {
        s.count = 2;
      });
      action2();
      await Promise.resolve();

      expect(state.count).toBe(2);
      expect(values).toEqual([0, 1, 0, 2]);

      resolve2!();
      await Promise.resolve();
      await Promise.resolve();

      expect(state.count).toBe(0);
      expect(values).toEqual([0, 1, 0, 2, 0]);
    });
  });

  describe("rapid successive actions", () => {
    it("should show both optimistic updates when two independent actions are triggered rapidly", async () => {
      const [state1, setState1] = createOptimisticStore({ active: false });
      const [state2, setState2] = createOptimisticStore({ active: false });
      const values1: boolean[] = [];
      const values2: boolean[] = [];

      createRoot(() => {
        createRenderEffect(
          () => state1.active,
          v => {
            values1.push(v);
          }
        );
        createRenderEffect(
          () => state2.active,
          v => {
            values2.push(v);
          }
        );
      });

      flush();
      expect(values1).toEqual([false]);
      expect(values2).toEqual([false]);

      let resolve1: () => void;
      let resolve2: () => void;
      const promise1 = new Promise<void>(r => (resolve1 = r));
      const promise2 = new Promise<void>(r => (resolve2 = r));

      const action1 = action(function* () {
        yield promise1;
      });

      const action2 = action(function* () {
        yield promise2;
      });

      // First optimistic update
      setState1(s => {
        s.active = true;
      });
      action1();
      await Promise.resolve();

      expect(state1.active).toBe(true);
      expect(values1).toEqual([false, true]);

      // Second optimistic update
      setState2(s => {
        s.active = true;
      });
      action2();
      await Promise.resolve();

      expect(state1.active).toBe(true);
      expect(state2.active).toBe(true);
      expect(values2).toEqual([false, true]);

      // Complete first action
      resolve1!();
      await Promise.resolve();
      await Promise.resolve();

      expect(state1.active).toBe(false); // reverted
      expect(state2.active).toBe(true); // still optimistic
      expect(values1).toEqual([false, true, false]);
      expect(values2).toEqual([false, true]);

      // Complete second action
      resolve2!();
      await Promise.resolve();
      await Promise.resolve();

      expect(state2.active).toBe(false);
      expect(values2).toEqual([false, true, false]);
    });

    it("should accumulate rapid successive array pushes", () => {
      const [state, setState] = createOptimisticStore<{ items: number[] }>({ items: [1] });
      const lengths: number[] = [];

      createRoot(() => {
        createRenderEffect(
          () => state.items.length,
          v => {
            lengths.push(v);
          }
        );
      });

      flush();
      expect(lengths).toEqual([1]);

      // Rapid successive pushes - each should see the updated length from previous
      setState(s => {
        s.items.push(2);
      });
      setState(s => {
        s.items.push(3);
      });
      setState(s => {
        s.items.push(4);
      });

      expect(state.items.length).toBe(4);
      expect(state.items[1]).toBe(2);
      expect(state.items[2]).toBe(3);
      expect(state.items[3]).toBe(4);

      // All revert on flush
      flush();
      expect(state.items.length).toBe(1);
      expect(state.items[0]).toBe(1);
    });

    it("should handle rapid successive array deletions via filter on top-level array", () => {
      // Using top-level array store like the Todo demo
      const [state, setState] = createOptimisticStore([
        { id: 1 },
        { id: 2 },
        { id: 3 },
        { id: 4 }
      ] as { id: number }[]);
      const lengths: number[] = [];

      createRoot(() => {
        createRenderEffect(
          () => state.length,
          v => {
            lengths.push(v);
          }
        );
      });

      flush();
      expect(lengths).toEqual([4]);

      // Rapid successive deletions - each filter returns a new array that gets applied
      setState(s => s.filter(item => item.id !== 2));
      expect(state.length).toBe(3);

      setState(s => s.filter(item => item.id !== 4));
      expect(state.length).toBe(2);

      expect([...state].map(i => i.id)).toEqual([1, 3]);

      // All revert on flush
      flush();
      expect(state.length).toBe(4);
      expect([...state].map(i => i.id)).toEqual([1, 2, 3, 4]);
    });

    it("should handle rapid toggles of same property with actions and refresh", async () => {
      // Simulates: TodoApp where user rapidly checks/unchecks same checkbox
      // Each toggle is an action: optimistic set -> yield API -> refresh
      let serverCompleted = false;
      let fetchCount = 0;
      let resolveApi1: () => void;
      let resolveApi2: () => void;
      let resolveFetch: (() => void) | null = null as (() => void) | null;
      const apiPromise1 = new Promise<void>(r => (resolveApi1 = r));
      const apiPromise2 = new Promise<void>(r => (resolveApi2 = r));

      const [todos, setTodos] = createOptimisticStore(
        async () => {
          fetchCount++;
          if (fetchCount === 1) {
            // Initial fetch resolves immediately
            return [{ id: "1", title: "Test", completed: serverCompleted }];
          }
          // Subsequent fetches (from refresh) need manual resolution
          await new Promise<void>(r => (resolveFetch = r));
          return [{ id: "1", title: "Test", completed: serverCompleted }];
        },
        [] as { id: string; title: string; completed: boolean }[],
        { key: "id" }
      );

      const completedValues: (boolean | undefined)[] = [];

      createRoot(() => {
        createRenderEffect(
          () => todos[0]?.completed,
          v => {
            completedValues.push(v);
          }
        );
      });

      flush();

      // Wait for initial async fetch
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(todos.length).toBe(1);
      expect(todos[0].completed).toBe(false);

      // === Toggle 1: check (false -> true) ===
      const toggle1 = action(function* () {
        setTodos(t => {
          const todo = t.find(t => t.id === "1");
          if (todo) todo.completed = true;
        });
        yield apiPromise1;
        serverCompleted = true; // server now has true
        refresh(todos);
      });
      toggle1();
      await Promise.resolve();

      expect(todos[0].completed).toBe(true); // optimistic

      // === Toggle 2: uncheck (true -> false) - before action 1 completes ===
      const toggle2 = action(function* () {
        setTodos(t => {
          const todo = t.find(t => t.id === "1");
          if (todo) todo.completed = false;
        });
        yield apiPromise2;
        serverCompleted = false; // server now has false
        refresh(todos);
      });
      toggle2();
      await Promise.resolve();

      // Optimistic should show the LATEST toggle value (false)
      expect(todos[0].completed).toBe(false);

      // === Action 1 API completes ===
      resolveApi1!();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // Action 1 called refresh(todos), which triggers a new fetch
      // But action 2 is still in progress, so optimistic overlay should persist
      // The checkbox should still show false (from toggle 2's optimistic set)
      expect(todos[0].completed).toBe(false);

      // Resolve the refresh fetch from action 1
      (resolveFetch as (() => void) | null)?.();
      resolveFetch = null;
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // After refresh resolves, overlay should still be active (action 2 pending)
      expect(todos[0].completed).toBe(false);

      // === Action 2 API completes ===
      resolveApi2!();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // Action 2 called refresh(todos), triggers another fetch
      // Resolve it
      (resolveFetch as (() => void) | null)?.();
      resolveFetch = null;
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // Both actions complete - transition ends, overlay clears
      // Server state is completed=false, so final value should be false
      expect(todos[0].completed).toBe(false);
    });

    it("should handle rapid same-tick toggles of same property", async () => {
      // More aggressive: both toggles happen before any flush
      let serverCompleted = false;
      let resolveApi1: () => void;
      let resolveApi2: () => void;
      const apiPromise1 = new Promise<void>(r => (resolveApi1 = r));
      const apiPromise2 = new Promise<void>(r => (resolveApi2 = r));

      const [state, setState] = createOptimisticStore({ completed: false });
      const values: boolean[] = [];

      createRoot(() => {
        createRenderEffect(
          () => state.completed,
          v => {
            values.push(v);
          }
        );
      });

      flush();
      expect(values).toEqual([false]);

      // Toggle 1: false -> true
      const toggle1 = action(function* () {
        setState(s => {
          s.completed = true;
        });
        yield apiPromise1;
      });

      // Toggle 2: true -> false (before toggle 1 flushes)
      const toggle2 = action(function* () {
        setState(s => {
          s.completed = false;
        });
        yield apiPromise2;
      });

      // Both actions start synchronously
      toggle1();
      toggle2();
      await Promise.resolve();

      // Should show the latest optimistic value (false)
      expect(state.completed).toBe(false);

      // Complete action 1 - overlay should persist (action 2 still active)
      resolveApi1!();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(state.completed).toBe(false); // action 2 overlay still active

      // Complete action 2 - both done, overlay clears
      resolveApi2!();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // Reverts to base value (false)
      expect(state.completed).toBe(false);
    });

    it("should handle 3 rapid toggles of same property correctly", async () => {
      // Even more aggressive: 3 toggles (false -> true -> false -> true)
      let resolveApi1: () => void;
      let resolveApi2: () => void;
      let resolveApi3: () => void;
      const apiPromise1 = new Promise<void>(r => (resolveApi1 = r));
      const apiPromise2 = new Promise<void>(r => (resolveApi2 = r));
      const apiPromise3 = new Promise<void>(r => (resolveApi3 = r));

      const [state, setState] = createOptimisticStore({ completed: false });
      const values: boolean[] = [];

      createRoot(() => {
        createRenderEffect(
          () => state.completed,
          v => {
            values.push(v);
          }
        );
      });

      flush();
      expect(values).toEqual([false]);

      // Toggle 1: false -> true
      const t1 = action(function* () {
        setState(s => {
          s.completed = true;
        });
        yield apiPromise1;
      });
      t1();
      await Promise.resolve();

      expect(state.completed).toBe(true);

      // Toggle 2: true -> false
      const t2 = action(function* () {
        setState(s => {
          s.completed = false;
        });
        yield apiPromise2;
      });
      t2();
      await Promise.resolve();

      expect(state.completed).toBe(false);

      // Toggle 3: false -> true
      const t3 = action(function* () {
        setState(s => {
          s.completed = true;
        });
        yield apiPromise3;
      });
      t3();
      await Promise.resolve();

      expect(state.completed).toBe(true);

      // Complete them in order
      resolveApi1!();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // Action 2 and 3 still active, overlay should show true (latest)
      expect(state.completed).toBe(true);

      resolveApi2!();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // Action 3 still active, overlay should show true
      expect(state.completed).toBe(true);

      resolveApi3!();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // All done - reverts to base (false)
      expect(state.completed).toBe(false);
    });

    it("should handle rapid toggles with async source and refresh (full TodoApp pattern)", async () => {
      // Full TodoApp simulation with async projection + action + refresh
      let serverCompleted = false;
      let resolveFetches: (() => void)[] = [];

      const [todos, setTodos] = createOptimisticStore(
        async () => {
          await new Promise<void>(r => resolveFetches.push(r));
          return [{ id: "1", completed: serverCompleted }];
        },
        [] as { id: string; completed: boolean }[],
        { key: "id" }
      );

      const values: (boolean | undefined)[] = [];

      createRoot(() => {
        createRenderEffect(
          () => todos[0]?.completed,
          v => {
            values.push(v);
          }
        );
      });

      flush();

      // Resolve initial fetch
      expect(resolveFetches.length).toBe(1);
      resolveFetches[0]();
      resolveFetches = [];
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(todos.length).toBe(1);
      expect(todos[0].completed).toBe(false);

      // === Rapid toggle pattern ===
      let resolveApi1: () => void;
      let resolveApi2: () => void;
      const apiPromise1 = new Promise<void>(r => (resolveApi1 = r));
      const apiPromise2 = new Promise<void>(r => (resolveApi2 = r));

      // Toggle 1: check (false -> true)
      const toggle1 = action(function* () {
        setTodos(t => {
          const todo = t.find(x => x.id === "1");
          if (todo) todo.completed = true;
        });
        yield apiPromise1;
        serverCompleted = true;
        refresh(todos);
      });
      toggle1();
      await Promise.resolve();

      expect(todos[0].completed).toBe(true); // optimistic

      // Toggle 2: uncheck (true -> false) - rapid, before action 1 completes
      const toggle2 = action(function* () {
        setTodos(t => {
          const todo = t.find(x => x.id === "1");
          if (todo) todo.completed = false;
        });
        yield apiPromise2;
        serverCompleted = false;
        refresh(todos);
      });
      toggle2();
      await Promise.resolve();

      expect(todos[0].completed).toBe(false); // latest optimistic

      // === Action 1 completes, calls refresh ===
      resolveApi1!();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // refresh(todos) triggered a new fetch - resolve it
      expect(resolveFetches.length).toBeGreaterThanOrEqual(1);
      resolveFetches.forEach(r => r());
      resolveFetches = [];
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // Action 2 still pending - overlay should still show false
      expect(todos[0].completed).toBe(false);

      // === Action 2 completes, calls refresh ===
      resolveApi2!();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // resolve refresh fetch
      if (resolveFetches.length) {
        resolveFetches.forEach(r => r());
        resolveFetches = [];
      }
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // Both actions done - server has false, overlay cleared
      expect(todos[0].completed).toBe(false);
    });

    it("should not flicker through previously-committed value on second toggle of async-source optimistic store", async () => {
      // Regression: stashedOptimisticReads was firing on stashed transitions
      // that still had live _asyncReporters, causing render effects to briefly
      // re-render with the previous committed value of the property signal
      // (e.g. the prior toggle's result) before the override settled in.
      //
      // The bug surfaces specifically once the action's generator has fully
      // returned (so `_actions.length === 0`) while `refresh()` inside it
      // kicked a new pending projection fetch (so `_asyncReporters` is
      // populated). The stash branch ran the committed-view rerun even
      // though the transition was still genuinely waiting on async work.
      let serverCompleted = false;
      let resolveFetch: (() => void) | null = null;

      const [todos, setTodos] = createOptimisticStore(
        async () => {
          await new Promise<void>(r => (resolveFetch = r));
          return [{ id: "1", completed: serverCompleted }];
        },
        [] as { id: string; completed: boolean }[],
        { key: "id" }
      );

      const values: (boolean | undefined)[] = [];

      createRoot(() => {
        createRenderEffect(
          () => todos[0]?.completed,
          v => {
            values.push(v);
          }
        );
      });

      flush();
      expect(typeof resolveFetch).toBe("function");
      resolveFetch!();
      resolveFetch = null;
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      flush();

      expect(todos[0].completed).toBe(false);
      expect(values[values.length - 1]).toBe(false);

      // === Toggle 1: false -> true. Drive it all the way through commit so
      // that el._value (the property signal's committed snapshot) ends up
      // holding `true` — the value the second toggle would flicker through.
      let resolveApi1: () => void;
      const apiPromise1 = new Promise<void>(r => (resolveApi1 = r));
      const toggle1 = action(function* () {
        setTodos(t => {
          const todo = t.find(x => x.id === "1");
          if (todo) todo.completed = true;
        });
        yield apiPromise1;
        serverCompleted = true;
        refresh(todos);
      });
      toggle1();
      await Promise.resolve();
      flush();

      expect(todos[0].completed).toBe(true);
      expect(values[values.length - 1]).toBe(true);

      resolveApi1!();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(typeof resolveFetch).toBe("function");
      resolveFetch!();
      resolveFetch = null;
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      flush();

      expect(todos[0].completed).toBe(true);

      // === Toggle 2: true -> false. To trigger the bug we have to reach
      // the state where the action's generator has returned (_actions empty)
      // while a refresh-driven fetch is still pending (_asyncReporters
      // populated). That's the moment stashedOptimisticReads used to fire
      // unconditionally — re-reading el._value (= `true` from toggle 1)
      // inside the render effect.
      let resolveApi2: () => void;
      const apiPromise2 = new Promise<void>(r => (resolveApi2 = r));
      const toggle2 = action(function* () {
        setTodos(t => {
          const todo = t.find(x => x.id === "1");
          if (todo) todo.completed = false;
        });
        yield apiPromise2;
        serverCompleted = false;
        refresh(todos);
      });
      toggle2();
      await Promise.resolve();
      flush();

      expect(todos[0].completed).toBe(false);
      expect(values[values.length - 1]).toBe(false);

      // Mark this point. From here until the new fetch resolves, the
      // render effect must not see `true` (the previous committed value).
      const lengthBeforeApi2Resolve = values.length;

      resolveApi2!();
      // Action generator resumes, calls refresh(todos), returns.
      // Action is now removed from _actions. The refresh-triggered fetch
      // is still pending — _asyncReporters has it.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      flush();
      // The new fetch is pending — resolveFetch is set but not called.
      expect(typeof resolveFetch).toBe("function");

      const valuesDuringStashedTransition = values.slice(lengthBeforeApi2Resolve);
      expect(valuesDuringStashedTransition.every(v => v === false)).toBe(true);
      expect(todos[0].completed).toBe(false);

      // Resolve the fetch and let the transition commit cleanly.
      resolveFetch!();
      resolveFetch = null;
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      flush();

      expect(todos[0].completed).toBe(false);
      expect(values[values.length - 1]).toBe(false);
    });

    it("should handle toggles with flush between them (separate event loops)", async () => {
      // Simulates: user clicks, flush runs, then clicks again later
      let resolveApi1: () => void;
      let resolveApi2: () => void;
      const apiPromise1 = new Promise<void>(r => (resolveApi1 = r));
      const apiPromise2 = new Promise<void>(r => (resolveApi2 = r));

      const [state, setState] = createOptimisticStore({ completed: false });
      const values: boolean[] = [];

      createRoot(() => {
        createRenderEffect(
          () => state.completed,
          v => {
            values.push(v);
          }
        );
      });

      flush();
      expect(state.completed).toBe(false);
      expect(values).toEqual([false]);

      // Toggle 1: false -> true (action starts, flushes)
      const toggle1 = action(function* () {
        setState(s => {
          s.completed = true;
        });
        yield apiPromise1;
      });
      toggle1();
      // Let the microtask queue drain - the action has yielded
      await Promise.resolve();
      await Promise.resolve();

      expect(state.completed).toBe(true);
      expect(values).toEqual([false, true]);

      // Now toggle 2: true -> false (separate event, after first flush)
      const toggle2 = action(function* () {
        setState(s => {
          s.completed = false;
        });
        yield apiPromise2;
      });
      toggle2();
      await Promise.resolve();
      await Promise.resolve();

      // The read shows the correct value
      expect(state.completed).toBe(false);
      // The render effect should have also been notified
      expect(values).toEqual([false, true, false]);

      // Complete action 1 - overlay should persist since action 2 is still pending
      resolveApi1!();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(state.completed).toBe(false); // action 2 still active
      // The value array should NOT have flipped back to true
      const lastValue = values[values.length - 1];
      expect(lastValue).toBe(false);

      // Complete action 2
      resolveApi2!();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // Both done - reverts to base (false)
      expect(state.completed).toBe(false);
    });
  });

  describe("async projection data persistence", () => {
    it("should persist async fetched data in base layer not optimistic layer", async () => {
      let fetchCount = 0;
      const mockFetch = async () => {
        fetchCount++;
        await Promise.resolve();
        return [
          { id: 1, name: "Item 1" },
          { id: 2, name: "Item 2" }
        ];
      };

      const [state] = createOptimisticStore(
        async () => {
          return await mockFetch();
        },
        [] as { id: number; name: string }[]
      );

      createRoot(() => {
        createRenderEffect(
          () => state.length,
          () => {}
        );
      });

      flush();
      expect(() => state.length).toThrow(); // Unresolved async throws outside reactive scope

      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(state.length).toBe(2);
      expect(state[0].name).toBe("Item 1");
      expect(state[1].name).toBe("Item 2");
      expect(fetchCount).toBe(1);

      // Data should persist after flush (it's not optimistic, it's the base data)
      flush();
      expect(state.length).toBe(2);
      expect(state[0].name).toBe("Item 1");
    });

    it("commits returned nested arrays read only through mapArray", async () => {
      type Item = { id: number; title: string };
      let state!: Refreshable<{ items: Item[] }>;
      let mapped!: () => string[];
      let resolveItems!: (items: { items: Item[] }) => void;

      createRoot(() => {
        [state] = createOptimisticStore(
          () =>
            new Promise<{ items: Item[] }>(resolve => {
              resolveItems = resolve;
            }),
          { items: [] }
        );
        mapped = mapArray(
          () => state.items,
          item => item.title
        );
        createRenderEffect(
          () => mapped(),
          () => {}
        );
      });

      flush();
      resolveItems({ items: [{ id: 1, title: "Item 1" }] });
      await Promise.resolve();
      await Promise.resolve();
      flush();

      expect(mapped()).toEqual(["Item 1"]);
    });
  });

  describe("memo depending on optimistic store", () => {
    it("should propagate optimistic changes through memo chain", async () => {
      const [state, setState] = createOptimisticStore({ x: 1 });
      const $a = createMemo(() => state.x + 1);
      const $b = createMemo(() => $a() * 2);
      const values: number[] = [];

      createRoot(() => {
        createRenderEffect(
          () => $b(),
          v => {
            values.push(v);
          }
        );
      });

      flush();
      expect(values).toEqual([4]); // (1+1)*2 = 4

      const doAsync = action(function* () {
        setState(s => {
          s.x = 10;
        });
        yield Promise.resolve();
      });

      doAsync();
      flush();
      expect($b()).toBe(22); // (10+1)*2 = 22
      expect(values).toEqual([4, 22]);

      await Promise.resolve();
      expect($b()).toBe(4); // reverts
      expect(values).toEqual([4, 22, 4]);
    });
  });

  describe("reading outside reactive context", () => {
    it("should show optimistic value when read outside reactive context", async () => {
      const [state, setState] = createOptimisticStore({ value: 1 });

      const doAsync = action(function* () {
        setState(s => {
          s.value = 100;
        });
        expect(state.value).toBe(100);
        yield Promise.resolve();
      });

      doAsync();
      expect(state.value).toBe(100);

      await Promise.resolve();
      expect(state.value).toBe(1);
    });
  });

  describe("property deletion", () => {
    it("should handle property deletion and revert", async () => {
      const [state, setState] = createOptimisticStore<{ a: number; b?: number }>({
        a: 1,
        b: 2
      });

      const doAsync = action(function* () {
        setState(s => {
          delete s.b;
        });
        yield Promise.resolve();
      });

      doAsync();
      flush();
      expect(state.b).toBeUndefined();
      expect("b" in state).toBe(false);

      await Promise.resolve();
      expect(state.b).toBe(2);
      expect("b" in state).toBe(true);
    });
  });

  // #2850: snapshot()/deep() must agree with every other reader — an active
  // optimistic overlay is THE value (A17), and snapshot's documented behavior
  // on regular stores is to read the pending-write overlay synchronously. The
  // optimistic overlay is the same concept under a different key.
  describe("snapshot and deep see optimistic writes (#2850)", () => {
    it("snapshot sees an optimistic write immediately", () => {
      const [state, setState] = createOptimisticStore({ name: "John" });
      setState(s => {
        s.name = "Jake";
      });
      expect(state.name).toBe("Jake");
      expect(snapshot(state).name).toBe("Jake");
    });

    it("snapshot shows the overlay during a transition and the committed value after revert", async () => {
      const [state, setState] = createOptimisticStore({ count: 0, label: "a" });

      const doAsync = action(function* () {
        setState(s => {
          s.count = 1;
        });
        yield Promise.resolve();
      });

      doAsync();
      flush();
      const during = snapshot(state);
      expect(during).toEqual({ count: 1, label: "a" });
      // Overlay present: snapshot allocates a fresh plain object, like a
      // regular store with pending writes.
      expect(during).not.toBe(snapshot(state));

      await Promise.resolve();
      expect(snapshot(state)).toEqual({ count: 0, label: "a" });
    });

    it("snapshot sees nested writes, array mutations, and deletes through the overlay", async () => {
      const [state, setState] = createOptimisticStore<{
        user: { name: string; tmp?: number };
        todos: { id: number; text: string }[];
      }>({
        user: { name: "John", tmp: 1 },
        todos: [{ id: 1, text: "one" }]
      });

      const doAsync = action(function* () {
        setState(s => {
          s.user.name = "Jake";
          delete s.user.tmp;
          s.todos.push({ id: 2, text: "two" });
        });
        yield Promise.resolve();
      });

      doAsync();
      flush();
      const snap = snapshot(state);
      expect(snap.user).toEqual({ name: "Jake" });
      expect("tmp" in snap.user).toBe(false);
      expect(snap.todos).toEqual([
        { id: 1, text: "one" },
        { id: 2, text: "two" }
      ]);

      await Promise.resolve();
      expect(snapshot(state)).toEqual({
        user: { name: "John", tmp: 1 },
        todos: [{ id: 1, text: "one" }]
      });
    });

    it("deep() in a render effect re-runs on the optimistic write and again on revert", async () => {
      const [state, setState] = createOptimisticStore({ count: 0 });
      const values: number[] = [];

      createRoot(() => {
        createRenderEffect(
          () => deep(state),
          v => {
            values.push(v.count);
          }
        );
      });
      flush();
      expect(values).toEqual([0]);

      const doAsync = action(function* () {
        setState(s => {
          s.count = 1;
        });
        yield Promise.resolve();
      });

      doAsync();
      flush();
      expect(values).toEqual([0, 1]);

      await Promise.resolve();
      expect(values).toEqual([0, 1, 0]);
    });
  });

  describe("isPending and latest() with async optimistic store", () => {
    it("async store re-runs on dependency change", async () => {
      const [$id, setId] = createSignal(1);
      let state: { data: number };

      createRoot(() => {
        [state] = createOptimisticStore(
          async (s: { data: number }) => {
            const id = $id();
            await Promise.resolve();
            s.data = id * 10;
          },
          { data: 0 }
        );

        // Effect to create transition
        createRenderEffect(
          () => state.data,
          () => {}
        );
      });

      // Initial load - need flush to trigger first async run
      flush();
      await new Promise(r => setTimeout(r, 0));
      expect(state!.data).toBe(10);

      // Change dependency - should trigger re-run
      setId(2);
      flush();
      await new Promise(r => setTimeout(r, 0));
      expect(state!.data).toBe(20);
    });

    it("isPending and latest() during async with optimistic write", async () => {
      const [$id, setId] = createSignal(1);
      let state: { data: number };
      let setState: (fn: (s: { data: number }) => void) => void;

      createRoot(() => {
        [state, setState] = createOptimisticStore(
          async (s: { data: number }) => {
            const id = $id();
            await Promise.resolve();
            s.data = id * 10;
          },
          { data: 0 }
        );

        createRenderEffect(
          () => state.data,
          () => {}
        );
      });

      // Initial load - need flush to trigger first async run
      flush();
      await new Promise(r => setTimeout(r, 0));
      expect(state!.data).toBe(10);
      expect(isPending(() => state!.data)).toBe(false);

      // Contrast: a pure source change with no optimistic write — the refetch
      // pends the store. This is what proves the probe is live, so the mask
      // assertions below can't pass vacuously.
      setId(2);
      flush();
      expect(state!.data).toBe(10);
      expect(isPending(() => state!.data)).toBe(true);

      // Optimistic write MID-refetch: verdict-inert (re-ruled 2026-07-13,
      // supersedes the A20 mask). The override displays, but id=2 is a new
      // question still in flight — the slot keeps reading pending through it.
      setState!(s => {
        s.data = 999;
      });
      flush();
      expect(state!.data).toBe(999);
      expect(isPending(() => state!.data)).toBe(true);
      // latest() returns the optimistic value
      expect(latest(() => state!.data)).toBe(999);

      // Fetch lands: server value wins, override reverts, still settled.
      await new Promise(r => setTimeout(r, 0));
      expect(state!.data).toBe(20);
      expect(isPending(() => state!.data)).toBe(false);
    });

    // Optimistic writes are verdict-inert (re-ruled 2026-07-13, supersedes
    // the mask): neither effective writes nor trap-fire no-ops (`s => s`,
    // `s => ({ ...s })`, same-value writes, deletes of absent properties)
    // can silence an in-flight question. No-ops additionally must not
    // entangle the store with the surrounding transaction.
    describe("optimistic writes never silence an in-flight refetch", () => {
      async function setup() {
        const [$id, setId] = createSignal(1);
        let state!: { data: number };
        let setState!: (fn: (s: { data: number }) => any) => void;

        createRoot(() => {
          [state, setState] = createOptimisticStore(
            async (s: { data: number }) => {
              const id = $id();
              await Promise.resolve();
              s.data = id * 10;
            },
            { data: 0 }
          );
          createRenderEffect(
            () => state.data,
            () => {}
          );
        });

        flush();
        await new Promise(r => setTimeout(r, 0));
        expect(state.data).toBe(10);

        // Refetch in flight: the leaf pends (live-probe baseline).
        setId(2);
        flush();
        expect(isPending(() => state.data)).toBe(true);

        return { state, setState };
      }

      async function finish(state: { data: number }) {
        await new Promise(r => setTimeout(r, 0));
        expect(state.data).toBe(20);
        expect(isPending(() => state.data)).toBe(false);
      }

      it("pure no-op setter (s => s) leaves the refetch pending", async () => {
        const { state, setState } = await setup();
        setState(s => s);
        expect(isPending(() => state.data)).toBe(true); // not masked pre-flush either
        flush();
        expect(isPending(() => state.data)).toBe(true);
        await finish(state);
      });

      it("same-value property write leaves the refetch pending", async () => {
        const { state, setState } = await setup();
        setState(s => {
          s.data = s.data;
        });
        expect(isPending(() => state.data)).toBe(true);
        flush();
        expect(isPending(() => state.data)).toBe(true);
        await finish(state);
      });

      it("returned shallow copy leaves the refetch pending", async () => {
        const { state, setState } = await setup();
        setState(s => ({ ...s }));
        expect(isPending(() => state.data)).toBe(true);
        flush();
        expect(isPending(() => state.data)).toBe(true);
        await finish(state);
      });

      it("delete of an absent property leaves the refetch pending", async () => {
        const { state, setState } = await setup();
        setState(s => {
          delete (s as any).missing;
        });
        expect(isPending(() => state.data)).toBe(true);
        flush();
        expect(isPending(() => state.data)).toBe(true);
        await finish(state);
      });

      it("a real write mid-refetch displays but stays pending", async () => {
        const { state, setState } = await setup();
        setState(s => {
          s.data = 999;
        });
        flush();
        expect(state.data).toBe(999);
        expect(isPending(() => state.data)).toBe(true);
        await finish(state);
      });
    });

    it("isPending preserves async optimistic store overrides", async () => {
      const [$id, setId] = createSignal(1);
      let state: { data: number };
      let setState: (fn: (s: { data: number }) => void) => void;
      const values: { data: number; pending: boolean }[] = [];

      createRoot(() => {
        [state, setState] = createOptimisticStore(
          async (s: { data: number }) => {
            const id = $id();
            await Promise.resolve();
            s.data = id * 10;
          },
          { data: 0 }
        );

        createRenderEffect(
          () => ({ data: state.data, pending: isPending(() => state.data) }),
          value => {
            values.push(value);
          }
        );
      });

      flush();
      await new Promise(r => setTimeout(r, 0));
      expect(state!.data).toBe(10);
      expect(values.at(-1)).toEqual({ data: 10, pending: false });

      // Contrast: the bare refetch pends the leaf — the effect observes the
      // true verdict, proving the pending channel is wired.
      setId(2);
      flush();
      expect(values.at(-1)).toEqual({ data: 10, pending: true });

      // The optimistic write mid-refetch displays but is verdict-inert
      // (re-ruled 2026-07-13): the honest mixed state {999, pending} forms —
      // the guess shows while the new question's answer is still in flight.
      setState!(s => {
        s.data = 999;
      });
      flush();

      expect(state!.data).toBe(999);
      expect(values.at(-1)).toEqual({ data: 999, pending: true });

      // The fetch lands: server value wins, override reverts, verdict clears.
      await new Promise(r => setTimeout(r, 0));
      expect(state!.data).toBe(20);
      expect(values.at(-1)).toEqual({ data: 20, pending: false });
    });

    it("a plain optimistic store is never pending — no source can supersede it, and writes are decreed", async () => {
      let state: { count: number };
      let setState: (fn: (s: { count: number }) => void) => void;
      let resolveAction!: () => void;
      let increment!: () => Promise<void>;
      const pendingValues: boolean[] = [];

      createRoot(() => {
        [state, setState] = createOptimisticStore({ count: 0 });

        createRenderEffect(
          () => isPending(() => deep(state)),
          value => {
            pendingValues.push(value);
          }
        );

        increment = action(function* () {
          setState(s => {
            s.count++;
          });
          yield new Promise<void>(resolve => {
            resolveAction = resolve;
          });
        });
      });

      flush();
      expect(pendingValues.at(-1)).toBe(false);

      const actionPromise = increment();
      flush();

      expect(state!.count).toBe(1);
      // No question is in flight: the optimistic write alone never pends.
      expect(pendingValues.at(-1)).toBe(false);

      resolveAction();
      await actionPromise;
      await Promise.resolve();
      flush();

      expect(state!.count).toBe(0);
      expect(pendingValues.at(-1)).toBe(false);
    });

    it("deep reads stay settled from optimistic write through the sync-back refresh (quiet re-ask)", async () => {
      let state: Refreshable<{ count: number }>;
      let setState: (fn: (s: { count: number }) => void) => void;
      let save!: () => Promise<void>;
      let resolveAction!: () => void;
      const pendingValues: boolean[] = [];

      createRoot(() => {
        [state, setState] = createOptimisticStore(async () => ({ count: 0 }), { count: 0 });

        createRenderEffect(
          () => isPending(() => deep(state)),
          value => {
            pendingValues.push(value);
          }
        );

        save = action(function* () {
          setState(s => {
            s.count++;
          });
          yield new Promise<void>(resolve => {
            resolveAction = resolve;
          });
          refresh(state);
        });
      });

      flush();
      await Promise.resolve();
      await Promise.resolve();
      flush();
      expect(pendingValues.at(-1)).toBe(false);

      const actionPromise = save();
      flush();

      expect(state!.count).toBe(1);
      // No upstream question is in flight: the write alone never pends its
      // own slots, and the sync-back refresh is a quiet re-ask.
      expect(pendingValues.at(-1)).toBe(false);

      resolveAction();
      await actionPromise;
      await Promise.resolve();
      await Promise.resolve();
      flush();

      expect(pendingValues.at(-1)).toBe(false);

      // Contrast (proves the deep probe is live): a bare refresh is a quiet
      // re-ask (never pending), so the declared form pends the same read —
      // affects(state) announces the reload — then clears when data lands.
      refresh(state!);
      flush();
      expect(pendingValues.at(-1)).toBe(false);
      await Promise.resolve();
      await Promise.resolve();
      flush();
      expect(pendingValues.at(-1)).toBe(false);

      affects(state!);
      refresh(state!);
      flush();
      expect(pendingValues.at(-1)).toBe(true);
      await Promise.resolve();
      await Promise.resolve();
      flush();
      expect(pendingValues.at(-1)).toBe(false);
    });

    it("deep nested reads stay settled during an optimistic transaction (verdict-inert writes)", async () => {
      let state: Refreshable<{ items: { name: string }[] }>;
      let setState: (fn: (s: { items: { name: string }[] }) => void) => void;
      let save!: () => Promise<void>;
      let resolveAction!: () => void;
      const pendingValues: boolean[] = [];

      createRoot(() => {
        [state, setState] = createOptimisticStore(async () => ({ items: [{ name: "Initial" }] }), {
          items: [{ name: "Initial" }]
        });

        createRenderEffect(
          () => isPending(() => deep(state)),
          value => {
            pendingValues.push(value);
          }
        );

        save = action(function* () {
          setState(s => {
            s.items[0].name = "Modified";
          });
          expect(isPending(() => deep(state))).toBe(false); // no question in flight
          yield new Promise<void>(resolve => {
            resolveAction = resolve;
          });
        });
      });

      flush();
      await Promise.resolve();
      await Promise.resolve();
      flush();
      expect(pendingValues.at(-1)).toBe(false);

      const actionPromise = save();
      flush();

      expect(state!.items[0].name).toBe("Modified");
      expect(pendingValues.at(-1)).toBe(false); // no question in flight

      resolveAction();
      await actionPromise;
      await Promise.resolve();
      flush();

      expect(pendingValues.at(-1)).toBe(false);

      // Contrast (probe liveness): a bare refresh is a quiet re-ask; the
      // declared reload (affects + refresh) pends the same deep read.
      affects(state!);
      refresh(state!);
      flush();
      expect(pendingValues.at(-1)).toBe(true);
      await Promise.resolve();
      await Promise.resolve();
      flush();
      expect(pendingValues.at(-1)).toBe(false);
    });

    it("deep reads from a nested proxy stay settled during an optimistic transaction (verdict-inert writes)", async () => {
      let state: Refreshable<{ items: { name: string }[] }>;
      let setState: (fn: (s: { items: { name: string }[] }) => void) => void;
      let save!: () => Promise<void>;
      let resolveAction!: () => void;
      const pendingValues: boolean[] = [];

      createRoot(() => {
        [state, setState] = createOptimisticStore(async () => ({ items: [{ name: "Initial" }] }), {
          items: [{ name: "Initial" }]
        });

        createRenderEffect(
          () => isPending(() => deep(state.items)),
          value => {
            pendingValues.push(value);
          }
        );

        save = action(function* () {
          setState(s => {
            s.items[0].name = "Modified";
          });
          expect(isPending(() => deep(state.items))).toBe(false); // no question in flight
          yield new Promise<void>(resolve => {
            resolveAction = resolve;
          });
        });
      });

      flush();
      await Promise.resolve();
      await Promise.resolve();
      flush();
      expect(pendingValues.at(-1)).toBe(false);

      const actionPromise = save();
      flush();

      expect(state!.items[0].name).toBe("Modified");
      expect(pendingValues.at(-1)).toBe(false); // no question in flight

      resolveAction();
      await actionPromise;
      await Promise.resolve();
      flush();

      expect(pendingValues.at(-1)).toBe(false);

      // Contrast: the declared reload (affects + refresh) pends the
      // nested-proxy deep read — a bare refresh alone is a quiet re-ask.
      affects(state!);
      refresh(state!);
      flush();
      expect(pendingValues.at(-1)).toBe(true);
      await Promise.resolve();
      await Promise.resolve();
      flush();
      expect(pendingValues.at(-1)).toBe(false);
    });

    it("deep reads stay settled through write → refresh → fresh data landing (quiet sync-back)", async () => {
      let serverCount = 0;
      const fetches: Array<() => void> = [];
      let state: Refreshable<{ count: number }>;
      let setState: (fn: (s: { count: number }) => void) => void;
      let save!: () => Promise<void>;
      let resolveAction!: () => void;
      const pendingValues: boolean[] = [];

      createRoot(() => {
        [state, setState] = createOptimisticStore(
          () =>
            new Promise<{ count: number }>(resolve => {
              fetches.push(() => resolve({ count: serverCount }));
            }),
          { count: 0 }
        );

        createRenderEffect(
          () => isPending(() => deep(state)),
          value => {
            pendingValues.push(value);
          }
        );

        save = action(function* () {
          setState(s => {
            s.count = 1;
          });
          yield new Promise<void>(resolve => {
            resolveAction = resolve;
          });
          serverCount = 2;
          refresh(state);
        });
      });

      flush();
      fetches.shift()!();
      await Promise.resolve();
      await Promise.resolve();
      flush();
      expect(pendingValues.at(-1)).toBe(false);

      const actionPromise = save();
      flush();

      expect(state!.count).toBe(1);
      expect(pendingValues.at(-1)).toBe(false); // no question in flight

      resolveAction();
      await actionPromise;
      await Promise.resolve();
      flush();
      // The refresh's fetch is in flight, but no tracked input changed value:
      // the sync-back is a quiet re-ask of the same question — not pending.
      expect(pendingValues.at(-1)).toBe(false);

      fetches.shift()!();
      await Promise.resolve();
      await Promise.resolve();
      flush();

      expect(state!.count).toBe(2);
      expect(pendingValues.at(-1)).toBe(false);

      // Contrast (probe liveness): the DECLARED reload pends the deep read —
      // the quiet above came from the re-ask rule, not a dead probe.
      serverCount = 3;
      affects(state!);
      refresh(state!);
      flush();
      expect(pendingValues.at(-1)).toBe(true);
      fetches.shift()!();
      await Promise.resolve();
      await Promise.resolve();
      flush();
      expect(state!.count).toBe(3);
      expect(pendingValues.at(-1)).toBe(false);
    });

    it("generator-backed optimistic store reads settled while an override is visible", async () => {
      let state: { data: number };
      let setState: (fn: (s: { data: number }) => void) => void;
      let resolveAsync!: () => void;
      let resolveAction!: () => void;
      let holdOptimistic!: () => void;

      createRoot(() => {
        [state, setState] = createOptimisticStore(
          async function* (s: { data: number }) {
            s.data = 10;
            yield;
            await new Promise<void>(r => (resolveAsync = r));
            s.data = 20;
            yield;
          },
          { data: 0 }
        );

        createRenderEffect(
          () => state.data,
          () => {}
        );

        holdOptimistic = action(function* () {
          setState(s => {
            s.data = 999;
          });
          yield new Promise<void>(r => (resolveAction = r));
        });
      });

      flush();
      await Promise.resolve();
      await Promise.resolve();

      expect(state!.data).toBe(10);
      expect(isPending(() => state!.data)).toBe(false);

      holdOptimistic();
      flush();

      expect(state!.data).toBe(999);
      // A streaming continuation past the first yield is not a pending
      // window, and the write alone never pends: settled.
      expect(isPending(() => state!.data)).toBe(false);

      resolveAsync();
      resolveAction();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(state!.data).toBe(20);
      expect(isPending(() => state!.data)).toBe(false);
    });

    it("same-render length + verdict read stays settled during an optimistic push", async () => {
      let state: readonly number[];
      let setState: (fn: (s: number[]) => void) => void;
      let resolveAction!: () => void;
      let holdOptimistic!: () => Promise<void>;
      let resolveFetch!: () => void;
      const seen: Array<readonly [number, boolean]> = [];

      createRoot(() => {
        [state, setState] = createOptimisticStore<number[]>(async function* () {
          await new Promise<void>(r => (resolveFetch = r));
          yield [];
        }, []);

        createRenderEffect(
          () => [state.length, isPending(() => state.length)] as const,
          v => {
            seen.push(v);
          }
        );

        holdOptimistic = action(function* () {
          setState(draft => {
            draft.push(0);
          });
          yield new Promise<void>(r => (resolveAction = r));
        });
      });

      flush();
      resolveFetch();
      await new Promise(r => setTimeout(r, 0));
      flush();

      expect(seen.at(-1)).toEqual([0, false]);

      const actionPromise = holdOptimistic();
      flush();

      expect(seen.at(-1)).toEqual([1, false]); // no question in flight

      resolveAction();
      await actionPromise;
      await Promise.resolve();
      flush();

      expect(seen.at(-1)).toEqual([0, false]);

      // Contrast: a declared reload (affects + refresh) pends the same
      // same-render length read — the re-ask rule, not a dead probe, kept it
      // quiet above.
      affects(state!);
      refresh(state! as Refreshable<readonly number[]>);
      flush();
      expect(seen.at(-1)).toEqual([0, true]);
      resolveFetch();
      await new Promise(r => setTimeout(r, 0));
      flush();
      expect(seen.at(-1)).toEqual([0, false]);
    });

    it("separate-render length and verdict reads stay settled during an optimistic push", async () => {
      let state: readonly number[];
      let setState: (fn: (s: number[]) => void) => void;
      let resolveAction!: () => void;
      let holdOptimistic!: () => Promise<void>;
      let resolveFetch!: () => void;
      const lengths: number[] = [];
      const pendingStates: boolean[] = [];

      createRoot(() => {
        [state, setState] = createOptimisticStore<number[]>(async function* () {
          await new Promise<void>(r => (resolveFetch = r));
          yield [];
        }, []);

        createRenderEffect(
          () => state.length,
          v => {
            lengths.push(v);
          }
        );

        createRenderEffect(
          () => isPending(() => state.length),
          v => {
            pendingStates.push(v);
          }
        );

        holdOptimistic = action(function* () {
          setState(draft => {
            draft.push(0);
          });
          yield new Promise<void>(r => (resolveAction = r));
        });
      });

      flush();
      resolveFetch();
      await new Promise(r => setTimeout(r, 0));
      flush();

      expect(lengths.at(-1)).toBe(0);
      expect(pendingStates.at(-1)).toBe(false);

      const actionPromise = holdOptimistic();
      flush();

      expect(lengths.at(-1)).toBe(1);
      expect(pendingStates.at(-1)).toBe(false); // no question in flight

      resolveAction();
      await actionPromise;
      await Promise.resolve();
      flush();

      expect(lengths.at(-1)).toBe(0);
      expect(pendingStates.at(-1)).toBe(false);

      // Contrast: a declared reload pends the separate-render verdict effect.
      affects(state!);
      refresh(state! as Refreshable<readonly number[]>);
      flush();
      expect(pendingStates.at(-1)).toBe(true);
      resolveFetch();
      await new Promise(r => setTimeout(r, 0));
      flush();
      expect(pendingStates.at(-1)).toBe(false);
      expect(lengths.at(-1)).toBe(0);
    });

    it("override on top of an async projection reads settled throughout", async () => {
      let resolveProjection!: () => void;
      let resolveAction!: () => void;
      let state: { data: number };
      let setState: (fn: (s: { data: number }) => void) => void;
      let holdOptimistic!: () => void;

      createRoot(() => {
        const projection = createProjection(
          async function* (draft: { data: number }) {
            draft.data = 10;
            yield;
            await new Promise<void>(r => (resolveProjection = r));
            draft.data = 20;
            yield;
          },
          { data: 0 }
        );

        [state, setState] = createOptimisticStore(projection);

        createRenderEffect(
          () => state.data,
          () => {}
        );

        holdOptimistic = action(function* () {
          setState(s => {
            s.data = 999;
          });
          yield new Promise<void>(r => (resolveAction = r));
        });
      });

      flush();
      await Promise.resolve();
      await Promise.resolve();

      expect(state!.data).toBe(10);
      expect(isPending(() => state!.data)).toBe(false);

      holdOptimistic();
      flush();

      expect(state!.data).toBe(999);
      // The projection's streaming continuation is not a pending window, and
      // the write alone never pends: settled.
      expect(isPending(() => state!.data)).toBe(false);

      resolveProjection();
      resolveAction();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(state!.data).toBe(20);
      expect(isPending(() => state!.data)).toBe(false);
    });

    it("should preserve array item proxy identity when optimistic push is reconciled with server data", async () => {
      // Simulates: user adds a Todo, the item should not be recreated when the
      // transition commits and server data replaces the optimistic data.
      // Regression: reconcile was blind to STORE_OPTIMISTIC_OVERRIDE, so prevLength
      // was 0 and key-based matching was skipped, causing new proxy references.
      type Todo = { id: string; title: string };
      let serverTodos: Todo[] = [];
      let resolveFetches: (() => void)[] = [];

      const [todos, setTodos] = createOptimisticStore(
        async () => {
          await new Promise<void>(r => resolveFetches.push(r));
          return serverTodos.slice(); // return a copy so references differ
        },
        [] as Todo[],
        { key: "id" }
      );

      let trackedRef: any;
      const createCount = { value: 0 };

      createRoot(() => {
        createRenderEffect(
          () => (todos.length > 0 ? untrack(() => todos[0]) : undefined),
          current => {
            // Track when item 0 changes identity — simulates what For does
            if (current !== undefined) {
              if (trackedRef === undefined) {
                trackedRef = current;
                createCount.value++;
              } else if (current !== trackedRef) {
                trackedRef = current;
                createCount.value++;
              }
            }
          }
        );
      });

      flush();

      // Resolve initial fetch (empty)
      expect(resolveFetches.length).toBe(1);
      resolveFetches[0]();
      resolveFetches = [];
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(todos.length).toBe(0);
      expect(createCount.value).toBe(0);

      // === Add a todo via action ===
      let resolveApi: () => void;
      const apiPromise = new Promise<void>(r => (resolveApi = r));
      const newTodo = { id: "abc", title: "Test Todo" };

      const addTodo = action(function* () {
        setTodos(t => {
          t.push(newTodo);
        });
        yield apiPromise;
        serverTodos = [{ id: "abc", title: "Test Todo" }]; // server now has it
        refresh(todos);
      });

      addTodo();
      await Promise.resolve();

      // Optimistic: item visible immediately
      expect(todos.length).toBe(1);
      expect(todos[0].title).toBe("Test Todo");

      flush();
      expect(createCount.value).toBe(1); // created once

      // Capture the proxy reference
      const optimisticRef = todos[0];

      // === API completes, refresh triggers re-fetch ===
      resolveApi!();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // Resolve the refresh fetch (server returns the same todo)
      expect(resolveFetches.length).toBeGreaterThanOrEqual(1);
      resolveFetches.forEach(r => r());
      resolveFetches = [];
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // After transition commits: item should still be there
      expect(todos.length).toBe(1);
      expect(todos[0].title).toBe("Test Todo");

      // KEY ASSERTION: proxy identity preserved — same reference, not recreated
      expect(todos[0]).toBe(optimisticRef);
      expect(createCount.value).toBe(1); // still only created once
    });

    it("should preserve proxy identity for multiple optimistic pushes reconciled with server data", async () => {
      // Add two items sequentially, both should preserve identity
      type Todo = { id: string; title: string };
      let serverTodos: Todo[] = [];
      let resolveFetches: (() => void)[] = [];

      const [todos, setTodos] = createOptimisticStore(
        async () => {
          await new Promise<void>(r => resolveFetches.push(r));
          return serverTodos.slice();
        },
        [] as Todo[],
        { key: "id" }
      );

      createRoot(() => {
        createRenderEffect(
          () => todos.length,
          () => {}
        );
      });

      flush();

      // Resolve initial fetch
      resolveFetches[0]();
      resolveFetches = [];
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(todos.length).toBe(0);

      // === Add first todo ===
      let resolveApi1: () => void;
      const apiPromise1 = new Promise<void>(r => (resolveApi1 = r));

      const add1 = action(function* () {
        setTodos(t => {
          t.push({ id: "1", title: "First" });
        });
        yield apiPromise1;
        serverTodos = [{ id: "1", title: "First" }];
        refresh(todos);
      });

      add1();
      await Promise.resolve();

      expect(todos.length).toBe(1);
      flush();
      const ref1 = todos[0];

      // Complete first action
      resolveApi1!();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      resolveFetches.forEach(r => r());
      resolveFetches = [];
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(todos.length).toBe(1);
      expect(todos[0]).toBe(ref1); // identity preserved

      // === Add second todo ===
      let resolveApi2: () => void;
      const apiPromise2 = new Promise<void>(r => (resolveApi2 = r));

      const add2 = action(function* () {
        setTodos(t => {
          t.push({ id: "2", title: "Second" });
        });
        yield apiPromise2;
        serverTodos = [
          { id: "1", title: "First" },
          { id: "2", title: "Second" }
        ];
        refresh(todos);
      });

      add2();
      await Promise.resolve();

      expect(todos.length).toBe(2);
      flush();
      const ref2 = todos[1];

      // Complete second action
      resolveApi2!();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      resolveFetches.forEach(r => r());
      resolveFetches = [];
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(todos.length).toBe(2);
      expect(todos[0]).toBe(ref1); // first item identity still preserved
      expect(todos[1]).toBe(ref2); // second item identity preserved
    });

    it("does not pass undefined rows to mapArray during optimistic add and source change", async () => {
      type Comment = { id: number; text: string };
      let commentId = 0;
      const serverComments = Array.from({ length: 3 }, () => [
        { id: commentId, text: `Comment ${commentId++}` },
        { id: commentId, text: `Comment ${commentId++}` },
        { id: commentId, text: `Comment ${commentId++}` }
      ]);
      const fetches: Array<{ issueId: number; resolve: () => void }> = [];
      const adds: Array<{ issueId: number; text: string; resolve: () => void }> = [];
      let issue!: () => number;
      let setIssue!: (fn: (issue: number) => number) => void;
      let comments!: Refreshable<readonly Comment[]>;
      let setComments!: (fn: (comments: Comment[]) => void) => void;
      let addComment!: (issueId: number, text: string) => Promise<void>;
      let mapped!: () => string[];
      const rendered: string[][] = [];

      const settle = async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        flush();
      };

      createRoot(dispose => {
        const [issueId, setIssueId] = createSignal(0);
        [comments, setComments] = createOptimisticStore(
          () =>
            new Promise<Comment[]>(resolve => {
              const requestedIssue = issueId();
              fetches.push({
                issueId: requestedIssue,
                resolve: () => resolve(structuredClone(serverComments[requestedIssue]))
              });
            }),
          [] as Comment[]
        );
        issue = issueId;
        setIssue = setIssueId;
        addComment = action(function* (issueId: number, text: string) {
          setComments(draft => {
            draft.push({ id: -1, text });
          });
          yield new Promise<void>(resolve => {
            adds.push({
              issueId,
              text,
              resolve: () => {
                serverComments[issueId].push({ id: commentId++, text });
                resolve();
              }
            });
          });
          refresh(comments);
        });
        mapped = mapArray(
          () => comments,
          comment => comment.text
        );
        createRenderEffect(
          () => mapped(),
          value => {
            rendered.push(value);
          }
        );
        return dispose;
      });

      flush();
      const initialFetch = fetches.shift()!;
      expect(initialFetch).toMatchObject({ issueId: 0 });
      initialFetch.resolve();
      await settle();

      expect(mapped()).toEqual(["Comment 0", "Comment 1", "Comment 2"]);

      const firstAdd = addComment(issue(), "First");
      flush();
      expect(mapped()).toEqual(["Comment 0", "Comment 1", "Comment 2", "First"]);

      adds.shift()!.resolve();
      await settle();
      fetches.shift()!.resolve();
      await firstAdd;
      await settle();

      expect(mapped()).toEqual(["Comment 0", "Comment 1", "Comment 2", "First"]);

      const secondAdd = addComment(issue(), "Second");
      setIssue(id => id + 1);
      flush();

      expect(mapped()).not.toContain(undefined as unknown as string);

      fetches.find(fetch => fetch.issueId === 1)!.resolve();
      await settle();

      // Mid-hold (#3164 fold): secondAdd's transaction retains the
      // optimistic row, so the issue-1 landing stays folded — the view is
      // the old question plus the optimism, and never a torn/undefined row.
      expect(comments.length).toBe(5);
      expect(Array.from(comments).map(comment => comment.text)).toEqual([
        "Comment 0",
        "Comment 1",
        "Comment 2",
        "First",
        "Second"
      ]);
      expect(rendered.at(-1)).not.toContain(undefined as unknown as string);

      adds.shift()!.resolve();
      await secondAdd;
      await settle();
      // The action's trailing refresh holds the transaction open (#2951:
      // overrides live until the store's own truth lands) — land it.
      fetches.at(-1)!.resolve();
      await settle();
      // Settle: the folded issue-1 truth reveals without the dead edit.
      expect(Array.from(comments).map(comment => comment.text)).toEqual([
        "Comment 3",
        "Comment 4",
        "Comment 5"
      ]);
      for (const frame of rendered) expect(frame).not.toContain(undefined as unknown as string);
    });

    // Re-ruled by the #3164 fold: a landing that arrives while an action
    // retains optimistic edits FOLDS into that transaction — the mid-hold
    // view keeps the retained optimism (old question + optimistic row), and
    // the landed truth reveals atomically when the retaining action settles
    // (optimism dies with its transaction, never with a foreign landing).
    it("holds optimistic rows across a separate source landing; the reveal clears them at settle (#2719/#3164)", async () => {
      type Comment = { id: number; text: string };
      const serverComments = [
        [
          { id: 0, text: "Issue 0 A" },
          { id: 1, text: "Issue 0 B" }
        ],
        [
          { id: 2, text: "Issue 1 A" },
          { id: 3, text: "Issue 1 B" }
        ]
      ];
      const fetches: Array<{ issueId: number; resolve: () => void }> = [];
      let setIssue!: (issue: number) => number;
      let comments!: Refreshable<readonly Comment[]>;
      let setComments!: (fn: (comments: Comment[]) => void) => void;
      let addComment!: () => Promise<void>;
      let nextIssue!: () => Promise<void>;
      let resolveAdd!: () => void;
      const rendered: string[][] = [];

      const settle = async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        flush();
      };

      createRoot(dispose => {
        const [issueId, setIssueId] = createSignal(0);
        setIssue = setIssueId;
        [comments, setComments] = createOptimisticStore(
          () =>
            new Promise<Comment[]>(resolve => {
              const requestedIssue = issueId();
              fetches.push({
                issueId: requestedIssue,
                resolve: () => resolve(structuredClone(serverComments[requestedIssue]))
              });
            }),
          [] as Comment[]
        );
        addComment = action(function* () {
          setComments(draft => {
            draft.push({ id: -1, text: "Optimistic" });
          });
          yield new Promise<void>(resolve => {
            resolveAdd = resolve;
          });
        });
        nextIssue = action(function* () {
          setIssue(1);
          const fetch = fetches.find(fetch => fetch.issueId === 1);
          if (fetch) yield new Promise<void>(resolve => queueMicrotask(resolve));
        });
        createRenderEffect(
          () => comments.map(comment => comment.text),
          value => {
            rendered.push(value);
          }
        );
        return dispose;
      });

      flush();
      fetches.shift()!.resolve();
      await settle();

      expect(rendered.at(-1)).toEqual(["Issue 0 A", "Issue 0 B"]);

      const add = addComment();
      flush();
      expect(rendered.at(-1)).toEqual(["Issue 0 A", "Issue 0 B", "Optimistic"]);

      const next = nextIssue();
      flush();
      fetches.find(fetch => fetch.issueId === 1)!.resolve();
      await next;
      await settle();

      // Mid-hold: addComment's transaction retains the optimistic row, so
      // the issue-1 landing stays folded — the view keeps the old question
      // plus the optimism, with no intermediate flash.
      expect(comments.length).toBe(3);
      expect(rendered.at(-1)).toEqual(["Issue 0 A", "Issue 0 B", "Optimistic"]);

      resolveAdd();
      await add;
      await settle();
      // Settle: the override reverts and the folded truth reveals in one
      // frame — the optimistic row is gone, the new question is visible.
      expect(comments.length).toBe(2);
      expect(rendered.at(-1)).toEqual(["Issue 1 A", "Issue 1 B"]);
    });

    // RUL-2 as re-ruled by the #3164 fold: landings never consume optimism.
    // While a transaction retains optimistic edits, every landing — equal
    // poll or contradicting truth alike — folds into that transaction and
    // reveals atomically at settle. Optimistic edits live exactly as long
    // as their transaction and die by engine-native revert; the settle
    // frame composes landed truth without them.
    describe("landing folds under retained optimism (#3123/#3164)", () => {
      const settle = async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        flush();
      };

      function harness() {
        let serverData = [1];
        const fetches: Array<() => void> = [];
        let items!: Refreshable<readonly number[]>;
        let setItems!: (fn: (items: number[]) => void) => void;
        let setVersion!: (v: (p: number) => number) => number;
        const rendered: number[][] = [];
        const dispose = createRoot(dispose => {
          const [version, setV] = createSignal(0);
          setVersion = setV;
          [items, setItems] = createOptimisticStore(
            () =>
              new Promise<number[]>(resolve => {
                version();
                fetches.push(() => resolve([...serverData]));
              }),
            [] as number[]
          );
          createRenderEffect(
            () => items.map(n => n),
            value => {
              rendered.push(value);
            }
          );
          return dispose;
        });
        return {
          get items() {
            return items;
          },
          setItems,
          rendered,
          dispose,
          setServer(data: number[]) {
            serverData = data;
          },
          poll() {
            setVersion(v => v + 1);
            flush();
            fetches.shift()!();
          },
          resolveInitial() {
            fetches.shift()!();
          }
        };
      }

      it("holds a structural add across an equal interim landing", async () => {
        const h = harness();
        flush();
        h.resolveInitial();
        await settle();
        expect(h.rendered.at(-1)).toEqual([1]);

        let confirm!: () => void;
        const add = action(function* () {
          h.setItems(draft => {
            draft.push(2);
          });
          yield new Promise<void>(resolve => {
            confirm = resolve;
          });
        })();
        flush();
        expect(h.rendered.at(-1)).toEqual([1, 2]);
        const flashWatermark = h.rendered.length;

        // Interim poll: server unchanged — the landing is per-key equal to
        // the base the push was applied on. Nothing to replace; hold.
        h.poll();
        await settle();
        expect(h.rendered.at(-1)).toEqual([1, 2]);

        // Confirmation: the server applied the add — this landing changes
        // the arrangement (length 1 -> 2), consumes the override, and lands
        // the identical view. Seamless.
        h.setServer([1, 2]);
        h.poll();
        await settle();
        confirm();
        await add;
        await settle();
        expect(h.rendered.at(-1)).toEqual([1, 2]);
        expect(snapshot(h.items)).toEqual([1, 2]);
        // The point of #3123: no [1] flash anywhere after the optimistic add.
        expect(h.rendered.slice(flashWatermark)).not.toContainEqual([1]);
        h.dispose();
      });

      it("folds an interim landing that changes the arrangement; settle reveals it", async () => {
        const h = harness();
        flush();
        h.resolveInitial();
        await settle();

        let confirm!: () => void;
        const add = action(function* () {
          h.setItems(draft => {
            draft.push(2);
          });
          yield new Promise<void>(resolve => {
            confirm = resolve;
          });
        })();
        flush();
        expect(h.rendered.at(-1)).toEqual([1, 2]);

        // Someone else's row landed mid-hold: the truth folds into the
        // retaining transaction — the view keeps the optimism, no flash.
        h.setServer([1, 3]);
        h.poll();
        await settle();
        expect(h.rendered.at(-1)).toEqual([1, 2]);

        // Settle: the override dies with its transaction and the folded
        // truth reveals in one frame.
        confirm();
        await add;
        await settle();
        expect(h.rendered.at(-1)).toEqual([1, 3]);
        h.dispose();
      });

      it("reverts a held add at owner settle when the server never confirms", async () => {
        const h = harness();
        flush();
        h.resolveInitial();
        await settle();

        let confirm!: () => void;
        const add = action(function* () {
          h.setItems(draft => {
            draft.push(2);
          });
          yield new Promise<void>(resolve => {
            confirm = resolve;
          });
        })();
        flush();
        expect(h.rendered.at(-1)).toEqual([1, 2]);

        // Equal interim landing: held.
        h.poll();
        await settle();
        expect(h.rendered.at(-1)).toEqual([1, 2]);

        // The action completes without the server applying the add: the
        // override dies with its owning transaction — honest revert at
        // settle, not at poll timing.
        confirm();
        await add;
        await settle();
        expect(h.rendered.at(-1)).toEqual([1]);
        expect(snapshot(h.items)).toEqual([1]);
        h.dispose();
      });
    });

    // The #3164 fold ruling (supersedes the retained-setter replay model of
    // the #3123 reopen): optimistic edits are armed node overrides retained
    // by their transaction — nothing is re-executed, ever. Landings of any
    // kind (continuation yields, replacing refreshes, echoes) fold into the
    // retaining transaction while it lives; the visible view keeps the
    // optimistic composition without a single intermediate frame, and the
    // settle reveals the folded truth as the overrides revert. Echoed keyed
    // adds keep their row identity through the reveal (stagedApply's
    // override adoption pool).
    describe("landings fold across retained optimism (#3123 reopen/#3164)", () => {
      const settle = async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        flush();
      };

      it("holds overlapping keyed adds across each other's continuation landings (GabbeV's repro)", async () => {
        type Row = { id: number };
        let notify!: { promise: Promise<Row>; resolve: (row: Row) => void };
        const reset = () => {
          let resolve!: (row: Row) => void;
          const promise = new Promise<Row>(r => (resolve = r));
          notify = { promise, resolve };
        };
        reset();
        const confirm = (row: Row) => {
          const current = notify;
          reset();
          current.resolve(row);
        };
        let items!: Refreshable<readonly Row[]>;
        let setItems!: (fn: (rows: Row[]) => void) => void;
        const rendered: number[][] = [];
        const dispose = createRoot(dispose => {
          [items, setItems] = createOptimisticStore(async function* (store) {
            yield [] as Row[];
            while (true) {
              const row = await notify.promise;
              yield;
              store.push(row);
            }
          }, [] as Row[]);
          createRenderEffect(
            () => items.map(row => row.id),
            value => {
              rendered.push(value);
            }
          );
          return dispose;
        });
        flush();
        await settle();
        expect(rendered.at(-1)).toEqual([]);

        // Blind pushes — the keyed satisfaction rule owns echo idempotency.
        const add = action(function* (row: Row) {
          setItems(store => {
            store.push(row);
          });
          yield until(() => items.some(x => x.id === row.id));
        });
        const addA = add({ id: 0 });
        flush();
        expect(rendered.at(-1)).toEqual([0]);
        const addB = add({ id: 1 });
        flush();
        expect(rendered.at(-1)).toEqual([0, 1]);
        const watermark = rendered.length;

        // A's confirmation: a continuation landing carrying A's own row.
        // The contradiction wipes and replays — A's re-push is satisfied by
        // key (no duplicate), B's re-push re-derives its position on the
        // new base (no flash). The rc.4 behavior GabbeV reopened over
        // rendered [0] here.
        confirm({ id: 0 });
        await settle();
        await settle();
        expect(rendered.at(-1)).toEqual([0, 1]);

        confirm({ id: 1 });
        await settle();
        await Promise.all([addA, addB]);
        await settle();
        expect(rendered.at(-1)).toEqual([0, 1]);
        expect(snapshot(items).map(row => row.id)).toEqual([0, 1]);
        for (const frame of rendered.slice(watermark)) expect(frame).toEqual([0, 1]);
        dispose();
      });

      it("an edit's values outlive its own echo until settle (GabbeV's pending-flag repro)", async () => {
        // #3123 final ruling: a landing that echoes an open transaction's
        // keyed add does NOT satisfy the edit early. The echoed row keeps
        // the landed slot, the replayed edit's VALUE masks it until settle
        // (structure from the landing, value from the intent). Pins the
        // updated StackBlitz shape: rows carry pending flags that differ
        // between the optimistic push (true) and the landing's echo
        // (false), and the action outlives its confirmation.
        type Row = { id: number; pending: boolean };
        let notify!: { promise: Promise<Row>; resolve: (row: Row) => void };
        const reset = () => {
          let resolve!: (row: Row) => void;
          const promise = new Promise<Row>(r => (resolve = r));
          notify = { promise, resolve };
        };
        reset();
        const confirm = (row: Row) => {
          const current = notify;
          reset();
          current.resolve(row);
        };
        let items!: Refreshable<readonly Row[]>;
        let setItems!: (fn: (rows: Row[]) => void) => void;
        const rendered: string[][] = [];
        const dispose = createRoot(dispose => {
          [items, setItems] = createOptimisticStore(async function* (store) {
            yield [] as Row[];
            while (true) {
              const row = await notify.promise;
              yield;
              store.push({ ...row, pending: false });
            }
          }, [] as Row[]);
          createRenderEffect(
            () => items.map(row => row.id + (row.pending ? "p" : "")),
            value => {
              rendered.push(value);
            }
          );
          return dispose;
        });
        flush();
        await settle();
        expect(rendered.at(-1)).toEqual([]);

        // The action holds past its own confirmation (until + trailing gate).
        const holds: (() => void)[] = [];
        const add = action(function* (row: Row) {
          setItems(store => {
            store.push({ ...row, pending: true });
          });
          yield until(() => items.some(x => x.id === row.id));
          yield new Promise<void>(resolve => {
            holds.push(resolve);
          });
        });
        const addA = add({ id: 0, pending: true });
        flush();
        expect(rendered.at(-1)).toEqual(["0p"]);
        const addB = add({ id: 1, pending: true });
        flush();
        expect(rendered.at(-1)).toEqual(["0p", "1p"]);

        // A's confirmation echoes A's row with pending:false. The edit is
        // NOT satisfied early: A's replayed value masks the landed row
        // while A's transaction is still open. Pre-ruling this rendered
        // ["0", "1p"] — the pending presentation died mid-action.
        confirm({ id: 0, pending: false });
        await settle();
        await settle();
        expect(rendered.at(-1)).toEqual(["0p", "1p"]);

        confirm({ id: 1, pending: false });
        await settle();
        await settle();
        expect(rendered.at(-1)).toEqual(["0p", "1p"]);

        // Settle is the only reckoning: edits die with their transactions
        // and the landed truth (pending:false) stands. The two actions
        // entangled through shared writes, so they settle together.
        for (const release of holds) release();
        await Promise.all([addA, addB]);
        await settle();
        expect(rendered.at(-1)).toEqual(["0", "1"]);
        expect(snapshot(items)).toEqual([
          { id: 0, pending: false },
          { id: 1, pending: false }
        ]);
        // No frame ever dropped a row once both were visible.
        const sawBoth = rendered.findIndex(frame => frame.length === 2);
        for (const frame of rendered.slice(sawBoth)) expect(frame).toHaveLength(2);
        dispose();
      });

      it("holds an unkeyed pending add across a foreign continuation landing; settle reveals truth without it", async () => {
        let feed!: (value: number) => void;
        let notify!: { promise: Promise<number>; resolve: (value: number) => void };
        const reset = () => {
          let resolve!: (value: number) => void;
          const promise = new Promise<number>(r => (resolve = r));
          notify = { promise, resolve };
        };
        reset();
        feed = value => {
          const current = notify;
          reset();
          current.resolve(value);
        };
        let items!: Refreshable<readonly number[]>;
        let setItems!: (fn: (values: number[]) => void) => void;
        const rendered: number[][] = [];
        const dispose = createRoot(dispose => {
          [items, setItems] = createOptimisticStore(async function* (store) {
            yield [1];
            while (true) {
              const value = await notify.promise;
              yield;
              store.push(value);
            }
          }, [] as number[]);
          createRenderEffect(
            () => items.map(n => n),
            value => {
              rendered.push(value);
            }
          );
          return dispose;
        });
        flush();
        await settle();
        expect(rendered.at(-1)).toEqual([1]);

        let confirm!: () => void;
        const add = action(function* () {
          setItems(store => {
            store.push(2);
          });
          yield new Promise<void>(resolve => {
            confirm = resolve;
          });
        })();
        flush();
        expect(rendered.at(-1)).toEqual([1, 2]);

        // Foreign row over the live stream: the continuation folds into the
        // retaining transaction — mid-hold the view keeps the optimistic
        // composition unchanged.
        feed(3);
        await settle();
        await settle();
        expect(rendered.at(-1)).toEqual([1, 2]);

        // The server never applied the add: it dies with its transaction,
        // and the settle frame reveals the folded truth without it.
        confirm();
        await add;
        await settle();
        expect(rendered.at(-1)).toEqual([1, 3]);
        expect(snapshot(items)).toEqual([1, 3]);
        dispose();
      });

      // (The former "replay throws" test is gone with the replay model
      // itself: setters are never re-executed under the fold ruling, so
      // there is no re-run to throw.)

      it("folds a replacing landing and later continuations; settle reveals composed truth without the edit", async () => {
        let feed!: (value: number) => void;
        let notify!: { promise: Promise<number>; resolve: (value: number) => void };
        const reset = () => {
          let resolve!: (value: number) => void;
          const promise = new Promise<number>(r => (resolve = r));
          notify = { promise, resolve };
        };
        reset();
        feed = value => {
          const current = notify;
          reset();
          current.resolve(value);
        };
        let serverData = [1];
        const fetches: Array<() => void> = [];
        let setVersion!: (fn: (v: number) => number) => number;
        let items!: Refreshable<readonly number[]>;
        let setItems!: (fn: (values: number[]) => void) => void;
        const rendered: number[][] = [];
        const dispose = createRoot(dispose => {
          const [version, setV] = createSignal(0);
          setVersion = setV;
          [items, setItems] = createOptimisticStore(async function* (store) {
            version();
            const data = await new Promise<number[]>(resolve => {
              fetches.push(() => resolve([...serverData]));
            });
            yield data;
            while (true) {
              const value = await notify.promise;
              yield;
              store.push(value);
            }
          }, [] as number[]);
          createRenderEffect(
            () => items.map(n => n),
            value => {
              rendered.push(value);
            }
          );
          return dispose;
        });
        flush();
        fetches.shift()!();
        await settle();
        expect(rendered.at(-1)).toEqual([1]);

        let confirm!: () => void;
        const add = action(function* () {
          setItems(store => {
            store.push(2);
          });
          yield new Promise<void>(resolve => {
            confirm = resolve;
          });
        })();
        flush();
        expect(rendered.at(-1)).toEqual([1, 2]);

        // Refresh with foreign change mid-hold: the re-invocation's answer
        // folds like any landing — the view keeps the optimistic
        // composition while the action retains it.
        serverData = [1, 5];
        setVersion(v => v + 1);
        flush();
        fetches.shift()!();
        await settle();
        expect(rendered.at(-1)).toEqual([1, 2]);

        // A continuation on top of the folded refresh composes in the
        // staged backing — still masked.
        feed(7);
        await settle();
        await settle();
        expect(rendered.at(-1)).toEqual([1, 2]);

        // Settle: the edit dies with its transaction; the reveal is the
        // full composed truth — refresh + continuation, no resurrected add.
        confirm();
        await add;
        await settle();
        expect(rendered.at(-1)).toEqual([1, 5, 7]);
        expect(snapshot(items)).toEqual([1, 5, 7]);
        dispose();
      });
    });

    // Fold twin of the #2719 re-pin above, through a draft-mutating derive:
    // the landing's per-op draft writes bind to the retaining transaction
    // (aroundDraftWrite), so the mid-hold view keeps the optimism and the
    // reveal clears it at the owning action's settle.
    it("holds optimistic rows across a draft-mutating projection's landing; settle clears them", async () => {
      type Comment = { id: number; text: string };
      const serverComments = [
        [
          { id: 0, text: "Issue 0 A" },
          { id: 1, text: "Issue 0 B" }
        ],
        [
          { id: 2, text: "Issue 1 A" },
          { id: 3, text: "Issue 1 B" }
        ]
      ];
      const fetches: Array<{ issueId: number; resolve: () => void }> = [];
      let setIssue!: (issue: number) => number;
      let comments!: Refreshable<readonly Comment[]>;
      let setComments!: (fn: (comments: Comment[]) => void) => void;
      let addComment!: () => Promise<void>;
      let nextIssue!: () => Promise<void>;
      let resolveAdd!: () => void;
      const rendered: string[][] = [];

      const settle = async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        flush();
      };

      createRoot(dispose => {
        const [issueId, setIssueId] = createSignal(0);
        setIssue = setIssueId;
        [comments, setComments] = createOptimisticStore(async draft => {
          const requestedIssue = issueId();
          await new Promise<void>(resolve => {
            fetches.push({ issueId: requestedIssue, resolve });
          });
          const next = serverComments[requestedIssue];
          for (let i = 0; i < next.length; i++) draft[i] = structuredClone(next[i]);
          draft.length = next.length;
        }, [] as Comment[]);
        addComment = action(function* () {
          setComments(draft => {
            draft.push({ id: -1, text: "Optimistic" });
          });
          yield new Promise<void>(resolve => {
            resolveAdd = resolve;
          });
        });
        nextIssue = action(function* () {
          setIssue(1);
          const fetch = fetches.find(fetch => fetch.issueId === 1);
          if (fetch) yield new Promise<void>(resolve => queueMicrotask(resolve));
        });
        createRenderEffect(
          () => comments.map(comment => comment.text),
          value => {
            rendered.push(value);
          }
        );
        return dispose;
      });

      flush();
      fetches.shift()!.resolve();
      await settle();

      expect(rendered.at(-1)).toEqual(["Issue 0 A", "Issue 0 B"]);

      const add = addComment();
      flush();
      expect(rendered.at(-1)).toEqual(["Issue 0 A", "Issue 0 B", "Optimistic"]);

      const next = nextIssue();
      flush();
      fetches.find(fetch => fetch.issueId === 1)!.resolve();
      await next;
      await settle();

      // Mid-hold: the landing folded — old question + optimism, no flash.
      expect(comments.length).toBe(3);
      expect(rendered.at(-1)).toEqual(["Issue 0 A", "Issue 0 B", "Optimistic"]);

      resolveAdd();
      await add;
      await settle();
      // Settle: atomic reveal of the folded question.
      expect(comments.length).toBe(2);
      expect(rendered.at(-1)).toEqual(["Issue 1 A", "Issue 1 B"]);
    });

    it("recycles an optimistic row when fresh derived data with the same key lands; value reveals at settle", async () => {
      type Todo = { id: string; title: string; saved?: boolean };
      let serverTodos: Todo[] = [];
      const fetches: Array<() => void> = [];
      let todos!: Refreshable<readonly Todo[]>;
      let setTodos!: (fn: (todos: Todo[]) => void) => void;
      let addTodo!: () => Promise<void>;
      let resolveAdd!: () => void;

      const settle = async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        flush();
      };

      createRoot(dispose => {
        [todos, setTodos] = createOptimisticStore(
          () =>
            new Promise<Todo[]>(resolve => {
              fetches.push(() => resolve(structuredClone(serverTodos)));
            }),
          [] as Todo[],
          { key: "id" }
        );
        createRenderEffect(
          () => todos.map(todo => todo.title),
          () => {}
        );
        addTodo = action(function* () {
          setTodos(draft => {
            draft.push({ id: "1", title: "Optimistic" });
          });
          yield new Promise<void>(resolve => {
            resolveAdd = resolve;
          });
        });
        return dispose;
      });

      flush();
      fetches.shift()!();
      await settle();

      const add = addTodo();
      flush();

      const optimisticRef = todos[0];
      expect(optimisticRef.title).toBe("Optimistic");

      serverTodos = [{ id: "1", title: "Saved", saved: true }];
      refresh(todos);
      flush();
      fetches.shift()!();
      await settle();

      // Mid-hold: the echo folded — the row keeps its identity AND its
      // optimistic value (the landing's "Saved" stays masked until settle).
      expect(todos.length).toBe(1);
      expect(todos[0]).toBe(optimisticRef);
      expect(todos[0].title).toBe("Optimistic");

      resolveAdd();
      await add;
      await settle();
      // Settle: the same recycled row reveals the landed value.
      expect(todos.length).toBe(1);
      expect(todos[0]).toBe(optimisticRef);
      expect(todos[0].title).toBe("Saved");
      expect(todos[0].saved).toBe(true);
    });

    it("optimistic write reverts to computed value after async completes", async () => {
      const [$id, setId] = createSignal(1);
      let state: { data: number };
      let setState: (fn: (s: { data: number }) => void) => void;

      createRoot(() => {
        [state, setState] = createOptimisticStore(
          async (s: { data: number }) => {
            const id = $id();
            await Promise.resolve();
            s.data = id * 10;
          },
          { data: 0 }
        );

        createRenderEffect(
          () => state.data,
          () => {}
        );
      });

      // Initial load - need flush to trigger first async run
      flush();
      await new Promise(r => setTimeout(r, 0));
      expect(state!.data).toBe(10);

      // User changes ID and optimistically sets data
      setId(2);
      setState!(s => {
        s.data = 999;
      });
      flush();

      expect(state!.data).toBe(999); // optimistic

      // After async completes, should have computed value from id=2
      await new Promise(r => setTimeout(r, 0));

      expect(state!.data).toBe(20); // computed: 2 * 10 = 20
      expect($id()).toBe(2); // committed
      expect(isPending(() => state!.data)).toBe(false);
    });
  });
});

/**
 * #3108: a derived optimistic store's source is the TRUTH AUTHOR — its draft
 * reads (sync body and post-await continuations alike) must serve the
 * authoritative view, never a caller's tentative overlay. Before the fix, a
 * generator continuation's `store.push` read `length` through an action's
 * optimistic row (1 instead of 0) and landed truth at index 1, permanently
 * committing `[null, row]`. User setter drafts keep composing on the
 * optimistic view (#2951) — the gate is the authoritative-write posture, the
 * same pair ensurePB classifies drafts by.
 */
describe("truth-author drafts read the authoritative view (#3108)", () => {
  const tick = () => Promise.resolve();

  it("reporter shape: optimistic push + draft-mutating generator + until neither corrupts nor flickers", async () => {
    let resolveGate!: () => void;
    const gate = new Promise<void>(r => (resolveGate = r));

    let items!: { id: number }[];
    let setItems!: (fn: (s: { id: number }[]) => void) => void;
    const views: unknown[][] = [];
    let dispose!: () => void;

    createRoot(d => {
      dispose = d;
      const [s, set] = createOptimisticStore<{ id: number }[]>(async function* (store) {
        yield [];
        await gate;
        yield;
        store.push({ id: 1 });
      }, []);
      items = s;
      setItems = set;
      createEffect(
        () => items.map(item => item.id),
        v => void views.push(v)
      );
    });
    flush();
    await tick();
    await tick();
    flush();
    expect(views.at(-1)).toEqual([]);

    const order: string[] = [];
    const click = action(function* () {
      setItems(s => {
        s.push({ id: 1 });
      });
      order.push("written");
      resolveGate();
      yield until(() => items.some(item => item.id === 1));
      order.push("acked");
    });
    const done = click().then(() => order.push("settled"));
    flush();
    await tick();
    await tick();
    flush();
    await tick();
    flush();
    await tick();
    await tick();
    flush();
    await done;

    expect(order).toEqual(["written", "acked", "settled"]);
    expect(items.map(i => i.id)).toEqual([1]);
    // The app view never contained an undefined/null row at any point.
    for (const v of views) expect(v).not.toContain(undefined);
    for (const v of views) expect(v).not.toContain(null);
    dispose();
  });

  it("a continuation's draft push indexes off authoritative length, not the caller's overlay", async () => {
    let resolveGate!: () => void;
    const gate = new Promise<void>(r => (resolveGate = r));

    let items!: { id: number }[];
    let setItems!: (fn: (s: { id: number }[]) => void) => void;
    let dispose!: () => void;

    createRoot(d => {
      dispose = d;
      const [s, set] = createOptimisticStore<{ id: number }[]>(async function* (store) {
        yield [];
        await gate;
        yield;
        store.push({ id: 1 });
      }, []);
      items = s;
      setItems = set;
    });
    flush();
    await tick();
    await tick();
    flush();

    let release!: () => void;
    const hold = new Promise<void>(r => (release = r));
    const click = action(function* () {
      setItems(s => {
        s.push({ id: 1 });
      });
      resolveGate();
      yield hold;
    });
    const done = click();
    flush();
    await tick();
    await tick();
    flush();
    await tick();
    flush();
    // Mid-hold: the landing occupies index 0; the optimistic row rides on top
    // of it — never a hole at index 0 with truth at index 1.
    expect(items[0]).toEqual({ id: 1 });
    release();
    await done;
    flush();
    await tick();
    flush();
    // Committed truth: exactly the authored row, no null hole.
    expect(JSON.parse(JSON.stringify(items))).toEqual([{ id: 1 }]);
    dispose();
  });
});
