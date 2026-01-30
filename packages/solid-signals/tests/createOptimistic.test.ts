import {
  action,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  pending
} from "../src/index.js";

afterEach(() => flush());

describe("createOptimistic", () => {
  describe("basic behavior", () => {
    it("should store and return value on read", () => {
      const [$x] = createOptimistic(1);
      expect($x).toBeInstanceOf(Function);
      expect($x()).toBe(1);
    });

    it("should update signal via setter and revert on flush", () => {
      const [$x, setX] = createOptimistic(1);
      setX(2);
      // Optimistic signals write directly to _value, should be immediately visible
      expect($x()).toBe(2);
      // Without an active transition, flush reverts to original value
      flush();
      expect($x()).toBe(1);
    });

    it("should update signal via update function and revert on flush", () => {
      const [$x, setX] = createOptimistic(1);
      setX(n => n + 1);
      expect($x()).toBe(2);
      flush();
      expect($x()).toBe(1);
    });

    it("should allow multiple optimistic updates before flush", () => {
      const [$x, setX] = createOptimistic(1);
      setX(2);
      expect($x()).toBe(2);
      setX(3);
      expect($x()).toBe(3);
      setX(n => n + 10);
      expect($x()).toBe(13);
      // All revert on flush
      flush();
      expect($x()).toBe(1);
    });

    it("should provide current optimistic value in update callback", () => {
      const [$x, setX] = createOptimistic(10);

      setX(prev => {
        expect(prev).toBe(10);
        return 20;
      });
      expect($x()).toBe(20);

      setX(prev => {
        // Should see the optimistic value, not original
        expect(prev).toBe(20);
        return prev + 5;
      });
      expect($x()).toBe(25);

      flush();
      expect($x()).toBe(10);
    });
  });

  describe("async transitions", () => {
    it("should show optimistic value during async transition and revert when complete", async () => {
      const [$count, setCount] = createOptimistic(0);
      const values: number[] = [];

      createRoot(() => {
        createRenderEffect(
          () => $count(),
          v => {
            values.push(v);
          }
        );
      });

      flush();
      expect(values).toEqual([0]);

      // Start an action (transition)
      const doAsync = action(function* () {
        setCount(1); // optimistic update
        yield Promise.resolve(); // simulate async
        // When transition completes, it reverts to original value
      });

      doAsync();
      flush();

      // Optimistic value should be visible
      expect($count()).toBe(1);
      expect(values).toEqual([0, 1]);

      // Wait for async to complete
      await Promise.resolve();

      // Reverts to original value
      expect($count()).toBe(0);
      expect(values).toEqual([0, 1, 0]);
    });

    it("should show each optimistic update during transition", async () => {
      const [$count, setCount] = createOptimistic(0);
      const values: number[] = [];

      createRoot(() => {
        createRenderEffect(
          () => $count(),
          v => {
            values.push(v);
          }
        );
      });

      flush();

      const doAsync = action(function* () {
        setCount(1);
        yield Promise.resolve();
        setCount(2);
        yield Promise.resolve();
        // Reverts to 0 when complete
      });

      doAsync();
      flush();
      expect($count()).toBe(1);

      await Promise.resolve();
      expect($count()).toBe(2);

      await Promise.resolve();
      expect($count()).toBe(0);

      expect(values).toEqual([0, 1, 2, 0]);
    });

    it("should not trigger effect if optimistic value matches original", async () => {
      const [$count, setCount] = createOptimistic(5);
      const effectRuns = vi.fn();

      createRoot(() => {
        createRenderEffect(
          () => $count(),
          v => effectRuns(v)
        );
      });

      flush();
      expect(effectRuns).toHaveBeenCalledTimes(1);
      expect(effectRuns).toHaveBeenLastCalledWith(5);

      const doAsync = action(function* () {
        setCount(5); // same as original
        yield Promise.resolve();
      });

      doAsync();
      flush();
      // Should not trigger effect since value didn't change
      expect(effectRuns).toHaveBeenCalledTimes(1);

      await Promise.resolve();
      // Should not trigger again on revert since value is same
      expect(effectRuns).toHaveBeenCalledTimes(1);
    });

    it("should hold regular signal value during transition while showing optimistic", async () => {
      const [$regular, setRegular] = createSignal(10);
      const [$optimistic, setOptimistic] = createOptimistic(1);
      const values: Array<{ r: number; o: number }> = [];

      createRoot(() => {
        createRenderEffect(
          () => ({ r: $regular(), o: $optimistic() }),
          v => {
            values.push(v);
          }
        );
      });

      flush();
      expect(values).toEqual([{ r: 10, o: 1 }]);

      const doAsync = action(function* () {
        setOptimistic(100); // optimistic - visible immediately
        setRegular(20); // regular signal - held by the transition
        yield Promise.resolve();
      });

      doAsync();
      flush();
      // Regular signal held at 10, optimistic shows 100
      expect(values).toEqual([
        { r: 10, o: 1 },
        { r: 10, o: 100 }
      ]);

      await Promise.resolve();
      // Transition complete: regular commits to 20, optimistic reverts to 1
      expect($regular()).toBe(20);
      expect($optimistic()).toBe(1);
      expect(values).toEqual([
        { r: 10, o: 1 },
        { r: 10, o: 100 },
        { r: 20, o: 1 }
      ]);
    });

    it("should revert multiple optimistic signals together when transition completes", async () => {
      const [$a, setA] = createOptimistic(1);
      const [$b, setB] = createOptimistic(10);
      const values: Array<{ a: number; b: number }> = [];

      createRoot(() => {
        createRenderEffect(
          () => ({ a: $a(), b: $b() }),
          v => {
            values.push(v);
          }
        );
      });

      flush();
      expect(values).toEqual([{ a: 1, b: 10 }]);

      const doAsync = action(function* () {
        setA(2);
        setB(20);
        yield Promise.resolve();
        setA(3);
        yield Promise.resolve();
      });

      doAsync();
      flush();
      expect(values).toEqual([
        { a: 1, b: 10 },
        { a: 2, b: 20 }
      ]);

      await Promise.resolve();
      expect(values).toEqual([
        { a: 1, b: 10 },
        { a: 2, b: 20 },
        { a: 3, b: 20 }
      ]);

      await Promise.resolve();
      // Both revert together
      expect($a()).toBe(1);
      expect($b()).toBe(10);
      expect(values).toEqual([
        { a: 1, b: 10 },
        { a: 2, b: 20 },
        { a: 3, b: 20 },
        { a: 1, b: 10 }
      ]);
    });
  });

  describe("computed optimistic", () => {
    it("should derive from source and revert optimistic writes", () => {
      const [$x, setX] = createSignal(1);
      const [$y, setY] = createOptimistic(() => $x() + 1);

      flush();
      expect($y()).toBe(2);

      // Optimistic write
      setY(100);
      expect($y()).toBe(100);

      // On flush, reverts to computed value
      flush();
      expect($y()).toBe(2);

      // Source change propagates through
      setX(5);
      flush();
      expect($y()).toBe(6);
    });

    it("should hold source signal during async and revert optimistic when complete", async () => {
      const [$x, setX] = createSignal(1);
      const [$y, setY] = createOptimistic(async () => {
        const v = $x();
        await Promise.resolve();
        return v * 2;
      });

      createRoot(() => {
        createRenderEffect(
          () => $y(),
          () => {}
        );
      }); // Keep subscription alive

      flush();
      await Promise.resolve();
      await Promise.resolve(); // Extra tick for async function's internal await
      expect($y()).toBe(2);

      // Optimistic write
      setY(8);
      expect($y()).toBe(8);

      // Source update - but held during transition
      setX(5);
      flush();
      expect($y()).toBe(8); // still optimistic
      expect($x()).toBe(1); // held at original

      await Promise.resolve();
      await Promise.resolve(); // Extra tick for async function's internal await
      // Transition complete, computed value with new source
      expect($y()).toBe(10);
    });

    it("should allow optimistic override during transition with held source", async () => {
      const [$x, setX] = createSignal(1);
      const [$y, setY] = createOptimistic(() => $x() * 2);
      const values: number[] = [];

      createRoot(() => {
        createRenderEffect(
          () => $y(),
          v => {
            values.push(v);
          }
        );
      });

      flush();
      expect(values).toEqual([2]);

      const doAsync = action(function* () {
        setY(100); // optimistic override
        yield Promise.resolve();
        setX(10); // source update - held
        yield Promise.resolve();
      });

      doAsync();
      flush();
      expect($y()).toBe(100);

      await Promise.resolve();
      expect($y()).toBe(100); // still optimistic
      expect($x()).toBe(1); // source held

      await Promise.resolve();
      // Transition complete: source commits, optimistic reverts to computed
      expect($y()).toBe(20); // computed from x=10
      expect($x()).toBe(10);
    });

    it("should chain optimistic signals correctly", async () => {
      const [$a, setA] = createOptimistic(1);
      const [$b] = createOptimistic(() => $a() * 2);
      const values: Array<{ a: number; b: number }> = [];

      createRoot(() => {
        createRenderEffect(
          () => ({ a: $a(), b: $b() }),
          v => {
            values.push(v);
          }
        );
      });

      flush();
      expect(values).toEqual([{ a: 1, b: 2 }]);

      const doAsync = action(function* () {
        setA(10);
        yield Promise.resolve();
      });

      doAsync();
      flush();
      // Optimistic $a shows 10, computed $b derives from it
      expect($a()).toBe(10);
      expect($b()).toBe(20);
      expect(values).toEqual([
        { a: 1, b: 2 },
        { a: 10, b: 20 }
      ]);

      await Promise.resolve();
      // Both revert
      expect($a()).toBe(1);
      expect($b()).toBe(2);
      expect(values).toEqual([
        { a: 1, b: 2 },
        { a: 10, b: 20 },
        { a: 1, b: 2 }
      ]);
    });
  });

  describe("memo depending on optimistic signal", () => {
    it("should propagate optimistic changes through memo chain", async () => {
      const [$x, setX] = createOptimistic(1);
      const $a = createMemo(() => $x() + 1);
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
        setX(10);
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
      const [$x, setX] = createOptimistic(1);

      const doAsync = action(function* () {
        setX(100);
        // Read outside any effect/memo
        expect($x()).toBe(100);
        yield Promise.resolve();
      });

      doAsync();
      // Also readable outside
      expect($x()).toBe(100);

      await Promise.resolve();
      expect($x()).toBe(1);
    });
  });

  describe("multiple sequential cycles", () => {
    it("should revert correctly across multiple optimistic cycles", async () => {
      const [$x, setX] = createOptimistic(0);
      const values: number[] = [];

      createRoot(() => {
        createRenderEffect(
          () => $x(),
          v => { values.push(v); }
        );
      });

      expect($x()).toBe(0);
      expect(values).toEqual([0]);

      // First cycle
      let resolve1: () => void;
      const promise1 = new Promise<void>(r => (resolve1 = r));
      const action1 = action(function* () {
        yield promise1;
      });

      setX(1);
      action1();
      await Promise.resolve();

      expect($x()).toBe(1);
      expect(values).toEqual([0, 1]);

      // Complete first cycle
      resolve1!();
      await Promise.resolve();
      await Promise.resolve();

      expect($x()).toBe(0); // Reverted
      expect(values).toEqual([0, 1, 0]);

      // Second cycle - should work the same!
      let resolve2: () => void;
      const promise2 = new Promise<void>(r => (resolve2 = r));
      const action2 = action(function* () {
        yield promise2;
      });

      setX(2);
      action2();
      await Promise.resolve();

      expect($x()).toBe(2); // Optimistic
      expect(values).toEqual([0, 1, 0, 2]);

      // Complete second cycle
      resolve2!();
      await Promise.resolve();
      await Promise.resolve();

      expect($x()).toBe(0); // Reverted again
      expect(values).toEqual([0, 1, 0, 2, 0]);
    });
  });

  describe("rapid successive actions", () => {
    it("should show both optimistic updates immediately when two independent actions are triggered rapidly", async () => {
      const [$x1, setX1] = createOptimistic(false);
      const [$x2, setX2] = createOptimistic(false);
      const values1: boolean[] = [];
      const values2: boolean[] = [];

      // Create effects in SEPARATE roots (like separate components)
      createRoot(() => {
        createRenderEffect(
          () => $x1(),
          v => { values1.push(v); }
        );
        createRenderEffect(
          () => $x2(),
          v => { values2.push(v); }
        );
      });

      // Both start false
      expect($x1()).toBe(false);
      expect($x2()).toBe(false);
      expect(values1).toEqual([false]);
      expect(values2).toEqual([false]);

      let resolve1: () => void;
      let resolve2: () => void;
      const promise1 = new Promise<void>(r => (resolve1 = r));
      const promise2 = new Promise<void>(r => (resolve2 = r));

      // Actions that just do async work (like the user's removeTodo)
      const action1 = action(function* () {
        yield promise1;
      });

      const action2 = action(function* () {
        yield promise2;
      });

      // Trigger first: optimistic write BEFORE action (like user's pattern)
      setX1(true);
      action1();
      await Promise.resolve();

      // First optimistic update should show
      expect($x1()).toBe(true);
      expect(values1).toEqual([false, true]);

      // Trigger second: optimistic write BEFORE action
      setX2(true);
      action2();
      await Promise.resolve();

      // BOTH optimistic updates should show immediately
      expect($x1()).toBe(true);
      expect($x2()).toBe(true);
      expect(values2).toEqual([false, true]); // Second should also have updated

      // Complete FIRST action only
      resolve1!();
      await Promise.resolve();
      await Promise.resolve();

      // First should revert, second should still show optimistic
      expect($x1()).toBe(false);
      expect($x2()).toBe(true); // Still optimistic!
      expect(values1).toEqual([false, true, false]);
      expect(values2).toEqual([false, true]); // No change yet

      // Complete second action
      resolve2!();
      await Promise.resolve();
      await Promise.resolve();

      // Now second should also revert
      expect($x2()).toBe(false);
      expect(values2).toEqual([false, true, false]);
    });
  });

  describe("isPending and pending() with async optimistic", () => {
    it("optimistic value matches computed result", async () => {
      const [$id, setId] = createSignal(1);
      let $data: () => number;
      let setData: (v: number) => void;

      createRoot(() => {
        [$data, setData] = createOptimistic(async () => {
          const id = $id();
          await Promise.resolve();
          return id * 10; // simulate fetching data for id
        });

        // Effect to create transition
        createRenderEffect($data, () => {});
      });

      // Initial load
      await new Promise(r => setTimeout(r, 0));
      expect($data!()).toBe(10);
      expect(isPending($data!)).toBe(false);

      // User changes ID and optimistically sets expected data
      setId(2);
      setData!(20); // optimistic: "I expect id=2 to give data=20"
      flush();

      // Optimistic value is immediate
      expect($data!()).toBe(20);
      // isPending - async is in flight
      expect(isPending($data!)).toBe(true);
      // pending() returns the optimistic value
      expect(pending($data!)).toBe(20);

      // Source signal is held
      expect($id()).toBe(1); // held during transition
      expect(pending($id)).toBe(2); // in-flight value

      // After async completes
      await new Promise(r => setTimeout(r, 0));

      // Computed value matches optimistic guess
      expect($data!()).toBe(20); // computed: 2 * 10 = 20
      expect($id()).toBe(2); // committed
      expect(isPending($data!)).toBe(false);
    });

    it("optimistic value does not match computed result", async () => {
      const [$id, setId] = createSignal(1);
      let $data: () => number;
      let setData: (v: number) => void;

      createRoot(() => {
        [$data, setData] = createOptimistic(async () => {
          const id = $id();
          await Promise.resolve();
          return id * 10; // simulate fetching data for id
        });

        // Effect to create transition
        createRenderEffect($data, () => {});
      });

      // Initial load
      await new Promise(r => setTimeout(r, 0));
      expect($data!()).toBe(10);
      expect(isPending($data!)).toBe(false);

      // User changes ID and optimistically sets WRONG expected data
      setId(2);
      setData!(999); // optimistic guess is wrong
      flush();

      // Optimistic value is immediate
      expect($data!()).toBe(999);
      // isPending - async is in flight
      expect(isPending($data!)).toBe(true);
      // pending() returns the optimistic value
      expect(pending($data!)).toBe(999);

      // After async completes
      await new Promise(r => setTimeout(r, 0));

      // Computed value corrects the optimistic guess
      expect($data!()).toBe(20); // computed: 2 * 10 = 20, not 999
      expect($id()).toBe(2); // committed
      expect(isPending($data!)).toBe(false);
    });
  });
});
