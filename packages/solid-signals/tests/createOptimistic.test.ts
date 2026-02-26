import {
  action,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest,
  refresh
} from "../src/index.js";

afterEach(() => flush());

describe("createOptimistic", () => {
  describe("async memo with optimistic computed wrapping regular signal", () => {
    it("should combine pending value with optimistic write when transition completes", async () => {
      const [count, setCount] = createSignal(0);
      const [timeline, setTimeline] = createSignal("");
      const [optimisticTimeline, setOptimisticTimeline] = createOptimistic(timeline);

      // Async memo like user's example - setTimeout style
      let resolveAsync: () => void;
      const asyncCount = createMemo(() => {
        const c = count();
        return new Promise<number>(res => {
          resolveAsync = () => res(c);
        });
      });

      const timelineValues: string[] = [];
      const countValues: number[] = [];

      createRoot(() => {
        // Render effect on async count (like Loading boundary)
        createRenderEffect(
          () => asyncCount(),
          v => {
            countValues.push(v);
          }
        );
        // Render effect on optimistic timeline
        createRenderEffect(
          () => optimisticTimeline(),
          v => {
            timelineValues.push(v);
          }
        );
      });

      // Initial async load
      flush();
      expect(countValues).toEqual([]); // Async not resolved yet

      // Resolve initial async
      resolveAsync!();
      await new Promise(r => setTimeout(r, 0));
      expect(countValues).toEqual([0]);
      expect(timelineValues).toEqual([""]);

      // Click 1: "Append 0 Async" - triggers new async transition
      setCount(1);
      setTimeline(x => x + "0");
      flush(); // First flush - async starts, transition begins

      // After first flush: optimisticTimeline recomputes in background (saves '0' to _pendingValue)
      // But reading returns current _value = ''
      expect(optimisticTimeline()).toBe(""); // Current value, not pending
      expect(timeline()).toBe(""); // Held during transition
      expect(timelineValues).toEqual([""]); // Effect hasn't run yet

      // Click 2: "Append 1" - during transition, adds optimistic write
      // setTimeline builds on _pendingValue: '0' + '1' = '01'
      // setOptimisticTimeline builds on current _value: '' + '1' = '1'
      setTimeline(x => x + "1");
      setOptimisticTimeline(x => x + "1");

      flush();

      // During transition:
      // - optimisticTimeline shows optimistic override '1'
      // - timeline._pendingValue = '01'
      // - optimisticTimeline should recompute in background to see '01'
      expect(optimisticTimeline()).toBe("1"); // Optimistic value
      expect(timeline()).toBe(""); // Still held during transition
      expect(timelineValues).toEqual(["", "1"]); // Effect sees optimistic value

      // Complete the async
      resolveAsync!();
      await new Promise(r => setTimeout(r, 0));
      flush(); // Ensure transition completion is processed

      // After transition completes:
      // - timeline._value should be '01' (committed)
      // - optimisticTimeline should revert to its computed value '01'
      expect(timeline()).toBe("01");
      expect(optimisticTimeline()).toBe("01"); // Should NOT stay '1'!
      expect(countValues).toEqual([0, 1]);
      expect(timelineValues).toEqual(["", "1", "01"]);
    });
  });

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
          v => {
            values.push(v);
          }
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
          v => {
            values1.push(v);
          }
        );
        createRenderEffect(
          () => $x2(),
          v => {
            values2.push(v);
          }
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

  describe("isPending and latest() with async optimistic", () => {
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
      // latest() returns the optimistic value
      expect(latest($data!)).toBe(20);

      // Source signal is held
      expect($id()).toBe(1); // held during transition
      expect(latest($id)).toBe(2); // in-flight value

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
      // latest() returns the optimistic value
      expect(latest($data!)).toBe(999);

      // After async completes
      await new Promise(r => setTimeout(r, 0));

      // Computed value corrects the optimistic guess
      expect($data!()).toBe(20); // computed: 2 * 10 = 20, not 999
      expect($id()).toBe(2); // committed
      expect(isPending($data!)).toBe(false);
    });
  });

  describe("per-lane optimistic architecture", () => {
    it("independent optimistic writes create separate lanes", () => {
      // Two independent optimistic signals should have separate effect tracking
      const [a, setA] = createOptimistic(1);
      const [b, setB] = createOptimistic(10);

      const aEffects: number[] = [];
      const bEffects: number[] = [];

      createRoot(() => {
        createRenderEffect(
          () => a(),
          v => {
            aEffects.push(v);
          }
        );
        createRenderEffect(
          () => b(),
          v => {
            bEffects.push(v);
          }
        );
      });

      flush();
      expect(aEffects).toEqual([1]);
      expect(bEffects).toEqual([10]);

      // Write to a - should only trigger a's effect
      setA(2);
      flush();
      expect(aEffects).toEqual([1, 2, 1]); // optimistic then revert
      expect(bEffects).toEqual([10]); // unchanged

      // Write to b - should only trigger b's effect
      setB(20);
      flush();
      expect(aEffects).toEqual([1, 2, 1]); // unchanged
      expect(bEffects).toEqual([10, 20, 10]); // optimistic then revert
    });

    it("lanes merge when computed depends on multiple optimistic sources", () => {
      // When a computed reads from two optimistic signals, their lanes merge
      const [a, setA] = createOptimistic(1);
      const [b, setB] = createOptimistic(10);

      const sumEffects: number[] = [];
      let sum: () => number;

      createRoot(() => {
        sum = createMemo(() => a() + b());
        createRenderEffect(
          () => sum(),
          v => {
            sumEffects.push(v);
          }
        );
      });

      flush();
      expect(sum!()).toBe(11);
      expect(sumEffects).toEqual([11]);

      // Write to both - should merge into single lane
      setA(2);
      setB(20);
      flush();

      // Both writes revert together as one lane
      expect(sum!()).toBe(11); // back to original
      expect(sumEffects).toEqual([11, 22, 11]); // combined optimistic then revert
    });

    it("concurrent optimistic writes in same action share a lane", async () => {
      const [value, setValue] = createOptimistic(0);
      const effects: number[] = [];

      createRoot(() => {
        createRenderEffect(
          () => value(),
          v => {
            effects.push(v);
          }
        );
      });

      flush();
      expect(effects).toEqual([0]);

      // Action with multiple optimistic writes
      const myAction = action(function* () {
        setValue(1);
        yield Promise.resolve();
        setValue(2);
        yield Promise.resolve();
      });

      await myAction();
      flush();

      // All writes in the action should be in the same lane/transition
      // Final value should be committed after action completes
      expect(value()).toBe(0); // reverted after transition
    });

    it("optimistic effect runs before regular effect on same node", () => {
      const [value, setValue] = createOptimistic(0);
      const callOrder: string[] = [];

      createRoot(() => {
        // Regular effect
        createRenderEffect(
          () => value(),
          () => {
            callOrder.push("regular");
          }
        );
      });

      flush();
      expect(callOrder).toEqual(["regular"]);

      // Optimistic write should trigger effect immediately (before commit)
      setValue(1);
      flush();

      // Effect runs twice: once for optimistic value, once for reversion
      expect(callOrder).toEqual(["regular", "regular", "regular"]);
    });

    it("nested optimistic computeds propagate through single lane", () => {
      const [source, setSource] = createOptimistic(1);
      const effects: number[] = [];

      let doubled: () => number;
      let quadrupled: () => number;

      createRoot(() => {
        doubled = createMemo(() => source() * 2);
        quadrupled = createMemo(() => doubled() * 2);

        createRenderEffect(
          () => quadrupled(),
          v => {
            effects.push(v);
          }
        );
      });

      flush();
      expect(quadrupled!()).toBe(4);
      expect(effects).toEqual([4]);

      // Single optimistic write propagates through chain
      setSource(10);
      flush();

      expect(quadrupled!()).toBe(4); // reverted
      expect(effects).toEqual([4, 40, 4]); // optimistic: 10*2*2=40, then revert to 4
    });

    it("lane effects run even when transition is stashed", async () => {
      let resolveAsync: () => void;
      const asyncSignal = createMemo(() => {
        return new Promise<number>(res => {
          resolveAsync = () => res(42);
        });
      });

      const [optimistic, setOptimistic] = createOptimistic(0);
      const effects: number[] = [];

      createRoot(() => {
        // This creates a transition due to async
        createRenderEffect(
          () => asyncSignal(),
          () => {}
        );
        // Optimistic effect should still run
        createRenderEffect(
          () => optimistic(),
          v => {
            effects.push(v);
          }
        );
      });

      flush();
      expect(effects).toEqual([0]);

      // Optimistic write during pending transition
      setOptimistic(1);
      flush();

      // Lane effect should run even though transition is stashed
      expect(effects).toEqual([0, 1, 0]); // optimistic then revert

      // Resolve async to complete transition
      resolveAsync!();
      await Promise.resolve();
      flush();
    });

    it("lane reuses existing lane for same signal", () => {
      // Multiple writes to the same optimistic signal should use the same lane
      const [value, setValue] = createOptimistic(0);
      const effects: number[] = [];

      createRoot(() => {
        createRenderEffect(
          () => value(),
          v => {
            effects.push(v);
          }
        );
      });

      flush();
      expect(effects).toEqual([0]);

      // First write
      setValue(1);
      // Second write before flush - should update same lane
      setValue(2);
      flush();

      // Should see final optimistic value, then revert
      expect(effects).toEqual([0, 2, 0]);
    });

    it("cross-lane reads return committed value during optimistic context", async () => {
      // When in one optimistic lane, reading from another lane's pending async
      // should return the committed value (not throw)
      let resolveLaneA: (v: number) => void;

      const [sourceA, setSourceA] = createOptimistic(1);
      const [sourceB, setSourceB] = createOptimistic(10);

      let asyncA: () => number;
      const effectValues: Array<{ a: number; b: number }> = [];

      createRoot(() => {
        // Async computed in "lane A" context
        asyncA = createMemo(() => {
          const v = sourceA();
          return new Promise<number>(res => {
            resolveLaneA = () => res(v * 2);
          });
        });

        // Effect that reads from both async and another optimistic signal
        createRenderEffect(
          () => ({ a: sourceA(), b: sourceB() }),
          v => {
            effectValues.push(v);
          }
        );

        // Subscribe to async to trigger it
        createRenderEffect(asyncA, () => {});
      });

      flush();
      expect(effectValues).toEqual([{ a: 1, b: 10 }]);

      // Write to sourceB (creates separate lane)
      // Since asyncA is pending in a different lane, sourceB's effect should still run
      setSourceB(20);
      flush();

      // Effect should see optimistic B value
      expect(effectValues).toEqual([
        { a: 1, b: 10 },
        { a: 1, b: 20 },
        { a: 1, b: 10 } // revert
      ]);

      // Resolve async
      resolveLaneA!(2);
      await Promise.resolve();
      flush();
    });
  });

  describe("async chain: signal -> async memo -> optimistic -> async memo -> effect", () => {
    // Helper to create the test setup
    // Chain: source -> firstAsync (source * 10) -> optimistic -> secondAsync (passthrough) -> effect
    function createAsyncChain() {
      // Source signal
      const [source, setSource] = createSignal(1);

      // First async memo: source * 10
      let resolveFirst: (() => void) | null = null;
      let firstAsyncValue = 0;
      const firstAsync = createMemo(() => {
        const v = source();
        firstAsyncValue = v * 10;
        return new Promise<number>(res => {
          resolveFirst = () => res(firstAsyncValue);
        });
      });

      // Optimistic node wrapping first async
      const [optimistic, setOptimistic] = createOptimistic(() => firstAsync());

      // Second async memo: passthrough (simulates async data transformation)
      let resolveSecond: (() => void) | null = null;
      let secondAsyncValue = 0;
      const secondAsync = createMemo(() => {
        const v = optimistic();
        secondAsyncValue = v; // Just pass through the value
        return new Promise<number>(res => {
          resolveSecond = () => res(secondAsyncValue);
        });
      });

      const effectValues: number[] = [];

      return {
        source,
        setSource,
        firstAsync,
        resolveFirst: () => resolveFirst?.(),
        optimistic,
        setOptimistic,
        secondAsync,
        resolveSecond: () => resolveSecond?.(),
        effectValues,
        setup: () => {
          createRenderEffect(secondAsync, v => {
            effectValues.push(v);
          });
        }
      };
    }

    it("first async resolves first, optimistic value matches computed result", async () => {
      const chain = createAsyncChain();

      createRoot(() => {
        chain.setup();
      });

      flush();
      // Both asyncs pending, no effect values yet
      expect(chain.effectValues).toEqual([]);

      // Resolve first async (gives 10)
      chain.resolveFirst();
      await Promise.resolve();
      flush();

      // First resolved, second still pending
      expect(chain.effectValues).toEqual([]);

      // Resolve second async (gives 10, passthrough)
      chain.resolveSecond();
      await Promise.resolve();
      flush();

      // Chain complete: 1 * 10 = 10
      expect(chain.effectValues).toEqual([10]);
      expect(chain.secondAsync()).toBe(10);

      // Now: same-tick update of source AND optimistic override
      // Source: 1 -> 2, expected chain result: 2 * 10 = 20
      chain.setSource(2);
      chain.setOptimistic(20); // Correct guess!
      flush();

      // Effect hasn't fired yet - secondAsync needs to resolve with optimistic input
      expect(chain.optimistic()).toBe(20);
      expect(chain.effectValues).toEqual([10]);

      // Resolve second async first (lane becomes ready!)
      // The optimistic lane can flush BEFORE firstAsync resolves
      chain.resolveSecond();
      await Promise.resolve();
      flush();

      // Lane flushed with optimistic value, even though firstAsync still pending
      expect(chain.effectValues).toEqual([10, 20]);
      expect(isPending(chain.firstAsync)).toBe(true); // first still pending!

      // Now resolve first async (gives 20)
      chain.resolveFirst();
      await Promise.resolve();
      flush();

      // Resolve the new second async (gives 20 - matches optimistic!)
      chain.resolveSecond();
      await Promise.resolve();
      flush();

      // Optimistic was correct, value stays 20
      expect(chain.secondAsync()).toBe(20);
      expect(chain.optimistic()).toBe(20);
      // No additional effect since value matched
      expect(chain.effectValues).toEqual([10, 20]);
    });

    it("first async resolves first, optimistic value does NOT match computed result", async () => {
      const chain = createAsyncChain();

      createRoot(() => {
        chain.setup();
      });

      flush();

      // Resolve initial chain
      chain.resolveFirst();
      await Promise.resolve();
      flush();
      chain.resolveSecond();
      await Promise.resolve();
      flush();

      expect(chain.effectValues).toEqual([10]);

      // Same-tick update with WRONG optimistic guess
      chain.setSource(2);
      chain.setOptimistic(999); // Wrong guess! (correct would be 20)
      flush();

      // Optimistic set but effect hasn't fired - secondAsync still pending
      expect(chain.optimistic()).toBe(999);
      expect(chain.effectValues).toEqual([10]);

      // Resolve second async (lane ready, flushes with optimistic value 999)
      chain.resolveSecond();
      await Promise.resolve();
      flush();

      // Effect sees optimistic value, firstAsync still pending
      expect(chain.effectValues).toEqual([10, 999]);
      expect(isPending(chain.firstAsync)).toBe(true);

      // Resolve first async (gives 20)
      chain.resolveFirst();
      await Promise.resolve();
      flush();

      // Resolve the new second async (gives 20 - doesn't match 999!)
      chain.resolveSecond();
      await Promise.resolve();
      flush();

      // Auto-correction: optimistic reverts to computed value
      expect(chain.secondAsync()).toBe(20);
      expect(chain.optimistic()).toBe(20);
      // Effect sees correction
      expect(chain.effectValues).toEqual([10, 999, 20]);
    });

    it("second async resolves first, optimistic value matches", async () => {
      const chain = createAsyncChain();

      createRoot(() => {
        chain.setup();
      });

      flush();

      // Resolve initial chain
      chain.resolveFirst();
      await Promise.resolve();
      flush();
      chain.resolveSecond();
      await Promise.resolve();
      flush();

      expect(chain.effectValues).toEqual([10]);

      // Same-tick update
      chain.setSource(2);
      chain.setOptimistic(20); // Correct guess
      flush();

      // Effect hasn't fired yet - secondAsync pending
      expect(chain.effectValues).toEqual([10]);

      // Resolve second async (lane ready!)
      chain.resolveSecond();
      await Promise.resolve();
      flush();

      // Lane flushed, effect sees optimistic value
      expect(chain.effectValues).toEqual([10, 20]);
      expect(chain.optimistic()).toBe(20);
      expect(isPending(chain.firstAsync)).toBe(true); // first still pending

      // Now resolve first
      chain.resolveFirst();
      await Promise.resolve();
      flush();

      // Resolve the new second async (gives 20 - matches!)
      chain.resolveSecond();
      await Promise.resolve();
      flush();

      // Both resolved, optimistic was correct - no additional effect
      expect(chain.secondAsync()).toBe(20);
      expect(chain.effectValues).toEqual([10, 20]);
    });

    it("second async resolves first, optimistic value does NOT match", async () => {
      const chain = createAsyncChain();

      createRoot(() => {
        chain.setup();
      });

      flush();

      // Resolve initial chain
      chain.resolveFirst();
      await Promise.resolve();
      flush();
      chain.resolveSecond();
      await Promise.resolve();
      flush();

      expect(chain.effectValues).toEqual([10]);

      // Same-tick update with wrong guess
      chain.setSource(2);
      chain.setOptimistic(999); // Wrong!
      flush();

      // Effect hasn't fired - secondAsync pending
      expect(chain.effectValues).toEqual([10]);

      // Resolve second async (lane ready with optimistic value)
      chain.resolveSecond();
      await Promise.resolve();
      flush();

      // Lane flushed with optimistic value 999
      expect(chain.effectValues).toEqual([10, 999]);
      expect(isPending(chain.firstAsync)).toBe(true);

      // Now resolve first
      chain.resolveFirst();
      await Promise.resolve();
      flush();

      // Resolve the new second async (gives 20 - doesn't match 999!)
      chain.resolveSecond();
      await Promise.resolve();
      flush();

      // Auto-correction happens
      expect(chain.secondAsync()).toBe(20);
      expect(chain.effectValues).toEqual([10, 999, 20]);
    });

    it("only first async resolves, second stays pending", async () => {
      const chain = createAsyncChain();

      createRoot(() => {
        chain.setup();
      });

      flush();

      // Resolve initial chain
      chain.resolveFirst();
      await Promise.resolve();
      flush();
      chain.resolveSecond();
      await Promise.resolve();
      flush();

      expect(chain.effectValues).toEqual([10]);

      // Same-tick update
      chain.setSource(2);
      chain.setOptimistic(20);
      flush();

      // Effect hasn't fired - secondAsync pending
      expect(chain.effectValues).toEqual([10]);

      // Only resolve first async (not second)
      chain.resolveFirst();
      await Promise.resolve();
      flush();

      // First resolved, but the lane's secondAsync still pending
      // Optimistic is set but lane hasn't flushed yet
      expect(chain.optimistic()).toBe(20);
      expect(isPending(chain.secondAsync)).toBe(true);
      expect(chain.effectValues).toEqual([10]);

      // Now resolve second - lane becomes ready
      chain.resolveSecond();
      await Promise.resolve();
      flush();

      // Lane flushed with optimistic value
      expect(chain.effectValues).toEqual([10, 20]);

      // Resolve the new second async from upstream resolution
      chain.resolveSecond();
      await Promise.resolve();
      flush();

      expect(chain.secondAsync()).toBe(20);
      expect(isPending(chain.secondAsync)).toBe(false);
    });

    it("multiple user actions before any async resolves", async () => {
      const chain = createAsyncChain();

      createRoot(() => {
        chain.setup();
      });

      flush();

      // Resolve initial chain
      chain.resolveFirst();
      await Promise.resolve();
      flush();
      chain.resolveSecond();
      await Promise.resolve();
      flush();

      expect(chain.effectValues).toEqual([10]);

      // First user action
      chain.setSource(2);
      chain.setOptimistic(20);
      flush();

      // Effect hasn't fired - secondAsync pending
      expect(chain.effectValues).toEqual([10]);

      // Resolve second async - lane ready with first optimistic value
      chain.resolveSecond();
      await Promise.resolve();
      flush();

      expect(chain.effectValues).toEqual([10, 20]);

      // Second user action before first async resolves
      chain.setSource(3);
      chain.setOptimistic(30); // Guess for 3 * 10
      flush();

      // Effect hasn't updated yet - new secondAsync pending
      expect(chain.optimistic()).toBe(30);
      expect(chain.effectValues).toEqual([10, 20]);

      // Resolve second async - lane ready with new optimistic value
      chain.resolveSecond();
      await Promise.resolve();
      flush();

      expect(chain.effectValues).toEqual([10, 20, 30]);

      // Resolve first async
      chain.resolveFirst();
      await Promise.resolve();
      flush();

      // Resolve the final second async (gives 30 - matches!)
      chain.resolveSecond();
      await Promise.resolve();
      flush();

      // Final value: 3 * 10 = 30 (matches optimistic)
      expect(chain.secondAsync()).toBe(30);
      expect(chain.effectValues).toEqual([10, 20, 30]);
    });

    it("transition holds when upstream resolves first - pending source does not leak", async () => {
      // Same chain: source -> firstAsync -> optimistic -> secondAsync -> effect
      // Plus: source -> sourceEffect (to detect pending value leaks)
      //
      // When upstream async resolves first with matching optimistic, the override stays.
      // But the transition must NOT complete until downstream async also resolves,
      // otherwise source's held pending value leaks to sourceEffect.

      const [source, setSource] = createSignal(1);

      let resolveFirst: (() => void) | null = null;
      let firstAsyncValue = 0;
      const firstAsync = createMemo(() => {
        const v = source();
        firstAsyncValue = v * 10;
        return new Promise<number>(res => {
          resolveFirst = () => res(firstAsyncValue);
        });
      });

      const [optimistic, setOptimistic] = createOptimistic(() => firstAsync());

      let resolveSecond: (() => void) | null = null;
      let secondAsyncValue = 0;
      const secondAsync = createMemo(() => {
        const v = optimistic();
        secondAsyncValue = v;
        return new Promise<number>(res => {
          resolveSecond = () => res(secondAsyncValue);
        });
      });

      const effectValues: number[] = [];
      const sourceValues: number[] = [];

      createRoot(() => {
        createRenderEffect(secondAsync, v => {
          effectValues.push(v);
        });
        createRenderEffect(source, v => {
          sourceValues.push(v);
        });
      });

      // Initial load
      flush();
      resolveFirst!();
      await Promise.resolve();
      flush();
      resolveSecond!();
      await Promise.resolve();
      flush();

      expect(effectValues).toEqual([10]);
      expect(sourceValues).toEqual([1]);

      // Set source + matching optimistic in same tick
      setSource(2);
      setOptimistic(20); // Correct guess: 2 * 10 = 20
      flush();

      // Both asyncs re-fired, transition started
      // Source is held during transition
      expect(optimistic()).toBe(20);
      expect(sourceValues).toEqual([1]); // Source held, not leaked
      expect(effectValues).toEqual([10]); // Lane async still pending

      // Resolve UPSTREAM async first (gives 20 - matches optimistic!)
      resolveFirst!();
      await Promise.resolve();
      flush();

      // CRITICAL: Transition must NOT complete here.
      // If it did, source's pending value (2) would leak to sourceEffect.
      expect(sourceValues).toEqual([1]); // Source still held!
      expect(optimistic()).toBe(20); // Override still in place
      expect(effectValues).toEqual([10]); // Lane async still pending

      // Now resolve DOWNSTREAM async (lane becomes ready)
      resolveSecond!();
      await Promise.resolve();
      flush();

      // Lane flushed - effect sees optimistic value
      expect(effectValues).toEqual([10, 20]);
      // Both asyncNodes now resolved, transition completes, source commits
      expect(sourceValues).toEqual([1, 2]);
      expect(optimistic()).toBe(20);
    });

    it("two full cycles - lanes clean up properly between transitions", async () => {
      const chain = createAsyncChain();

      createRoot(() => {
        chain.setup();
      });

      // --- Initial load ---
      flush();
      chain.resolveFirst();
      await Promise.resolve();
      flush();
      chain.resolveSecond();
      await Promise.resolve();
      flush();

      expect(chain.effectValues).toEqual([10]);
      expect(chain.secondAsync()).toBe(10);

      // === CYCLE 1: source 1 -> 2, optimistic 20 (correct guess) ===
      chain.setSource(2);
      chain.setOptimistic(20);
      flush();

      expect(chain.optimistic()).toBe(20);
      expect(chain.effectValues).toEqual([10]);

      // Resolve second async (lane ready, flushes with optimistic value)
      chain.resolveSecond();
      await Promise.resolve();
      flush();

      expect(chain.effectValues).toEqual([10, 20]);

      // Resolve first async (upstream catches up)
      chain.resolveFirst();
      await Promise.resolve();
      flush();

      // Resolve the re-fired second async (matches optimistic)
      chain.resolveSecond();
      await Promise.resolve();
      flush();

      // Cycle 1 complete: transition committed, value 20
      expect(chain.secondAsync()).toBe(20);
      expect(chain.optimistic()).toBe(20);
      expect(chain.effectValues).toEqual([10, 20]);

      // === CYCLE 2: source 2 -> 3, optimistic 30 (correct guess) ===
      // This tests that all lane state was properly cleaned up
      chain.setSource(3);
      chain.setOptimistic(30);
      flush();

      // Optimistic override should work on the second cycle
      expect(chain.optimistic()).toBe(30);
      expect(chain.effectValues).toEqual([10, 20]);

      // Resolve second async (lane ready)
      chain.resolveSecond();
      await Promise.resolve();
      flush();

      // Lane should flush with optimistic value on second cycle too
      expect(chain.effectValues).toEqual([10, 20, 30]);

      // Resolve first async
      chain.resolveFirst();
      await Promise.resolve();
      flush();

      // Resolve re-fired second async (matches optimistic)
      chain.resolveSecond();
      await Promise.resolve();
      flush();

      // Cycle 2 complete: everything consistent
      expect(chain.secondAsync()).toBe(30);
      expect(chain.optimistic()).toBe(30);
      expect(chain.effectValues).toEqual([10, 20, 30]);
    });

    it("two full cycles with mismatch correction on second cycle", async () => {
      const chain = createAsyncChain();

      createRoot(() => {
        chain.setup();
      });

      // --- Initial load ---
      flush();
      chain.resolveFirst();
      await Promise.resolve();
      flush();
      chain.resolveSecond();
      await Promise.resolve();
      flush();

      expect(chain.effectValues).toEqual([10]);

      // === CYCLE 1: matching optimistic ===
      chain.setSource(2);
      chain.setOptimistic(20);
      flush();

      chain.resolveSecond();
      await Promise.resolve();
      flush();
      expect(chain.effectValues).toEqual([10, 20]);

      chain.resolveFirst();
      await Promise.resolve();
      flush();
      chain.resolveSecond();
      await Promise.resolve();
      flush();

      expect(chain.effectValues).toEqual([10, 20]);

      // === CYCLE 2: WRONG optimistic guess ===
      chain.setSource(3);
      chain.setOptimistic(999); // Wrong!
      flush();

      expect(chain.optimistic()).toBe(999);

      // Resolve second async (lane ready with wrong value)
      chain.resolveSecond();
      await Promise.resolve();
      flush();

      // Lane flushed with wrong optimistic value
      expect(chain.effectValues).toEqual([10, 20, 999]);

      // Resolve first async (gives 30, corrects the optimistic)
      chain.resolveFirst();
      await Promise.resolve();
      flush();

      // Resolve the corrected second async (gives 30, not 999!)
      chain.resolveSecond();
      await Promise.resolve();
      flush();

      // Correction applied: effect sees the real value
      expect(chain.secondAsync()).toBe(30);
      expect(chain.optimistic()).toBe(30);
      expect(chain.effectValues).toEqual([10, 20, 999, 30]);
    });
  });

  describe("async chain with isPending (nested lanes)", () => {
    // Same chain structure but with an additional isPending effect
    // This tests nested lanes since isPending creates an optimistic computed
    // Chain: source -> firstAsync -> optimistic -> secondAsync -> effect
    //                                    |
    //                                    +-> isPending -> effect (nested lane)
    function createAsyncChainWithPending() {
      // Source signal
      const [source, setSource] = createSignal(1);

      // First async memo: source * 10
      let resolveFirst: (() => void) | null = null;
      let firstAsyncValue = 0;
      const firstAsync = createMemo(() => {
        const v = source();
        firstAsyncValue = v * 10;
        return new Promise<number>(res => {
          resolveFirst = () => res(firstAsyncValue);
        });
      });

      // Optimistic node wrapping first async
      const [optimistic, setOptimistic] = createOptimistic(() => firstAsync());

      // Second async memo: passthrough
      let resolveSecond: (() => void) | null = null;
      let secondAsyncValue = 0;
      const secondAsync = createMemo(() => {
        const v = optimistic();
        secondAsyncValue = v;
        return new Promise<number>(res => {
          resolveSecond = () => res(secondAsyncValue);
        });
      });

      const effectValues: number[] = [];
      const pendingValues: boolean[] = [];

      return {
        source,
        setSource,
        firstAsync,
        resolveFirst: () => resolveFirst?.(),
        optimistic,
        setOptimistic,
        secondAsync,
        resolveSecond: () => resolveSecond?.(),
        effectValues,
        pendingValues,
        setup: () => {
          // Main effect on secondAsync
          createRenderEffect(secondAsync, v => {
            effectValues.push(v);
          });
          // Additional effect on isPending(optimistic) - creates nested lane
          createRenderEffect(
            () => isPending(optimistic),
            v => {
              pendingValues.push(v);
            }
          );
        }
      };
    }

    it("isPending tracks optimistic node state alongside value effects", async () => {
      const chain = createAsyncChainWithPending();

      createRoot(() => {
        chain.setup();
      });

      flush();

      // Initial: both asyncs pending, but isPending returns false for initial loads
      // (no stale data to show yet)
      expect(chain.effectValues).toEqual([]);
      expect(chain.pendingValues).toEqual([false]); // Initial load - not "pending"

      // Resolve first async (gives 10)
      chain.resolveFirst();
      await Promise.resolve();
      flush();

      // First resolved, second still pending (but still initial load)
      expect(chain.effectValues).toEqual([]);
      expect(chain.pendingValues).toEqual([false]);

      // Resolve second async
      chain.resolveSecond();
      await Promise.resolve();
      flush();

      // Chain complete - now we have data
      expect(chain.effectValues).toEqual([10]);
      expect(chain.pendingValues).toEqual([false]); // No change, wasn't pending

      // Same-tick update with optimistic
      chain.setSource(2);
      chain.setOptimistic(20);
      flush();

      // Optimistic is set - NOW we're pending (have stale data, loading new)
      expect(chain.optimistic()).toBe(20);
      expect(chain.pendingValues).toEqual([false, true]); // Now pending!

      // Resolve second async (lane ready)
      chain.resolveSecond();
      await Promise.resolve();
      flush();

      // Lane flushed with optimistic value
      expect(chain.effectValues).toEqual([10, 20]);
      expect(isPending(chain.firstAsync)).toBe(true); // firstAsync still pending

      // Resolve first async
      chain.resolveFirst();
      await Promise.resolve();
      flush();

      // Resolve the new second async
      chain.resolveSecond();
      await Promise.resolve();
      flush();

      // All resolved, values match
      expect(chain.effectValues).toEqual([10, 20]);
      expect(chain.secondAsync()).toBe(20);
      expect(chain.pendingValues).toEqual([false, true, false]); // Back to not pending
    });

    it("isPending shows optimistic pending state during mismatch correction", async () => {
      const chain = createAsyncChainWithPending();

      createRoot(() => {
        chain.setup();
      });

      flush();

      // Initial resolution (isPending = false for initial loads)
      chain.resolveFirst();
      await Promise.resolve();
      flush();
      chain.resolveSecond();
      await Promise.resolve();
      flush();

      expect(chain.effectValues).toEqual([10]);
      expect(chain.pendingValues).toEqual([false]); // Initial load complete

      // Same-tick update with WRONG optimistic guess
      chain.setSource(2);
      chain.setOptimistic(999); // Wrong!
      flush();

      expect(chain.pendingValues).toEqual([false, true]); // Now pending (have stale data)

      // Resolve second async (lane flushes with wrong value)
      chain.resolveSecond();
      await Promise.resolve();
      flush();

      expect(chain.effectValues).toEqual([10, 999]);

      // Resolve first async (gives 20, triggers correction)
      chain.resolveFirst();
      await Promise.resolve();
      flush();

      // Resolve corrected second async
      chain.resolveSecond();
      await Promise.resolve();
      flush();

      // Corrected value
      expect(chain.effectValues).toEqual([10, 999, 20]);
      expect(chain.secondAsync()).toBe(20);
      expect(chain.pendingValues).toEqual([false, true, false]); // Back to not pending
    });

    it("multiple isPending effects track independently", async () => {
      const [source, setSource] = createSignal(1);

      let resolveFirst: (() => void) | null = null;
      const firstAsync = createMemo(() => {
        const v = source();
        return new Promise<number>(res => {
          resolveFirst = () => res(v * 10);
        });
      });

      const [optimistic, setOptimistic] = createOptimistic(() => firstAsync());

      let resolveSecond: (() => void) | null = null;
      const secondAsync = createMemo(() => {
        const v = optimistic();
        return new Promise<number>(res => {
          resolveSecond = () => res(v);
        });
      });

      const pendingOptimistic: boolean[] = [];
      const pendingSecond: boolean[] = [];
      const values: number[] = [];

      createRoot(() => {
        // Three separate effects - tests lane routing
        createRenderEffect(
          () => isPending(optimistic),
          v => {
            pendingOptimistic.push(v);
          }
        );
        createRenderEffect(
          () => isPending(secondAsync),
          v => {
            pendingSecond.push(v);
          }
        );
        createRenderEffect(secondAsync, v => {
          values.push(v);
        });
      });

      flush();

      // Initial load - isPending is false (no stale data yet)
      expect(pendingOptimistic).toEqual([false]);
      expect(pendingSecond).toEqual([false]);
      expect(values).toEqual([]);

      // Resolve first
      resolveFirst!();
      await Promise.resolve();
      flush();

      // optimistic resolved, secondAsync still initial loading
      expect(pendingOptimistic).toEqual([false]);
      expect(pendingSecond).toEqual([false]);

      // Resolve second
      resolveSecond!();
      await Promise.resolve();
      flush();

      // Initial load complete
      // Note: secondAsync may have intermediate pending states as it processes
      expect(pendingOptimistic).toEqual([false]);
      expect(pendingSecond.at(-1)).toBe(false); // Ends not pending
      expect(values).toEqual([10]);

      // Record the state before optimistic update
      const pendingOptimisticBefore = pendingOptimistic.length;
      const pendingSecondBefore = pendingSecond.length;

      // Optimistic update - NOW we have stale data, so isPending = true
      setSource(2);
      setOptimistic(20);
      flush();

      // Both should go to pending (have stale data, loading new)
      expect(pendingOptimistic.at(-1)).toBe(true);
      expect(pendingSecond.at(-1)).toBe(true);

      // Resolve second (lane flushes)
      resolveSecond!();
      await Promise.resolve();
      flush();

      expect(values).toEqual([10, 20]);
      // secondAsync resolved in lane
      expect(pendingSecond.at(-1)).toBe(false);
      // optimistic still pending (firstAsync not resolved)
      expect(pendingOptimistic.at(-1)).toBe(true);

      // Resolve first
      resolveFirst!();
      await Promise.resolve();
      flush();

      // Resolve new second
      resolveSecond!();
      await Promise.resolve();
      flush();

      // Final state: not pending
      expect(pendingOptimistic.at(-1)).toBe(false);
      expect(values).toEqual([10, 20]);
    });
  });

  describe("real-world pattern: userPreference -> optimistic -> categoryDetails", () => {
    // This test mirrors a common real-world pattern:
    //
    // userCategory (async) ─→ optimisticCategory ─┬─→ select value (effect)
    //                                             │
    //                                             └─→ categoryData (async) ─→ list (effect)
    //                                                        │
    //                                                        └─→ isPending (effect)
    //
    // Action pattern: setOptimistic → yield api.update → refresh(source)

    it("action pattern: setOptimistic -> yield api -> refresh", async () => {
      // Simulated database
      let dbUserCategory = "News";
      const categoryItems: Record<string, string[]> = {
        News: ["Daily Brief", "World Report"],
        Finance: ["Stock Ticker", "Market Analysis"],
        Sports: ["Live Scores", "Match Highlights"]
      };

      // API resolvers (simulating async API calls)
      let resolveUserCategory: ((v: string) => void) | null = null;
      let resolveUpdateCategory: (() => void) | null = null;
      let resolveCategoryDetails: ((v: string[]) => void) | null = null;

      // userCategory: async memo fetching user preference
      const userCategory = createMemo(() => {
        return new Promise<string>(res => {
          resolveUserCategory = (v: string) => res(v);
        });
      });

      // optimisticCategory: wraps userCategory
      const [optimisticCategory, setOptimisticCategory] = createOptimistic(() => userCategory());

      // categoryData: async memo that fetches details based on optimisticCategory
      // This is like the CategoryDisplay component's internal memo
      const categoryData = createMemo(() => {
        optimisticCategory(); // Read to establish dependency
        return new Promise<string[]>(res => {
          resolveCategoryDetails = (items: string[]) => res(items);
        });
      });

      // Track rendered values
      const selectedValues: string[] = [];
      const categoryDataValues: string[][] = [];
      const pendingStates: boolean[] = [];

      createRoot(() => {
        // Effect for select value (like the select element binding)
        createRenderEffect(optimisticCategory, v => {
          selectedValues.push(v);
        });
        // Effect for category data list
        createRenderEffect(categoryData, v => {
          categoryDataValues.push(v);
        });
        // Effect for isPending state
        createRenderEffect(
          () => isPending(categoryData),
          v => {
            pendingStates.push(v);
          }
        );
      });

      flush();

      // Initial state: everything pending (initial load)
      expect(selectedValues).toEqual([]);
      expect(categoryDataValues).toEqual([]);
      expect(pendingStates).toEqual([false]); // Initial load, no stale data

      // Resolve initial userCategory fetch
      resolveUserCategory!(dbUserCategory); // "News"
      await Promise.resolve();
      flush();

      // userCategory resolved, categoryData still loading
      expect(selectedValues).toEqual([]);

      // Resolve initial categoryData fetch
      resolveCategoryDetails!(categoryItems["News"]);
      await Promise.resolve();
      flush();

      // Initial load complete
      expect(selectedValues).toEqual(["News"]);
      expect(categoryDataValues).toEqual([["Daily Brief", "World Report"]]);
      expect(pendingStates.at(-1)).toBe(false);

      // === USER ACTION: Select "Finance" ===
      // Use action() to keep transition open during the entire operation
      let resolveApiUpdate: (() => void) | null = null;
      const handleSelect = action(function* (category: string) {
        // Step 1: Set optimistic value immediately
        setOptimisticCategory(category);

        // Step 2: Wait for API update (simulated async)
        yield new Promise<void>(r => {
          resolveApiUpdate = r;
        });

        // Step 3: Refresh source to get server-confirmed value
        refresh(userCategory);
      });

      // Start the action (like user selecting "Finance")
      handleSelect("Finance");
      flush();

      // Direct read shows optimistic value immediately
      expect(optimisticCategory()).toBe("Finance");
      // Lane effects wait for pendingAsync (categoryData) to resolve
      expect(selectedValues).toEqual(["News"]); // Effect hasn't fired yet

      // CRITICAL: isPending should fire IMMEDIATELY when categoryData starts loading
      // (isPending has its own lane that can flush without waiting for categoryData)
      expect(pendingStates.at(-1)).toBe(true);

      // categoryData resolves with Finance data (optimistic path)
      resolveCategoryDetails!(categoryItems["Finance"]);
      await Promise.resolve();
      flush();

      // Lane effects fire with optimistic value
      expect(optimisticCategory()).toBe("Finance");
      expect(selectedValues.at(-1)).toBe("Finance");
      expect(categoryDataValues).toEqual([
        ["Daily Brief", "World Report"],
        ["Stock Ticker", "Market Analysis"]
      ]);

      // Step 2 completes: API update done, server confirms "Finance"
      dbUserCategory = "Finance";
      resolveApiUpdate!();
      await Promise.resolve();
      flush();

      // refresh(userCategory) was called - userCategory starts refetching
      // Optimistic value should still show during refetch
      expect(optimisticCategory()).toBe("Finance");

      // CRITICAL: isPending should remain false - the optimistic override blocks
      // the pending state from propagating. categoryData doesn't need to refetch
      // because optimisticCategory still returns "Finance".
      expect(pendingStates.at(-1)).toBe(false);

      // Resolve the refreshed userCategory
      resolveUserCategory!("Finance"); // Server confirms Finance
      await Promise.resolve();
      flush();

      // categoryData also recomputes with new promise
      resolveCategoryDetails!(categoryItems["Finance"]);
      await Promise.resolve();
      flush();

      // Everything resolved, optimistic matches actual
      expect(optimisticCategory()).toBe("Finance");
      expect(selectedValues.at(-1)).toBe("Finance");
      expect(categoryDataValues.at(-1)).toEqual(["Stock Ticker", "Market Analysis"]);
      // Final pending state should be false
      expect(pendingStates.at(-1)).toBe(false);
    });

    it("action pattern with mismatch: server returns different value", async () => {
      // Same setup but server returns a different value than optimistic guess
      let dbUserCategory = "News";
      const categoryItems: Record<string, string[]> = {
        News: ["Daily Brief", "World Report"],
        Finance: ["Stock Ticker", "Market Analysis"],
        Sports: ["Live Scores", "Match Highlights"]
      };

      let resolveUserCategory: ((v: string) => void) | null = null;
      let resolveCategoryDetails: ((v: string[]) => void) | null = null;

      const userCategory = createMemo(() => {
        return new Promise<string>(res => {
          resolveUserCategory = (v: string) => res(v);
        });
      });

      const [optimisticCategory, setOptimisticCategory] = createOptimistic(() => userCategory());

      const categoryData = createMemo(() => {
        optimisticCategory(); // Read to establish dependency
        return new Promise<string[]>(res => {
          resolveCategoryDetails = (items: string[]) => res(items);
        });
      });

      const selectedValues: string[] = [];
      const categoryDataValues: string[][] = [];

      createRoot(() => {
        createRenderEffect(optimisticCategory, v => {
          selectedValues.push(v);
        });
        createRenderEffect(categoryData, v => {
          categoryDataValues.push(v);
        });
      });

      flush();

      // Initial load
      resolveUserCategory!(dbUserCategory);
      await Promise.resolve();
      flush();
      resolveCategoryDetails!(categoryItems["News"]);
      await Promise.resolve();
      flush();

      expect(selectedValues).toEqual(["News"]);

      // Without action: test correction like async chain tests
      // User selects "Finance" optimistically
      setOptimisticCategory("Finance");
      flush();

      // Direct read shows optimistic value
      expect(optimisticCategory()).toBe("Finance");
      // Lane effects wait for async
      expect(selectedValues).toEqual(["News"]);

      // Resolve optimistic categoryData (lane becomes ready)
      resolveCategoryDetails!(categoryItems["Finance"]);
      await Promise.resolve();
      flush();

      // Lane effects fire with optimistic value
      expect(selectedValues.at(-1)).toBe("Finance");
      expect(categoryDataValues).toEqual([
        ["Daily Brief", "World Report"],
        ["Stock Ticker", "Market Analysis"]
      ]);

      // Server update FAILS - refresh source with different value
      refresh(userCategory);
      flush();

      // Source refetching, resolve with "News" (mismatch!)
      resolveUserCategory!("News");
      await Promise.resolve();
      flush();

      // categoryData recomputes with corrected value, resolve it
      resolveCategoryDetails!(categoryItems["News"]);
      await Promise.resolve();
      flush();

      // Full correction visible - optimistic corrected to "News"
      expect(optimisticCategory()).toBe("News");
      expect(selectedValues.at(-1)).toBe("News");
      expect(categoryDataValues.at(-1)).toEqual(["Daily Brief", "World Report"]);
    });

    it("rapid user actions: multiple selections before first resolves", async () => {
      let dbUserCategory = "News";
      const categoryItems: Record<string, string[]> = {
        News: ["Daily Brief"],
        Finance: ["Stock Ticker"],
        Sports: ["Live Scores"]
      };

      let resolveUserCategory: ((v: string) => void) | null = null;
      let resolveCategoryDetails: ((v: string[]) => void) | null = null;

      const userCategory = createMemo(() => {
        return new Promise<string>(res => {
          resolveUserCategory = (v: string) => res(v);
        });
      });

      const [optimisticCategory, setOptimisticCategory] = createOptimistic(() => userCategory());

      const categoryData = createMemo(() => {
        optimisticCategory(); // Read to establish dependency
        return new Promise<string[]>(res => {
          resolveCategoryDetails = (items: string[]) => res(items);
        });
      });

      const selectedValues: string[] = [];
      const categoryDataValues: string[][] = [];

      createRoot(() => {
        createRenderEffect(optimisticCategory, v => {
          selectedValues.push(v);
        });
        createRenderEffect(categoryData, v => {
          categoryDataValues.push(v);
        });
      });

      flush();

      // Initial load
      resolveUserCategory!(dbUserCategory);
      await Promise.resolve();
      flush();
      resolveCategoryDetails!(categoryItems["News"]);
      await Promise.resolve();
      flush();

      expect(selectedValues).toEqual(["News"]);

      // User rapidly selects Finance, then Sports (before anything resolves)
      setOptimisticCategory("Finance");
      flush();

      // Direct read shows optimistic, effect waits
      expect(optimisticCategory()).toBe("Finance");
      expect(selectedValues).toEqual(["News"]);

      setOptimisticCategory("Sports");
      flush();

      // Direct read shows latest optimistic
      expect(optimisticCategory()).toBe("Sports");
      expect(selectedValues).toEqual(["News"]); // Still waiting

      // Resolve categoryData for Sports (the current optimistic value)
      resolveCategoryDetails!(categoryItems["Sports"]);
      await Promise.resolve();
      flush();

      // Lane effects fire with final value
      expect(selectedValues.at(-1)).toBe("Sports");
      expect(categoryDataValues.at(-1)).toEqual(["Live Scores"]);

      // Server confirms Sports
      dbUserCategory = "Sports";
      refresh(userCategory);
      flush();

      resolveUserCategory!("Sports");
      await Promise.resolve();
      flush();

      resolveCategoryDetails!(categoryItems["Sports"]);
      await Promise.resolve();
      flush();

      // Final state: Sports
      expect(optimisticCategory()).toBe("Sports");
      expect(selectedValues.at(-1)).toBe("Sports");
    });

    it("two full cycles with action+refresh - lanes clean up between transitions", async () => {
      let dbUserCategory = "News";
      const categoryItems: Record<string, string[]> = {
        News: ["Daily Brief"],
        Finance: ["Stock Ticker"],
        Sports: ["Live Scores"]
      };

      let resolveUserCategory: ((v: string) => void) | null = null;
      let resolveUpdateCategory: (() => void) | null = null;
      let resolveCategoryDetails: ((v: string[]) => void) | null = null;

      const userCategory = createMemo(() => {
        return new Promise<string>(res => {
          resolveUserCategory = (v: string) => res(v);
        });
      });

      const [optimisticCategory, setOptimisticCategory] = createOptimistic(() => userCategory());

      const categoryData = createMemo(() => {
        optimisticCategory();
        return new Promise<string[]>(res => {
          resolveCategoryDetails = (items: string[]) => res(items);
        });
      });

      const selectedValues: string[] = [];
      const categoryDataValues: string[][] = [];

      createRoot(() => {
        createRenderEffect(optimisticCategory, v => {
          selectedValues.push(v);
        });
        createRenderEffect(categoryData, v => {
          categoryDataValues.push(v);
        });
      });

      flush();

      // Initial load
      resolveUserCategory!(dbUserCategory);
      await Promise.resolve();
      flush();
      resolveCategoryDetails!(categoryItems["News"]);
      await Promise.resolve();
      flush();

      expect(selectedValues).toEqual(["News"]);
      expect(categoryDataValues).toEqual([["Daily Brief"]]);

      // === CYCLE 1: News -> Finance (via action) ===
      const handleSelect = action(function* (category: string) {
        setOptimisticCategory(category);
        yield new Promise<void>(r => {
          resolveUpdateCategory = r;
        });
        refresh(userCategory);
      });

      handleSelect("Finance");
      flush();

      expect(optimisticCategory()).toBe("Finance");

      // Resolve category details for Finance (lane becomes ready)
      resolveCategoryDetails!(categoryItems["Finance"]);
      await Promise.resolve();
      flush();

      expect(selectedValues.at(-1)).toBe("Finance");
      expect(categoryDataValues.at(-1)).toEqual(["Stock Ticker"]);

      // Complete action: API update done
      dbUserCategory = "Finance";
      resolveUpdateCategory!();
      await Promise.resolve();
      flush();

      // refresh(userCategory) fires
      resolveUserCategory!("Finance");
      await Promise.resolve();
      flush();
      resolveCategoryDetails!(categoryItems["Finance"]);
      await Promise.resolve();
      flush();

      // Cycle 1 complete
      expect(optimisticCategory()).toBe("Finance");
      expect(selectedValues.at(-1)).toBe("Finance");
      expect(categoryDataValues.at(-1)).toEqual(["Stock Ticker"]);

      const selectedLen = selectedValues.length;
      const dataLen = categoryDataValues.length;

      // === CYCLE 2: Finance -> Sports (via same action pattern) ===
      handleSelect("Sports");
      flush();

      // Optimistic should show Sports immediately
      expect(optimisticCategory()).toBe("Sports");

      // Resolve category details for Sports (lane becomes ready)
      resolveCategoryDetails!(categoryItems["Sports"]);
      await Promise.resolve();
      flush();

      // Lane effects should fire with Sports data
      expect(selectedValues.at(-1)).toBe("Sports");
      expect(categoryDataValues.at(-1)).toEqual(["Live Scores"]);

      // Complete cycle 2 action
      dbUserCategory = "Sports";
      resolveUpdateCategory!();
      await Promise.resolve();
      flush();
      resolveUserCategory!("Sports");
      await Promise.resolve();
      flush();
      resolveCategoryDetails!(categoryItems["Sports"]);
      await Promise.resolve();
      flush();

      // Cycle 2 complete
      expect(optimisticCategory()).toBe("Sports");
      expect(selectedValues.at(-1)).toBe("Sports");
      expect(categoryDataValues.at(-1)).toEqual(["Live Scores"]);

      // Verify cycle 2 actually produced new effect values
      expect(selectedValues.length).toBeGreaterThan(selectedLen);
      expect(categoryDataValues.length).toBeGreaterThan(dataLen);
    });

    it("isPending effect fires on second rapid action", async () => {
      let resolveSource: ((v: string) => void) | null = null;
      let resolveUpdate: (() => void) | null = null;
      let resolveDown: ((v: string) => void) | null = null;

      const source = createMemo(
        () =>
          new Promise<string>(res => {
            resolveSource = res;
          })
      );
      const [opt, setOpt] = createOptimistic(() => source());
      const down = createMemo(() => {
        opt();
        return new Promise<string>(res => {
          resolveDown = res;
        });
      });

      const pendingVals: boolean[] = [];
      createRoot(() => {
        createRenderEffect(
          () => isPending(down),
          v => {
            pendingVals.push(v);
          }
        );
      });
      flush();

      // Initial load
      resolveSource!("A");
      await Promise.resolve();
      flush();
      resolveDown!("A-data");
      await Promise.resolve();
      flush();
      expect(pendingVals.at(-1)).toBe(false);

      // ACTION 1
      const act = action(function* (v: string) {
        setOpt(v);
        yield new Promise<void>(r => {
          resolveUpdate = r;
        });
        refresh(source);
      });

      act("B");
      flush();
      expect(opt()).toBe("B");
      expect(isPending(down)).toBe(true);
      expect(pendingVals.at(-1)).toBe(true);

      // Resolve downstream for action 1
      resolveDown!("B-data");
      await Promise.resolve();
      flush();

      // ACTION 2 (before action 1's background completes)
      act("C");
      flush();
      expect(opt()).toBe("C");
      expect(isPending(down)).toBe(true);
      // KEY: the pending effect should fire with true again
      expect(pendingVals.at(-1)).toBe(true);
    });

    it("no double pending flicker during refresh phase", async () => {
      // Models the user's category app: action → optimistic → downstream async → refresh
      // isPending should NOT flicker true again during the refresh phase
      let resolveSource: ((v: string) => void) | null = null;
      let resolveUpdate: (() => void) | null = null;
      let resolveDown: ((v: string[]) => void) | null = null;

      const source = createMemo(
        () =>
          new Promise<string>(res => {
            resolveSource = res;
          })
      );
      const [opt, setOpt] = createOptimistic(() => source());
      const down = createMemo(() => {
        const v = opt();
        return new Promise<string[]>(res => {
          resolveDown = res;
        });
      });

      const pendingVals: boolean[] = [];
      createRoot(() => {
        createRenderEffect(
          () => isPending(down),
          v => {
            pendingVals.push(v);
          }
        );
      });
      flush();

      // Initial load
      resolveSource!("News");
      await Promise.resolve();
      flush();
      resolveDown!(["Daily Brief"]);
      await Promise.resolve();
      flush();
      expect(pendingVals.at(-1)).toBe(false);
      pendingVals.length = 0; // reset for clarity

      // ACTION: change category
      const handleSelect = action(function* (cat: string) {
        setOpt(cat);
        yield new Promise<void>(r => {
          resolveUpdate = r;
        });
        refresh(source);
      });

      handleSelect("Finance");
      flush();

      // Phase 1: optimistic override active, downstream fetching → isPending = true
      expect(opt()).toBe("Finance");
      expect(isPending(down)).toBe(true);
      expect(pendingVals.at(-1)).toBe(true);

      // Phase 2: downstream resolves → isPending = false
      resolveDown!(["Stock Ticker"]);
      await Promise.resolve();
      flush();
      // Lane flushes, values visible, isPending clears
      expect(pendingVals.at(-1)).toBe(false);

      // Phase 3: background API completes → refresh(source) triggers
      // This should NOT cause isPending to flicker true again
      const pendingBeforeRefresh = [...pendingVals];
      resolveUpdate!();
      await Promise.resolve();
      flush();

      // Source is now refetching → but override blocks status propagation
      // isPending should NOT have gone true
      expect(pendingVals).toEqual(pendingBeforeRefresh);

      // Phase 4: source resolves with matching value → transition completes
      resolveSource!("Finance");
      await Promise.resolve();
      flush();
      resolveDown!(["Stock Ticker"]);
      await Promise.resolve();
      flush();

      // Final state: everything settled, no pending
      expect(opt()).toBe("Finance");
      expect(pendingVals.at(-1)).toBe(false);
    });

    it("second action while first still in flight - override should show immediately", async () => {
      let dbCategory = "News";
      const items: Record<string, string[]> = {
        News: ["Daily Brief"],
        Finance: ["Stock Ticker"],
        Sports: ["Live Scores"]
      };

      let resolveCategory: ((v: string) => void) | null = null;
      let resolveUpdate: (() => void) | null = null;
      let resolveDetails: ((v: string[]) => void) | null = null;

      const userCategory = createMemo(
        () =>
          new Promise<string>(res => {
            resolveCategory = res;
          })
      );
      const [optimistic, setOptimistic] = createOptimistic(() => userCategory());
      const details = createMemo(() => {
        optimistic();
        return new Promise<string[]>(res => {
          resolveDetails = res;
        });
      });

      const selectedVals: string[] = [];
      const detailVals: string[][] = [];
      const pendingVals: boolean[] = [];

      createRoot(() => {
        createRenderEffect(optimistic, v => {
          selectedVals.push(v);
        });
        createRenderEffect(details, v => {
          detailVals.push(v);
        });
        createRenderEffect(
          () => isPending(details),
          v => {
            pendingVals.push(v);
          }
        );
      });
      flush();

      // Initial load
      resolveCategory!("News");
      await Promise.resolve();
      flush();
      resolveDetails!(items["News"]);
      await Promise.resolve();
      flush();
      expect(selectedVals).toEqual(["News"]);
      expect(pendingVals.at(-1)).toBe(false);

      // ACTION 1: News -> Finance
      const handleSelect = action(function* (cat: string) {
        setOptimistic(cat);
        yield new Promise<void>(r => {
          resolveUpdate = r;
        });
        refresh(userCategory);
      });

      handleSelect("Finance");
      flush();
      expect(optimistic()).toBe("Finance");

      // isPending should be true (details fetching for Finance)
      expect(isPending(details)).toBe(true);

      // Category details resolve (the "500ms" fetch)
      resolveDetails!(items["Finance"]);
      await Promise.resolve();
      flush();

      // Lane effects fire: Finance is visible, pending clears
      expect(selectedVals.at(-1)).toBe("Finance");
      expect(detailVals.at(-1)).toEqual(["Stock Ticker"]);

      // ACTION 2: Finance -> Sports (BEFORE action 1's 2s API completes)
      handleSelect("Sports");
      flush();

      // Direct read: optimistic override should show "Sports" immediately
      expect(optimistic()).toBe("Sports");

      // isPending should be true again (details fetching for Sports)
      expect(isPending(details)).toBe(true);
      expect(pendingVals.at(-1)).toBe(true);

      // Resolve category details for Sports
      resolveDetails!(items["Sports"]);
      await Promise.resolve();
      flush();

      // After details resolve, effects should fire with Sports
      expect(selectedVals.at(-1)).toBe("Sports");
      expect(detailVals.at(-1)).toEqual(["Live Scores"]);

      // Now complete action 1's background work
      dbCategory = "Finance";
      resolveUpdate!();
      await Promise.resolve();
      flush();
      resolveCategory!("Finance");
      await Promise.resolve();
      flush();
      resolveDetails!(items["Finance"]);
      await Promise.resolve();
      flush();

      // After action 1 completes, should still show Sports (action 2 override)
      expect(optimistic()).toBe("Sports");

      // Complete action 2's background work
      dbCategory = "Sports";
      resolveUpdate!();
      await Promise.resolve();
      flush();
      resolveCategory!("Sports");
      await Promise.resolve();
      flush();
      resolveDetails!(items["Sports"]);
      await Promise.resolve();
      flush();

      // Final state: Sports
      expect(optimistic()).toBe("Sports");
      expect(selectedVals.at(-1)).toBe("Sports");
      expect(pendingVals.at(-1)).toBe(false);
    });
  });

  describe("parallel independent optimistic with latest() - checkout pattern", () => {
    // Community scenario: checkout app with two independent async paths that share
    // a downstream total. Uses latest() to allow each path to display its resolved
    // value independently, while the total progressively updates.
    //
    // Graph:
    //   country (signal) → regionalConfig (async) → courierId + taxSchemeId
    //   courierId (optimistic) → shippingCost (async)
    //   taxSchemeId (optimistic) → taxRate (async)
    //   shippingCost + taxRate → orderTotal (sync memo)
    //
    // Display:
    //   latest(shippingCost) → shippingDisplay    (independent)
    //   latest(taxRate)      → taxDisplay          (independent)
    //   orderTotal()          → totalDisplay         (progressive)

    it("latest() allows independent progressive display for parallel optimistic paths", async () => {
      const [country, setCountry] = createSignal("US");

      // Regional config - async lookup returning IDs for courier and tax
      let resolveConfig: ((v: { courier: string; tax: string }) => void) | null = null;
      const regionalConfig = createMemo(() => {
        country();
        return new Promise<{ courier: string; tax: string }>(res => {
          resolveConfig = v => res(v);
        });
      });

      // Two separate optimistic nodes for each independent path
      const [courierId, setCourierId] = createOptimistic(() => regionalConfig().courier);
      const [taxSchemeId, setTaxSchemeId] = createOptimistic(() => regionalConfig().tax);

      // Independent async paths
      let resolveShipping: ((v: number) => void) | null = null;
      const shippingCost = createMemo(() => {
        courierId();
        return new Promise<number>(res => {
          resolveShipping = v => res(v);
        });
      });

      let resolveTax: ((v: number) => void) | null = null;
      const taxRate = createMemo(() => {
        taxSchemeId();
        return new Promise<number>(res => {
          resolveTax = v => res(v);
        });
      });

      // Shared downstream: sync computed of both
      let orderTotal: () => number;

      const shippingValues: number[] = [];
      const taxValues: number[] = [];
      const totalValues: number[] = [];

      createRoot(() => {
        orderTotal = createMemo(() => shippingCost() + taxRate());

        // Independent displays use latest() to opt into progressive updates
        createRenderEffect(
          () => latest(() => shippingCost()),
          v => {
            shippingValues.push(v);
          }
        );
        createRenderEffect(
          () => latest(() => taxRate()),
          v => {
            taxValues.push(v);
          }
        );
        // Total reads normally
        createRenderEffect(
          () => orderTotal(),
          v => {
            totalValues.push(v);
          }
        );
      });

      // --- Initial load ---
      flush();
      resolveConfig!({ courier: "USPS", tax: "US-STANDARD" });
      await Promise.resolve();
      flush();
      resolveShipping!(10);
      await Promise.resolve();
      flush();
      resolveTax!(5);
      await Promise.resolve();
      flush();

      expect(shippingValues).toEqual([10]);
      expect(taxValues).toEqual([5]);
      expect(totalValues).toEqual([15]);

      // --- User changes country to UK ---
      let resolveApiUpdate: (() => void) | null = null;
      const handleCountryChange = action(function* (newCountry: string) {
        setCourierId("ROYAL-MAIL"); // optimistic guess
        setTaxSchemeId("UK-VAT"); // optimistic guess
        setCountry(newCountry);

        yield new Promise<void>(r => {
          resolveApiUpdate = r;
        });
        refresh(regionalConfig);
      });

      handleCountryChange("UK");
      flush();

      // Both async paths re-fired with optimistic IDs, nothing resolved yet
      expect(shippingValues).toEqual([10]);
      expect(taxValues).toEqual([5]);
      expect(totalValues).toEqual([15]);

      // --- Shipping resolves first ---
      resolveShipping!(12);
      await Promise.resolve();
      flush();

      // latest() reader: shipping updates independently
      expect(shippingValues).toEqual([10, 12]);
      // Tax hasn't resolved - still shows initial value
      expect(taxValues).toEqual([5]);
      // orderTotal stays pending: lanes merged at convergence point,
      // so it waits for both deps to resolve (no intermediate half-state)
      expect(totalValues).toEqual([15]);

      // --- Tax resolves second ---
      resolveTax!(8);
      await Promise.resolve();
      flush();

      // latest() reader: tax now also updates independently
      expect(taxValues).toEqual([5, 8]);
      // Both resolved: orderTotal updates with final value
      expect(totalValues).toEqual([15, 20]); // 12 + 8

      // --- Complete the action ---
      resolveApiUpdate!();
      await Promise.resolve();
      flush();

      // refresh(regionalConfig) fires, server confirms the optimistic IDs
      resolveConfig!({ courier: "ROYAL-MAIL", tax: "UK-VAT" });
      await Promise.resolve();
      flush();
      resolveShipping!(12);
      await Promise.resolve();
      flush();
      resolveTax!(8);
      await Promise.resolve();
      flush();

      // Final state: everything consistent
      expect(shippingValues.at(-1)).toBe(12);
      expect(taxValues.at(-1)).toBe(8);
      expect(totalValues.at(-1)).toBe(20);
    });

    it("two full cycles - lanes clean up properly between country changes", async () => {
      const [country, setCountry] = createSignal("US");

      let resolveConfig: ((v: { courier: string; tax: string }) => void) | null = null;
      const regionalConfig = createMemo(() => {
        country();
        return new Promise<{ courier: string; tax: string }>(res => {
          resolveConfig = v => res(v);
        });
      });

      const [courierId, setCourierId] = createOptimistic(() => regionalConfig().courier);
      const [taxSchemeId, setTaxSchemeId] = createOptimistic(() => regionalConfig().tax);

      let resolveShipping: ((v: number) => void) | null = null;
      const shippingCost = createMemo(() => {
        courierId();
        return new Promise<number>(res => {
          resolveShipping = v => res(v);
        });
      });

      let resolveTax: ((v: number) => void) | null = null;
      const taxRate = createMemo(() => {
        taxSchemeId();
        return new Promise<number>(res => {
          resolveTax = v => res(v);
        });
      });

      let orderTotal: () => number;
      const shippingValues: number[] = [];
      const taxValues: number[] = [];
      const totalValues: number[] = [];

      createRoot(() => {
        orderTotal = createMemo(() => shippingCost() + taxRate());

        createRenderEffect(
          () => latest(() => shippingCost()),
          v => {
            shippingValues.push(v);
          }
        );
        createRenderEffect(
          () => latest(() => taxRate()),
          v => {
            taxValues.push(v);
          }
        );
        createRenderEffect(
          () => orderTotal(),
          v => {
            totalValues.push(v);
          }
        );
      });

      // --- Initial load ---
      flush();
      resolveConfig!({ courier: "USPS", tax: "US-STANDARD" });
      await Promise.resolve();
      flush();
      resolveShipping!(10);
      await Promise.resolve();
      flush();
      resolveTax!(5);
      await Promise.resolve();
      flush();

      expect(shippingValues).toEqual([10]);
      expect(taxValues).toEqual([5]);
      expect(totalValues).toEqual([15]);

      // === CYCLE 1: US -> UK ===
      let resolveApiUpdate: (() => void) | null = null;
      const handleCountryChange = action(function* (newCountry: string) {
        setCourierId(newCountry === "UK" ? "ROYAL-MAIL" : "YAMATO");
        setTaxSchemeId(newCountry === "UK" ? "UK-VAT" : "JP-TAX");
        setCountry(newCountry);

        yield new Promise<void>(r => {
          resolveApiUpdate = r;
        });
        refresh(regionalConfig);
      });

      handleCountryChange("UK");
      flush();

      expect(shippingValues).toEqual([10]);
      expect(taxValues).toEqual([5]);
      expect(totalValues).toEqual([15]);

      // Resolve both asyncs
      resolveShipping!(12);
      await Promise.resolve();
      flush();
      resolveTax!(8);
      await Promise.resolve();
      flush();

      expect(shippingValues).toEqual([10, 12]);
      expect(taxValues).toEqual([5, 8]);

      // Complete action + refresh
      resolveApiUpdate!();
      await Promise.resolve();
      flush();
      resolveConfig!({ courier: "ROYAL-MAIL", tax: "UK-VAT" });
      await Promise.resolve();
      flush();
      resolveShipping!(12);
      await Promise.resolve();
      flush();
      resolveTax!(8);
      await Promise.resolve();
      flush();

      // Cycle 1 complete
      expect(shippingValues.at(-1)).toBe(12);
      expect(taxValues.at(-1)).toBe(8);
      expect(totalValues.at(-1)).toBe(20);

      // Snapshot lengths to detect new updates in cycle 2
      const shippingLen = shippingValues.length;
      const taxLen = taxValues.length;
      const totalLen = totalValues.length;

      // === CYCLE 2: UK -> JP ===
      // This exercises the same lanes/nodes after full cleanup
      handleCountryChange("JP");
      flush();

      // Resolve shipping (JP cost)
      resolveShipping!(15);
      await Promise.resolve();
      flush();

      // latest() reader: shipping updates independently on second cycle
      expect(shippingValues.at(-1)).toBe(15);

      // Resolve tax (JP rate)
      resolveTax!(10);
      await Promise.resolve();
      flush();

      // latest() reader: tax updates independently on second cycle
      expect(taxValues.at(-1)).toBe(10);

      // Complete action + refresh for cycle 2
      resolveApiUpdate!();
      await Promise.resolve();
      flush();
      resolveConfig!({ courier: "YAMATO", tax: "JP-TAX" });
      await Promise.resolve();
      flush();
      resolveShipping!(15);
      await Promise.resolve();
      flush();
      resolveTax!(10);
      await Promise.resolve();
      flush();

      // Cycle 2 complete: everything consistent
      expect(shippingValues.at(-1)).toBe(15);
      expect(taxValues.at(-1)).toBe(10);
      expect(totalValues.at(-1)).toBe(25); // 15 + 10
    });

    it("3-optimistic-node checkout: latest() text and isPending opacity update independently", async () => {
      // Matches user's exact app structure:
      //   userCountry (async) → optimisticCountry → regionalConfig (async)
      //     → optimisticCourier → shippingInfo (async) → latest(shipping) display
      //     → optimisticTaxScheme → taxInfo (async) → latest(tax) display
      //     shippingInfo + taxInfo → orderTotal → total display
      // With isPending for opacity dimming on each section

      // Source: user country
      let resolveUserCountry: ((v: string) => void) | null = null;
      const userCountry = createMemo(() => {
        return new Promise<string>(res => {
          resolveUserCountry = v => res(v);
        });
      });
      const [optimisticCountry, setOptimisticCountry] = createOptimistic(() => userCountry());

      // Regional config (depends on optimistic country)
      let resolveConfig: ((v: { courier: string; tax: string }) => void) | null = null;
      const regionalConfig = createMemo(() => {
        optimisticCountry(); // read optimistic country
        return new Promise<{ courier: string; tax: string }>(res => {
          resolveConfig = v => res(v);
        });
      });

      // Two optimistic wrappers on top of regional config
      const [optimisticCourier, setOptimisticCourier] = createOptimistic(
        () => regionalConfig().courier
      );
      const [optimisticTaxScheme, setOptimisticTaxScheme] = createOptimistic(
        () => regionalConfig().tax
      );

      // Async shipping + tax (depend on optimistic IDs)
      type ShipInfo = { provider: string; price: number };
      type TaxInfo = { name: string; rate: number };

      let resolveShipping: ((v: ShipInfo) => void) | null = null;
      const shippingInfo = createMemo(() => {
        optimisticCourier();
        return new Promise<ShipInfo>(res => {
          resolveShipping = v => res(v);
        });
      });

      let resolveTax: ((v: TaxInfo) => void) | null = null;
      const taxInfo = createMemo(() => {
        optimisticTaxScheme();
        return new Promise<TaxInfo>(res => {
          resolveTax = v => res(v);
        });
      });

      // Order total (sync memo of both)
      let orderTotal: () => number;

      // Track values
      const shippingTexts: string[] = [];
      const taxTexts: string[] = [];
      const totalValues: number[] = [];
      const shippingPending: boolean[] = [];
      const taxPending: boolean[] = [];
      const totalPending: boolean[] = [];

      createRoot(() => {
        orderTotal = createMemo(() => {
          const ship = shippingInfo();
          const tax = taxInfo();
          return 100 + 100 * tax.rate + ship.price;
        });

        // latest() for text values (user's pattern)
        createRenderEffect(
          () => latest(() => shippingInfo()).provider,
          v => {
            shippingTexts.push(v);
          }
        );
        createRenderEffect(
          () => latest(() => taxInfo()).name,
          v => {
            taxTexts.push(v);
          }
        );
        // isPending for opacity
        createRenderEffect(
          () => isPending(shippingInfo),
          v => {
            shippingPending.push(v);
          }
        );
        createRenderEffect(
          () => isPending(taxInfo),
          v => {
            taxPending.push(v);
          }
        );
        // Total reads normally
        createRenderEffect(
          () => orderTotal(),
          v => {
            totalValues.push(v);
          }
        );
        // isPending for order total (user's button + opacity pattern)
        createRenderEffect(
          () => isPending(orderTotal),
          v => {
            totalPending.push(v);
          }
        );
      });

      // --- Initial load ---
      flush();
      resolveUserCountry!("US");
      await Promise.resolve();
      flush();
      resolveConfig!({ courier: "FEDEX", tax: "US_SALES_TAX" });
      await Promise.resolve();
      flush();
      resolveShipping!({ provider: "FEDEX", price: 15 });
      await Promise.resolve();
      flush();
      resolveTax!({ name: "US_SALES_TAX", rate: 0.08 });
      await Promise.resolve();
      flush();

      expect(shippingTexts).toEqual(["FEDEX"]);
      expect(taxTexts).toEqual(["US_SALES_TAX"]);
      expect(totalValues).toEqual([123]); // 100 + 100*0.08 + 15
      expect(shippingPending.at(-1)).toBe(false);
      expect(taxPending.at(-1)).toBe(false);
      expect(totalPending.at(-1)).toBe(false);

      // === User changes country: US -> UK ===
      let resolveApiUpdate: (() => void) | null = null;
      const handleCountryChange = action(function* (newCountry: string) {
        setOptimisticCountry(newCountry);
        setOptimisticCourier("DHL");
        setOptimisticTaxScheme("UK_VAT");

        yield new Promise<void>(r => {
          resolveApiUpdate = r;
        });
        refresh(userCountry);
      });

      handleCountryChange("UK");
      flush();

      // Optimistic values set, both asyncs re-fired
      expect(optimisticCountry()).toBe("UK");
      expect(optimisticCourier()).toBe("DHL");
      expect(optimisticTaxScheme()).toBe("UK_VAT");

      // isPending should show pending for both (async in flight with stale data)
      expect(shippingPending.at(-1)).toBe(true);
      expect(taxPending.at(-1)).toBe(true);
      // CRITICAL: orderTotal should also be pending (depends on pending nodes)
      expect(totalPending.at(-1)).toBe(true);

      // Text should still show old values (async not resolved)
      expect(shippingTexts).toEqual(["FEDEX"]);
      expect(taxTexts).toEqual(["US_SALES_TAX"]);

      // --- Tax resolves FIRST (faster API: 700ms vs 1000ms) ---
      resolveTax!({ name: "UK_VAT", rate: 0.2 });
      await Promise.resolve();
      flush();

      // CRITICAL: tax text should update independently
      expect(taxTexts).toEqual(["US_SALES_TAX", "UK_VAT"]);
      // Tax isPending stays true: merged lane (shipping+tax at orderTotal)
      // still has pending async (shipping hasn't resolved)
      expect(taxPending.at(-1)).toBe(true);

      // Shipping text should NOT have updated yet
      expect(shippingTexts).toEqual(["FEDEX"]);
      // Shipping should still be pending
      expect(shippingPending.at(-1)).toBe(true);

      // --- Shipping resolves SECOND ---
      resolveShipping!({ provider: "DHL", price: 25 });
      await Promise.resolve();
      flush();

      // Shipping text should now update
      expect(shippingTexts).toEqual(["FEDEX", "DHL"]);
      // NOW both isPending clear - merged lane fully resolved
      expect(shippingPending.at(-1)).toBe(false);
      expect(taxPending.at(-1)).toBe(false);
      // orderTotal isPending should also clear
      expect(totalPending.at(-1)).toBe(false);

      // Complete action + refresh
      resolveApiUpdate!();
      await Promise.resolve();
      flush();
      resolveUserCountry!("UK");
      await Promise.resolve();
      flush();
      resolveConfig!({ courier: "DHL", tax: "UK_VAT" });
      await Promise.resolve();
      flush();
      resolveShipping!({ provider: "DHL", price: 25 });
      await Promise.resolve();
      flush();
      resolveTax!({ name: "UK_VAT", rate: 0.2 });
      await Promise.resolve();
      flush();

      // Final state: everything consistent
      expect(shippingTexts.at(-1)).toBe("DHL");
      expect(taxTexts.at(-1)).toBe("UK_VAT");
      expect(totalValues.at(-1)).toBe(145); // 100 + 100*0.20 + 25
      expect(shippingPending.at(-1)).toBe(false);
      expect(taxPending.at(-1)).toBe(false);
      expect(totalPending.at(-1)).toBe(false);
    });

    it("checkout: combined style effect with multiple isPending reads matches separate effects", async () => {
      // BUG SCENARIO: In the real CheckoutApp, a single render effect reads
      // isPending(shippingInfo), isPending(taxInfo), AND isPending(orderTotal) together.
      // A separate render effect reads isPending(orderTotal) for button text.
      // The opacity isPending(orderTotal) was flickering on late and briefly.

      let resolveUserCountry: ((v: string) => void) | null = null;
      const userCountry = createMemo(() => {
        return new Promise<string>(res => {
          resolveUserCountry = v => res(v);
        });
      });
      const [optimisticCountry, setOptimisticCountry] = createOptimistic(() => userCountry());

      let resolveConfig: ((v: { courier: string; tax: string }) => void) | null = null;
      const regionalConfig = createMemo(() => {
        optimisticCountry();
        return new Promise<{ courier: string; tax: string }>(res => {
          resolveConfig = v => res(v);
        });
      });

      const [optimisticCourier, setOptimisticCourier] = createOptimistic(
        () => regionalConfig().courier
      );
      const [optimisticTaxScheme, setOptimisticTaxScheme] = createOptimistic(
        () => regionalConfig().tax
      );

      type ShipInfo = { provider: string; price: number };
      type TaxInfo = { name: string; rate: number };

      let resolveShipping: ((v: ShipInfo) => void) | null = null;
      const shippingInfo = createMemo(() => {
        optimisticCourier();
        return new Promise<ShipInfo>(res => {
          resolveShipping = v => res(v);
        });
      });

      let resolveTax: ((v: TaxInfo) => void) | null = null;
      const taxInfo = createMemo(() => {
        optimisticTaxScheme();
        return new Promise<TaxInfo>(res => {
          resolveTax = v => res(v);
        });
      });

      let orderTotal: () => number;

      // Separate effect for button text (reads isPending(orderTotal) alone)
      const buttonTextPending: boolean[] = [];
      // Combined style effect (reads all 3 isPending values together, like compiled JSX)
      const styleShipPending: boolean[] = [];
      const styleTaxPending: boolean[] = [];
      const styleTotalPending: boolean[] = [];

      createRoot(() => {
        orderTotal = createMemo(() => {
          const ship = shippingInfo();
          const tax = taxInfo();
          return 100 + 100 * tax.rate + ship.price;
        });

        // Effect 1: button text (separate, reads only isPending(orderTotal))
        createRenderEffect(
          () => isPending(orderTotal),
          v => {
            buttonTextPending.push(v);
          }
        );

        // Effect 2: combined style (reads all 3 isPending, like the compiled JSX style effect)
        createRenderEffect(
          () => ({
            ship: isPending(shippingInfo) ? 0.5 : 1,
            tax: isPending(taxInfo) ? 0.5 : 1,
            total: isPending(orderTotal) ? 0.5 : 1
          }),
          v => {
            styleShipPending.push(v.ship === 0.5);
            styleTaxPending.push(v.tax === 0.5);
            styleTotalPending.push(v.total === 0.5);
          }
        );
      });

      // --- Initial load ---
      flush();
      resolveUserCountry!("US");
      await Promise.resolve();
      flush();
      resolveConfig!({ courier: "FEDEX", tax: "US_SALES_TAX" });
      await Promise.resolve();
      flush();
      resolveShipping!({ provider: "FEDEX", price: 15 });
      await Promise.resolve();
      flush();
      resolveTax!({ name: "US_SALES_TAX", rate: 0.08 });
      await Promise.resolve();
      flush();

      expect(buttonTextPending.at(-1)).toBe(false);
      expect(styleTotalPending.at(-1)).toBe(false);

      // Clear initial entries for clarity
      const initBtn = buttonTextPending.length;
      const initStyle = styleTotalPending.length;

      // === User changes country ===
      let resolveApiUpdate: (() => void) | null = null;
      const handleCountryChange = action(function* (newCountry: string) {
        setOptimisticCountry(newCountry);
        setOptimisticCourier("DHL");
        setOptimisticTaxScheme("UK_VAT");
        yield new Promise<void>(r => {
          resolveApiUpdate = r;
        });
        refresh(userCountry);
      });

      handleCountryChange("UK");
      flush();

      const afterAction = {
        btn: buttonTextPending.slice(initBtn),
        styleTotal: styleTotalPending.slice(initStyle),
        styleShip: styleShipPending.slice(initStyle),
        styleTax: styleTaxPending.slice(initStyle)
      };
      // Both effects should see isPending(orderTotal) = true at the same time
      expect(buttonTextPending.at(-1)).toBe(true);
      expect(styleTotalPending.at(-1)).toBe(true);

      const preResolve = { btn: buttonTextPending.length, style: styleTotalPending.length };

      // --- Tax resolves first ---
      resolveTax!({ name: "UK_VAT", rate: 0.2 });
      await Promise.resolve();
      flush();

      // --- Shipping resolves second ---
      resolveShipping!({ provider: "DHL", price: 25 });
      await Promise.resolve();
      flush();

      // Both effects should see isPending(orderTotal) = false at the same time
      expect(buttonTextPending.at(-1)).toBe(false);
      expect(styleTotalPending.at(-1)).toBe(false);

      const preFinalize = { btn: buttonTextPending.length, style: styleTotalPending.length };

      // Complete action + refresh
      resolveApiUpdate!();
      await Promise.resolve();
      flush();
      resolveUserCountry!("UK");
      await Promise.resolve();
      flush();
      resolveConfig!({ courier: "DHL", tax: "UK_VAT" });
      await Promise.resolve();
      flush();
      resolveShipping!({ provider: "DHL", price: 25 });
      await Promise.resolve();
      flush();
      resolveTax!({ name: "UK_VAT", rate: 0.2 });
      await Promise.resolve();
      flush();

      // Final state: both effects agree
      expect(buttonTextPending.at(-1)).toBe(false);
      expect(styleTotalPending.at(-1)).toBe(false);
    });

    it("shared async config resolves first: lanes stay separate despite shared dependency", async () => {
      // KEY BUG SCENARIO: when regionalConfig resolves BEFORE shipping/tax,
      // insertSubs(regionalConfig) visits optimisticCourier (Lane_C) and
      // optimisticTaxScheme (Lane_T) as subscribers. Without the fix, this
      // merges ALL lanes into one, blocking independent updates.
      //
      // Timeline: config(600ms) < tax(700ms) < shipping(1000ms)
      // Tax has a MISMATCH: optimistic guess "UK_VAT" ≠ real "UK_VAT_FINAL"
      // This triggers a correction cycle (new fetch), making tax resolve LAST.

      let resolveUserCountry: ((v: string) => void) | null = null;
      const userCountry = createMemo(() => {
        return new Promise<string>(res => {
          resolveUserCountry = v => res(v);
        });
      });
      const [optimisticCountry, setOptimisticCountry] = createOptimistic(() => userCountry());

      let resolveConfig: ((v: { courier: string; tax: string }) => void) | null = null;
      const regionalConfig = createMemo(() => {
        optimisticCountry();
        return new Promise<{ courier: string; tax: string }>(res => {
          resolveConfig = v => res(v);
        });
      });

      const [optimisticCourier, setOptimisticCourier] = createOptimistic(
        () => regionalConfig().courier
      );
      const [optimisticTaxScheme, setOptimisticTaxScheme] = createOptimistic(
        () => regionalConfig().tax
      );

      type ShipInfo = { provider: string; price: number };
      type TaxInfo = { name: string; rate: number };

      let resolveShipping: ((v: ShipInfo) => void) | null = null;
      const shippingInfo = createMemo(() => {
        optimisticCourier();
        return new Promise<ShipInfo>(res => {
          resolveShipping = v => res(v);
        });
      });

      let resolveTax: ((v: TaxInfo) => void) | null = null;
      const taxInfo = createMemo(() => {
        optimisticTaxScheme();
        return new Promise<TaxInfo>(res => {
          resolveTax = v => res(v);
        });
      });

      let orderTotal: () => number;
      const shippingTexts: string[] = [];
      const taxTexts: string[] = [];
      const totalValues: number[] = [];
      const shippingPending: boolean[] = [];
      const taxPending: boolean[] = [];

      createRoot(() => {
        orderTotal = createMemo(() => {
          const ship = shippingInfo();
          const tax = taxInfo();
          return 100 + 100 * tax.rate + ship.price;
        });

        createRenderEffect(
          () => latest(() => shippingInfo()).provider,
          v => {
            shippingTexts.push(v);
          }
        );
        createRenderEffect(
          () => latest(() => taxInfo()).name,
          v => {
            taxTexts.push(v);
          }
        );
        createRenderEffect(
          () => isPending(shippingInfo),
          v => {
            shippingPending.push(v);
          }
        );
        createRenderEffect(
          () => isPending(taxInfo),
          v => {
            taxPending.push(v);
          }
        );
        createRenderEffect(
          () => orderTotal(),
          v => {
            totalValues.push(v);
          }
        );
      });

      // --- Initial load ---
      flush();
      resolveUserCountry!("US");
      await Promise.resolve();
      flush();
      resolveConfig!({ courier: "FEDEX", tax: "US_SALES_TAX" });
      await Promise.resolve();
      flush();
      resolveShipping!({ provider: "FEDEX", price: 15 });
      await Promise.resolve();
      flush();
      resolveTax!({ name: "US_SALES_TAX", rate: 0.08 });
      await Promise.resolve();
      flush();

      expect(shippingTexts).toEqual(["FEDEX"]);
      expect(taxTexts).toEqual(["US_SALES_TAX"]);
      expect(totalValues).toEqual([123]); // 100 + 100*0.08 + 15
      expect(shippingPending.at(-1)).toBe(false);
      expect(taxPending.at(-1)).toBe(false);

      // === User changes country: US -> UK ===
      let resolveApiUpdate: (() => void) | null = null;
      const handleCountryChange = action(function* (newCountry: string) {
        setOptimisticCountry(newCountry);
        setOptimisticCourier("DHL"); // correct guess
        setOptimisticTaxScheme("UK_VAT"); // WRONG guess (real is "UK_VAT_FINAL")

        yield new Promise<void>(r => {
          resolveApiUpdate = r;
        });
        refresh(userCountry);
      });

      handleCountryChange("UK");
      flush();

      // 3 separate lanes created, all asyncs re-fired
      expect(optimisticCountry()).toBe("UK");
      expect(optimisticCourier()).toBe("DHL");
      expect(optimisticTaxScheme()).toBe("UK_VAT");
      expect(shippingPending.at(-1)).toBe(true);
      expect(taxPending.at(-1)).toBe(true);

      // --- regionalConfig resolves FIRST (600ms) ---
      // This is the critical moment: insertSubs(regionalConfig, true) visits
      // optimisticCourier and optimisticTaxScheme as subscribers.
      // BUG: without fix, their different lanes merge into one mega-lane.
      // FIX: optimistic override prevents merge, lanes stay separate.
      resolveConfig!({ courier: "DHL", tax: "UK_VAT_FINAL" });
      await Promise.resolve();
      flush();

      // optimisticCourier: "DHL" matches config → no change
      // optimisticTaxScheme: "UK_VAT" ≠ "UK_VAT_FINAL" → corrected, taxInfo re-fetches
      expect(optimisticCourier()).toBe("DHL");
      // Tax scheme corrected (override overwritten by mismatch)
      expect(optimisticTaxScheme()).toBe("UK_VAT_FINAL");

      // --- Shipping resolves (1000ms) ---
      resolveShipping!({ provider: "DHL", price: 25 });
      await Promise.resolve();
      flush();

      // CRITICAL: shipping text should update INDEPENDENTLY
      expect(shippingTexts).toEqual(["FEDEX", "DHL"]);
      // isPending(shippingInfo) stays true: the merged lane (shipping+tax at orderTotal)
      // still has pending async (tax correction in flight), so isPending reflects the lane state
      expect(shippingPending.at(-1)).toBe(true);

      // Tax should NOT have updated yet (correction re-fetch still in flight)
      expect(taxTexts).toEqual(["US_SALES_TAX"]);
      expect(taxPending.at(-1)).toBe(true);

      // CRITICAL: orderTotal should NOT show intermediate "half-state"
      // It depends on both shipping (resolved) and tax (still pending).
      // The lanes should have merged at orderTotal, keeping it pending.
      // Only the initial value (123) should be present - no intermediate updates.
      expect(totalValues).toEqual([123]);

      // --- Tax correction resolves (new fetch for "UK_VAT_FINAL") ---
      resolveTax!({ name: "UK_VAT_FINAL", rate: 0.2 });
      await Promise.resolve();
      flush();

      // Tax text should now update independently
      expect(taxTexts).toEqual(["US_SALES_TAX", "UK_VAT_FINAL"]);
      // NOW both isPending clear - merged lane fully resolved
      expect(shippingPending.at(-1)).toBe(false);
      expect(taxPending.at(-1)).toBe(false);

      // CRITICAL: NOW orderTotal should update - both lanes have resolved
      // 100 + 100*0.20 + 25 = 145
      expect(totalValues).toEqual([123, 145]);

      // --- Complete action + refresh ---
      resolveApiUpdate!();
      await Promise.resolve();
      flush();
      resolveUserCountry!("UK");
      await Promise.resolve();
      flush();
      resolveConfig!({ courier: "DHL", tax: "UK_VAT_FINAL" });
      await Promise.resolve();
      flush();
      resolveShipping!({ provider: "DHL", price: 25 });
      await Promise.resolve();
      flush();
      resolveTax!({ name: "UK_VAT_FINAL", rate: 0.2 });
      await Promise.resolve();
      flush();

      // Final state: everything consistent
      expect(shippingTexts.at(-1)).toBe("DHL");
      expect(taxTexts.at(-1)).toBe("UK_VAT_FINAL");
      expect(shippingPending.at(-1)).toBe(false);
      expect(taxPending.at(-1)).toBe(false);
      expect(totalValues.at(-1)).toBe(145);
    });

    it("isPending holds until merged lane completes, not just individual async", async () => {
      // When two parallel async paths merge at a shared downstream (orderTotal),
      // isPending for each path should stay true until the ENTIRE merged lane resolves,
      // not just when that individual path resolves. This prevents a UI mismatch where
      // isPending clears (opacity=1) but the actual value hasn't updated yet
      // (still blocked by the merged lane).
      const [country, setCountry] = createSignal("US");

      let resolveConfig: ((v: { courier: string; tax: string }) => void) | null = null;
      const regionalConfig = createMemo(() => {
        country();
        return new Promise<{ courier: string; tax: string }>(res => {
          resolveConfig = v => res(v);
        });
      });

      const [courierId, setCourierId] = createOptimistic(() => regionalConfig().courier);
      const [taxSchemeId, setTaxSchemeId] = createOptimistic(() => regionalConfig().tax);

      let resolveShipping: ((v: { provider: string; price: number }) => void) | null = null;
      const shippingInfo = createMemo(() => {
        courierId();
        return new Promise<{ provider: string; price: number }>(res => {
          resolveShipping = v => res(v);
        });
      });

      let resolveTax: ((v: { name: string; rate: number }) => void) | null = null;
      const taxInfo = createMemo(() => {
        taxSchemeId();
        return new Promise<{ name: string; rate: number }>(res => {
          resolveTax = v => res(v);
        });
      });

      const shippingPendingValues: boolean[] = [];
      const taxPendingValues: boolean[] = [];
      const totalValues: number[] = [];

      createRoot(() => {
        const orderTotal = createMemo(() => {
          const s = shippingInfo();
          const t = taxInfo();
          return 100 + 100 * t.rate + s.price;
        });

        // Track isPending for each path
        createRenderEffect(
          () => isPending(shippingInfo),
          v => {
            shippingPendingValues.push(v);
          }
        );
        createRenderEffect(
          () => isPending(taxInfo),
          v => {
            taxPendingValues.push(v);
          }
        );
        // orderTotal reads both - causes lane merge
        createRenderEffect(
          () => orderTotal(),
          v => {
            totalValues.push(v);
          }
        );
      });

      // --- Initial load ---
      flush();
      resolveConfig!({ courier: "USPS", tax: "US-STD" });
      await Promise.resolve();
      flush();
      resolveShipping!({ provider: "USPS", price: 10 });
      await Promise.resolve();
      flush();
      resolveTax!({ name: "US-STD", rate: 0.05 });
      await Promise.resolve();
      flush();

      expect(shippingPendingValues.at(-1)).toBe(false);
      expect(taxPendingValues.at(-1)).toBe(false);
      expect(totalValues.at(-1)).toBe(115); // 100 + 5 + 10

      // Clear arrays so transition assertions start clean
      shippingPendingValues.length = 0;
      taxPendingValues.length = 0;
      totalValues.length = 0;

      // --- User changes country ---
      let resolveApiUpdate: (() => void) | null = null;
      const handleCountryChange = action(function* (newCountry: string) {
        setCourierId("DHL");
        setTaxSchemeId("UK-VAT");
        setCountry(newCountry);
        yield new Promise<void>(r => {
          resolveApiUpdate = r;
        });
        refresh(regionalConfig);
      });

      handleCountryChange("UK");
      flush();

      // Both paths now pending
      expect(shippingPendingValues).toEqual([true]);
      expect(taxPendingValues).toEqual([true]);

      // --- Shipping resolves first ---
      resolveShipping!({ provider: "DHL", price: 25 });
      await Promise.resolve();
      flush();

      // KEY ASSERTION: isPending(shippingInfo) should STILL be true
      // because the merged lane (shipping + tax at orderTotal) hasn't fully resolved.
      // The actual shippingInfo value update is blocked by the merged lane,
      // so isPending should reflect that.
      expect(shippingPendingValues).toEqual([true]);
      // Tax also still pending
      expect(taxPendingValues).toEqual([true]);
      // orderTotal hasn't updated (merged lane still pending)
      expect(totalValues).toEqual([]);

      // --- Tax resolves second ---
      resolveTax!({ name: "UK-VAT", rate: 0.2 });
      await Promise.resolve();
      flush();

      // NOW the merged lane is ready - both isPending clear together
      expect(shippingPendingValues).toEqual([true, false]);
      expect(taxPendingValues).toEqual([true, false]);
      // orderTotal updates with final values
      expect(totalValues).toEqual([145]); // 100 + 20 + 25

      // --- Complete the action ---
      resolveApiUpdate!();
      await Promise.resolve();
      flush();
      resolveConfig!({ courier: "DHL", tax: "UK-VAT" });
      await Promise.resolve();
      flush();
      resolveShipping!({ provider: "DHL", price: 25 });
      await Promise.resolve();
      flush();
      resolveTax!({ name: "UK-VAT", rate: 0.2 });
      await Promise.resolve();
      flush();

      // Final: everything consistent, isPending cleared
      expect(shippingPendingValues.at(-1)).toBe(false);
      expect(taxPendingValues.at(-1)).toBe(false);
      expect(totalValues.at(-1)).toBe(145);
    });

    it("rapid action: correction should not be blocked when lane is reused across actions", async () => {
      // BUG (Fix 2): When a second rapid action reuses a lane, _laneVersion wasn't
      // updated but _overrideVersion was incremented. The version check (ov > lv)
      // in the isOptimisticDirty correction path blocked valid corrections from
      // the current action's own fetch result.
      //
      // Scenario: US → UK → US (rapid, with WRONG UK tax guess)
      // 1. Start from US
      // 2. Action 1: US→UK, tax guess "UK_TAX_WRONG" (intentionally wrong)
      // 3. Action 1 correction fixes tax to "UK_TAX_REAL"
      // 4. Before action 1 completes, Action 2: UK→US with WRONG US tax guess
      // 5. Action 2's correction should fix the guess — was blocked by version check

      let resolveUserCountry: ((v: string) => void) | null = null;
      const userCountry = createMemo(() => {
        return new Promise<string>(res => {
          resolveUserCountry = v => res(v);
        });
      });
      const [optimisticCountry, setOptimisticCountry] = createOptimistic(() => userCountry());

      let resolveConfig: ((v: { courier: string; tax: string }) => void) | null = null;
      const regionalConfig = createMemo(() => {
        optimisticCountry();
        return new Promise<{ courier: string; tax: string }>(res => {
          resolveConfig = v => res(v);
        });
      });

      const [optimisticCourier, setOptimisticCourier] = createOptimistic(
        () => regionalConfig().courier
      );
      const [optimisticTaxScheme, setOptimisticTaxScheme] = createOptimistic(
        () => regionalConfig().tax
      );

      type ShipInfo = { provider: string; price: number };
      type TaxInfo = { name: string; rate: number };

      let resolveShipping: ((v: ShipInfo) => void) | null = null;
      const shippingInfo = createMemo(() => {
        optimisticCourier();
        return new Promise<ShipInfo>(res => {
          resolveShipping = v => res(v);
        });
      });

      let resolveTax: ((v: TaxInfo) => void) | null = null;
      const taxInfo = createMemo(() => {
        optimisticTaxScheme();
        return new Promise<TaxInfo>(res => {
          resolveTax = v => res(v);
        });
      });

      let orderTotal: () => number;
      const taxTexts: string[] = [];
      const shippingTexts: string[] = [];
      const totalValues: number[] = [];
      const taxPending: boolean[] = [];

      createRoot(() => {
        orderTotal = createMemo(() => {
          const ship = shippingInfo();
          const tax = taxInfo();
          return 100 + 100 * tax.rate + ship.price;
        });
        createRenderEffect(
          () => latest(() => shippingInfo()).provider,
          v => {
            shippingTexts.push(v);
          }
        );
        createRenderEffect(
          () => latest(() => taxInfo()).name,
          v => {
            taxTexts.push(v);
          }
        );
        createRenderEffect(
          () => orderTotal(),
          v => {
            totalValues.push(v);
          }
        );
        createRenderEffect(
          () => isPending(taxInfo),
          v => {
            taxPending.push(v);
          }
        );
      });

      // --- Initial load (US) ---
      flush();
      resolveUserCountry!("US");
      await Promise.resolve();
      flush();
      resolveConfig!({ courier: "FEDEX", tax: "US_TAX" });
      await Promise.resolve();
      flush();
      resolveShipping!({ provider: "FEDEX", price: 15 });
      await Promise.resolve();
      flush();
      resolveTax!({ name: "US_TAX", rate: 0.08 });
      await Promise.resolve();
      flush();

      expect(taxTexts).toEqual(["US_TAX"]);
      expect(shippingTexts).toEqual(["FEDEX"]);
      expect(totalValues).toEqual([123]); // 100 + 8 + 15
      expect(taxPending.at(-1)).toBe(false);

      // === Action 1: US → UK with WRONG tax guess ===
      let resolveApiUpdate: (() => void) | null = null;
      const handleCountryChange = action(function* (
        newCountry: string,
        courierGuess: string,
        taxGuess: string
      ) {
        setOptimisticCountry(newCountry);
        setOptimisticCourier(courierGuess);
        setOptimisticTaxScheme(taxGuess);
        yield new Promise<void>(r => {
          resolveApiUpdate = r;
        });
        refresh(userCountry);
      });

      handleCountryChange("UK", "DHL", "UK_TAX_WRONG");
      flush();

      expect(optimisticCountry()).toBe("UK");
      expect(optimisticTaxScheme()).toBe("UK_TAX_WRONG");
      expect(taxPending.at(-1)).toBe(true);

      // Shipping resolves for UK
      resolveShipping!({ provider: "DHL", price: 25 });
      await Promise.resolve();
      flush();
      expect(shippingTexts.at(-1)).toBe("DHL");

      // Tax resolves — using the WRONG guess as key, returns data for it
      resolveTax!({ name: "UK_TAX_WRONG", rate: 0.2 });
      await Promise.resolve();
      flush();
      expect(taxTexts.at(-1)).toBe("UK_TAX_WRONG");

      // regionalConfig resolves — reveals the CORRECT tax is "UK_TAX_REAL"
      // This triggers correction: optimisticTaxScheme "UK_TAX_WRONG" → "UK_TAX_REAL"
      resolveApiUpdate!();
      await Promise.resolve();
      flush();
      resolveUserCountry!("UK");
      await Promise.resolve();
      flush();
      resolveConfig!({ courier: "DHL", tax: "UK_TAX_REAL" });
      await Promise.resolve();
      flush();

      // Correction triggered a re-fetch for the real tax
      expect(optimisticTaxScheme()).toBe("UK_TAX_REAL");

      // === Action 2 (RAPID): UK → US with WRONG tax guess ===
      // This reuses the lane — _overrideVersion increments but _laneVersion doesn't
      handleCountryChange("US", "FEDEX", "US_TAX_WRONG");
      flush();

      expect(optimisticCountry()).toBe("US");
      expect(optimisticTaxScheme()).toBe("US_TAX_WRONG");

      // Resolve the corrected tax fetch from action 1 (stale, should be skipped)
      resolveTax!({ name: "UK_TAX_REAL", rate: 0.2 });
      await Promise.resolve();
      flush();

      // Resolve shipping + tax for action 2's optimistic values
      resolveShipping!({ provider: "FEDEX", price: 15 });
      await Promise.resolve();
      flush();
      resolveTax!({ name: "US_TAX_WRONG", rate: 0.1 });
      await Promise.resolve();
      flush();

      // regionalConfig resolves for US → corrects tax to "US_TAX_REAL"
      resolveApiUpdate!();
      await Promise.resolve();
      flush();
      resolveUserCountry!("US");
      await Promise.resolve();
      flush();
      resolveConfig!({ courier: "FEDEX", tax: "US_TAX_REAL" });
      await Promise.resolve();
      flush();

      // CRITICAL: correction should NOT be blocked by version check.
      // optimisticTaxScheme should be corrected to the real US tax.
      expect(optimisticTaxScheme()).toBe("US_TAX_REAL");

      // Resolve the corrected tax fetch
      resolveTax!({ name: "US_TAX_REAL", rate: 0.08 });
      await Promise.resolve();
      flush();
      resolveShipping!({ provider: "FEDEX", price: 15 });
      await Promise.resolve();
      flush();

      // Final: correct US values
      expect(taxTexts.at(-1)).toBe("US_TAX_REAL");
      expect(shippingTexts.at(-1)).toBe("FEDEX");
      expect(totalValues.at(-1)).toBe(123); // 100 + 8 + 15
      expect(taxPending.at(-1)).toBe(false);
    });

    it("rapid action: unchanged override value should still dirty downstream to invalidate stale _inFlight", async () => {
      // BUG (Fix 1): When a correction updates _value to match the next action's
      // override, setSignal sees valueChanged=false and skips insertSubs.
      // Downstream nodes keep stale _inFlight that resolves with wrong data.
      //
      // Scenario: US → UK (wrong guess, corrected) → rapid action with same tax value
      // 1. Start from US
      // 2. Action 1: US→UK, tax guess "UK_TAX_WRONG"
      // 3. Correction fixes tax _value to "UK_TAX_REAL"
      // 4. Action 2: sets tax to "UK_TAX_REAL" (matches corrected _value!)
      //    → valueChanged=false → must still dirty downstream

      let resolveUserCountry: ((v: string) => void) | null = null;
      const userCountry = createMemo(() => {
        return new Promise<string>(res => {
          resolveUserCountry = v => res(v);
        });
      });
      const [optimisticCountry, setOptimisticCountry] = createOptimistic(() => userCountry());

      let resolveConfig: ((v: { courier: string; tax: string }) => void) | null = null;
      const regionalConfig = createMemo(() => {
        optimisticCountry();
        return new Promise<{ courier: string; tax: string }>(res => {
          resolveConfig = v => res(v);
        });
      });

      const [optimisticCourier, setOptimisticCourier] = createOptimistic(
        () => regionalConfig().courier
      );
      const [optimisticTaxScheme, setOptimisticTaxScheme] = createOptimistic(
        () => regionalConfig().tax
      );

      type ShipInfo = { provider: string; price: number };
      type TaxInfo = { name: string; rate: number };

      let resolveShipping: ((v: ShipInfo) => void) | null = null;
      const shippingInfo = createMemo(() => {
        optimisticCourier();
        return new Promise<ShipInfo>(res => {
          resolveShipping = v => res(v);
        });
      });

      let resolveTax: ((v: TaxInfo) => void) | null = null;
      const taxInfo = createMemo(() => {
        optimisticTaxScheme();
        return new Promise<TaxInfo>(res => {
          resolveTax = v => res(v);
        });
      });

      let orderTotal: () => number;
      const taxTexts: string[] = [];
      const totalValues: number[] = [];

      createRoot(() => {
        orderTotal = createMemo(() => {
          const ship = shippingInfo();
          const tax = taxInfo();
          return 100 + 100 * tax.rate + ship.price;
        });
        createRenderEffect(
          () => latest(() => taxInfo()).name,
          v => {
            taxTexts.push(v);
          }
        );
        createRenderEffect(
          () => orderTotal(),
          v => {
            totalValues.push(v);
          }
        );
      });

      // --- Initial load (US) ---
      flush();
      resolveUserCountry!("US");
      await Promise.resolve();
      flush();
      resolveConfig!({ courier: "FEDEX", tax: "US_TAX" });
      await Promise.resolve();
      flush();
      resolveShipping!({ provider: "FEDEX", price: 15 });
      await Promise.resolve();
      flush();
      resolveTax!({ name: "US_TAX", rate: 0.08 });
      await Promise.resolve();
      flush();

      expect(taxTexts).toEqual(["US_TAX"]);
      expect(totalValues).toEqual([123]);

      // === Action 1: US → UK with WRONG tax guess ===
      let resolveApiUpdate: (() => void) | null = null;
      const handleCountryChange = action(function* (
        newCountry: string,
        courierGuess: string,
        taxGuess: string
      ) {
        setOptimisticCountry(newCountry);
        setOptimisticCourier(courierGuess);
        setOptimisticTaxScheme(taxGuess);
        yield new Promise<void>(r => {
          resolveApiUpdate = r;
        });
        refresh(userCountry);
      });

      handleCountryChange("UK", "DHL", "UK_TAX_WRONG");
      flush();

      // Resolve shipping + tax for wrong guess
      resolveShipping!({ provider: "DHL", price: 25 });
      await Promise.resolve();
      flush();
      resolveTax!({ name: "UK_TAX_WRONG", rate: 0.15 });
      await Promise.resolve();
      flush();

      expect(taxTexts.at(-1)).toBe("UK_TAX_WRONG");

      // Complete action 1: correction reveals real tax is "UK_TAX_REAL"
      resolveApiUpdate!();
      await Promise.resolve();
      flush();
      resolveUserCountry!("UK");
      await Promise.resolve();
      flush();
      resolveConfig!({ courier: "DHL", tax: "UK_TAX_REAL" });
      await Promise.resolve();
      flush();

      // Correction fires: optimisticTaxScheme "UK_TAX_WRONG" → "UK_TAX_REAL"
      expect(optimisticTaxScheme()).toBe("UK_TAX_REAL");

      // Re-fetch for corrected tax resolves
      resolveTax!({ name: "UK_TAX_REAL", rate: 0.2 });
      await Promise.resolve();
      flush();
      resolveShipping!({ provider: "DHL", price: 25 });
      await Promise.resolve();
      flush();

      expect(taxTexts.at(-1)).toBe("UK_TAX_REAL");

      // === Action 2 (RAPID): Set tax to SAME value as corrected ===
      // This is the key scenario: the action writes "UK_TAX_REAL" but _value
      // is already "UK_TAX_REAL" from the correction → valueChanged=false
      // Without the fix, taxInfo's stale _inFlight would resolve with wrong data.
      handleCountryChange("UK", "DHL", "UK_TAX_REAL");
      flush();

      // Resolve shipping + tax for action 2
      resolveShipping!({ provider: "DHL", price: 25 });
      await Promise.resolve();
      flush();
      resolveTax!({ name: "UK_TAX_REAL", rate: 0.2 });
      await Promise.resolve();
      flush();

      // Complete action 2
      resolveApiUpdate!();
      await Promise.resolve();
      flush();
      resolveUserCountry!("UK");
      await Promise.resolve();
      flush();
      resolveConfig!({ courier: "DHL", tax: "UK_TAX_REAL" });
      await Promise.resolve();
      flush();
      resolveShipping!({ provider: "DHL", price: 25 });
      await Promise.resolve();
      flush();
      resolveTax!({ name: "UK_TAX_REAL", rate: 0.2 });
      await Promise.resolve();
      flush();

      // CRITICAL: Final tax should be the CORRECT value, not stale data
      expect(taxTexts.at(-1)).toBe("UK_TAX_REAL");
      expect(totalValues.at(-1)).toBe(145); // 100 + 20 + 25
    });
  });

  describe("DEBUG: real-world CategoryDisplay flicker reproduction", () => {
    it("should NOT double-flicker isPending on rapid actions when background resolves", async () => {
      // Real-world bug: two rapid category changes (News→Finance→Sports).
      // When action 1's refresh(userCategory) resolves to "Finance",
      // optimisticCategory recomputes (computed="Finance" ≠ override="Sports"),
      // but the VISIBLE override is unchanged. categoryData should NOT recompute
      // and isPending should NOT flicker.

      const categoryItems: Record<string, string[]> = {
        News: ["Daily Brief", "World Report"],
        Finance: ["Stock Ticker", "Market Analysis", "Crypto Watch"],
        Sports: ["Live Scores", "Transfer Rumors", "Match Highlights"]
      };

      let resolveUserPref: ((v: string) => void) | null = null;
      let resolveUpdate1: (() => void) | null = null;
      let resolveUpdate2: (() => void) | null = null;
      let resolveDetails: ((v: string[]) => void) | null = null;

      const userCategory = createMemo(() => {
        return new Promise<string>(res => {
          resolveUserPref = res;
        });
      });

      const [optimisticCategory, setOptimisticCategory] = createOptimistic(() => userCategory());

      const categoryData = createMemo(() => {
        const cat = optimisticCategory();
        return new Promise<string[]>(res => {
          resolveDetails = res;
        });
      });

      const displayedCategory: string[] = [];
      const displayedItems: string[][] = [];
      const pendingValues: boolean[] = [];

      createRoot(() => {
        createRenderEffect(optimisticCategory, v => {
          displayedCategory.push(v);
        });
        createRenderEffect(categoryData, v => {
          displayedItems.push(v);
        });
        createRenderEffect(
          () => isPending(categoryData),
          v => {
            pendingValues.push(v);
          }
        );
      });
      flush();

      // --- Initial load ---
      resolveUserPref!("News");
      await Promise.resolve();
      flush();
      resolveDetails!(categoryItems["News"]);
      await Promise.resolve();
      flush();

      expect(displayedCategory).toEqual(["News"]);
      expect(displayedItems).toEqual([["Daily Brief", "World Report"]]);
      expect(pendingValues.at(-1)).toBe(false);

      // --- ACTION 1: News → Finance ---
      const handleSelect = action(function* (cat: string) {
        setOptimisticCategory(cat);
        yield new Promise<void>(r => {
          if (!resolveUpdate1) resolveUpdate1 = r;
          else resolveUpdate2 = r;
        });
        refresh(userCategory);
      });

      handleSelect("Finance");
      flush();

      expect(optimisticCategory()).toBe("Finance");
      expect(isPending(categoryData)).toBe(true);

      // Category details resolve for Finance
      resolveDetails!(categoryItems["Finance"]);
      await Promise.resolve();
      flush();

      // Lane effects fire, isPending clears
      expect(displayedCategory.at(-1)).toBe("Finance");
      expect(pendingValues.at(-1)).toBe(false);

      // --- ACTION 2: Finance → Sports (before action 1's background completes) ---
      handleSelect("Sports");
      flush();

      expect(optimisticCategory()).toBe("Sports");
      expect(isPending(categoryData)).toBe(true);

      // Category details resolve for Sports
      resolveDetails!(categoryItems["Sports"]);
      await Promise.resolve();
      flush();

      // Lane effects fire, isPending clears
      expect(displayedCategory.at(-1)).toBe("Sports");
      expect(pendingValues.at(-1)).toBe(false);

      // Record pending state before background completes
      const pendingBeforeBackground = [...pendingValues];

      // --- ACTION 1 background completes → refresh(userCategory) ---
      resolveUpdate1!();
      await Promise.resolve();
      flush();

      // userCategory refetches, resolves to "Finance" (action 1's value)
      resolveUserPref!("Finance");
      await Promise.resolve();
      flush();

      // CRITICAL: isPending should NOT have gone true again.
      // The override is still "Sports", so categoryData reads the same value.
      // Even though the computed value of optimisticCategory changed behind the scenes,
      // the visible override hasn't changed.
      expect(pendingValues).toEqual(pendingBeforeBackground);

      // Category details resolve (refetched, same Sports data)
      resolveDetails!(categoryItems["Sports"]);
      await Promise.resolve();
      flush();

      // --- ACTION 2 background completes → refresh(userCategory) ---
      resolveUpdate2!();
      await Promise.resolve();
      flush();

      resolveUserPref!("Sports");
      await Promise.resolve();
      flush();

      resolveDetails!(categoryItems["Sports"]);
      await Promise.resolve();
      flush();

      // Final: Sports confirmed, no pending
      expect(optimisticCategory()).toBe("Sports");
      expect(displayedCategory.at(-1)).toBe("Sports");
      expect(pendingValues.at(-1)).toBe(false);

      // Count flickers: should be exactly 2 (one per action), not 3+
      let flickers = 0;
      for (let i = 1; i < pendingValues.length; i++) {
        if (pendingValues[i] === true && pendingValues[i - 1] === false) flickers++;
      }
      expect(flickers).toBe(2); // One per action, no extras
    });
  });
});
