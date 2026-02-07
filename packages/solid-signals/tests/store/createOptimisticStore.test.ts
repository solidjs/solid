import {
  action,
  createMemo,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  isPending,
  pending,
  refresh
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
      const [state, setState] = createOptimisticStore(s => {
        s.value = $x() + 1;
      }, { value: 0 });

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
      const [state, setState] = createOptimisticStore(
        () => ({ value: $x() * 2 }),
        { value: 0 }
      );

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

    it("should handle async projection and revert optimistic writes", async () => {
      const [$x, setX] = createSignal(1);
      const [state, setState] = createOptimisticStore(async s => {
        const v = $x();
        await Promise.resolve();
        s.value = v * 2;
      }, { value: 0 });

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

      const [state, setState] = createOptimisticStore(s => {
        const items = $items();
        s.items = items;
        s.count = items.length;
      }, { items: [] as { id: number; name: string }[], count: 0 });

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
      setState(s => { s.items.push(2); });
      setState(s => { s.items.push(3); });
      setState(s => { s.items.push(4); });

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
        { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }
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
        setState(s => { s.completed = true; });
        yield apiPromise1;
      });

      // Toggle 2: true -> false (before toggle 1 flushes)
      const toggle2 = action(function* () {
        setState(s => { s.completed = false; });
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
        setState(s => { s.completed = true; });
        yield apiPromise1;
      });
      t1();
      await Promise.resolve();

      expect(state.completed).toBe(true);

      // Toggle 2: true -> false
      const t2 = action(function* () {
        setState(s => { s.completed = false; });
        yield apiPromise2;
      });
      t2();
      await Promise.resolve();

      expect(state.completed).toBe(false);

      // Toggle 3: false -> true
      const t3 = action(function* () {
        setState(s => { s.completed = true; });
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
        setState(s => { s.completed = true; });
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
        setState(s => { s.completed = false; });
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
        return [{ id: 1, name: "Item 1" }, { id: 2, name: "Item 2" }];
      };

      const [state] = createOptimisticStore(async () => {
        return await mockFetch();
      }, [] as { id: number; name: string }[]);

      createRoot(() => {
        createRenderEffect(
          () => state.length,
          () => {}
        );
      });

      flush();
      expect(state.length).toBe(0); // Still loading

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

  describe("isPending and pending() with async optimistic store", () => {
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
        createRenderEffect(() => state.data, () => {});
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

    it("isPending and pending() during async with optimistic write", async () => {
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

        createRenderEffect(() => state.data, () => {});
      });

      // Initial load - need flush to trigger first async run
      flush();
      await new Promise(r => setTimeout(r, 0));
      expect(state!.data).toBe(10);
      expect(isPending(() => state!.data)).toBe(false);

      // User changes ID and optimistically sets expected data
      setId(2);
      setState!(s => {
        s.data = 999;
      }); // optimistic write
      flush();

      // Optimistic value is immediate
      expect(state!.data).toBe(999);
      // isPending - async is in flight
      expect(isPending(() => state!.data)).toBe(true);
      // pending() returns the optimistic value
      expect(pending(() => state!.data)).toBe(999);
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

        createRenderEffect(() => state.data, () => {});
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
