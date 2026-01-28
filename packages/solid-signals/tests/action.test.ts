import {
  action,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "../src/index.js";

afterEach(() => flush());

describe("action", () => {
  describe("basic behavior", () => {
    it("should create a callable function from a generator", () => {
      const myAction = action(function* () {
        // empty generator
      });
      expect(myAction).toBeInstanceOf(Function);
    });

    it("should execute generator body synchronously for sync yields", () => {
      const calls: string[] = [];

      const myAction = action(function* () {
        calls.push("start");
        yield;
        calls.push("after yield");
      });

      myAction();
      expect(calls).toEqual(["start", "after yield"]);
    });

    it("should pass arguments through to the generator function", () => {
      const receivedArgs: any[] = [];

      const myAction = action(function* (a: number, b: string, c: boolean) {
        receivedArgs.push(a, b, c);
      });

      myAction(42, "hello", true);
      expect(receivedArgs).toEqual([42, "hello", true]);
    });

    it("should return void (fire-and-forget pattern)", () => {
      const myAction = action(function* () {
        return 123;
      });

      const result = myAction();
      expect(result).toBeUndefined();
    });
  });

  describe("generator control flow", () => {
    it("should step through multiple yield statements in sequence", () => {
      const steps: number[] = [];

      const myAction = action(function* () {
        steps.push(1);
        yield;
        steps.push(2);
        yield;
        steps.push(3);
      });

      myAction();
      expect(steps).toEqual([1, 2, 3]);
    });

    it("should handle generators that complete immediately (no yields)", () => {
      const executed = vi.fn();

      const myAction = action(function* () {
        executed();
      });

      myAction();
      expect(executed).toHaveBeenCalledTimes(1);
    });

    it("should handle generators with only sync yields", () => {
      const values: number[] = [];

      const myAction = action(function* () {
        values.push(1);
        yield "a";
        values.push(2);
        yield "b";
        values.push(3);
        yield "c";
        values.push(4);
      });

      myAction();
      expect(values).toEqual([1, 2, 3, 4]);
    });

    it("should pass yielded values back into generator via yield expression result", () => {
      const results: any[] = [];

      const myAction = action(function* () {
        const a = yield "first";
        results.push(a);
        const b = yield "second";
        results.push(b);
      });

      myAction();
      // Sync yields pass back the yielded value itself
      expect(results).toEqual(["first", "second"]);
    });
  });

  describe("async handling", () => {
    it("should await yielded promises before continuing", async () => {
      const steps: string[] = [];

      const myAction = action(function* () {
        steps.push("before");
        yield Promise.resolve();
        steps.push("after");
      });

      myAction();
      expect(steps).toEqual(["before"]);

      await Promise.resolve();
      expect(steps).toEqual(["before", "after"]);
    });

    it("should pass resolved promise value back to generator", async () => {
      let receivedValue: any;

      const myAction = action(function* () {
        receivedValue = yield Promise.resolve(42);
      });

      myAction();
      await Promise.resolve();
      expect(receivedValue).toBe(42);
    });

    it("should handle multiple async yields in sequence", async () => {
      const values: number[] = [];

      const myAction = action(function* () {
        values.push(1);
        yield Promise.resolve();
        values.push(2);
        yield Promise.resolve();
        values.push(3);
      });

      myAction();
      expect(values).toEqual([1]);

      await Promise.resolve();
      expect(values).toEqual([1, 2]);

      await Promise.resolve();
      expect(values).toEqual([1, 2, 3]);
    });

    it("should maintain transition context across async boundaries", async () => {
      const [$x, setX] = createSignal(0);
      const values: number[] = [];

      createRoot(() => {
        createRenderEffect(
          () => $x(),
          v => { values.push(v); }
        );
      });

      flush();
      expect(values).toEqual([0]);

      const myAction = action(function* () {
        setX(1);
        yield Promise.resolve();
        // Update again in the same transition
        setX(2);
        yield Promise.resolve();
      });

      myAction();
      flush();
      // First update applied
      expect(values).toEqual([0, 1]);
      expect($x()).toBe(1);

      await Promise.resolve();
      flush();
      // Second update needs another tick
      expect(values).toEqual([0, 1, 2]);
      expect($x()).toBe(2);

      await Promise.resolve();
      // Action complete
      expect(values).toEqual([0, 1, 2]);
    });
  });

  describe("transition management", () => {
    it("should initialize a transition when action starts", async () => {
      const [$x, setX] = createSignal(0);

      const myAction = action(function* () {
        setX(1);
        yield Promise.resolve();
      });

      myAction();
      flush();
      // Value is held (indicating transition is active)
      expect($x()).toBe(0);

      await Promise.resolve();
      expect($x()).toBe(1);
    });

    it("should keep transition alive while action is running", async () => {
      const [$x, setX] = createSignal(0);
      const reads: number[] = [];

      const myAction = action(function* () {
        setX(1);
        yield Promise.resolve();
        reads.push($x()); // Should still see held value
        setX(2);
        yield Promise.resolve();
        reads.push($x()); // Still held
      });

      myAction();
      flush();

      await Promise.resolve();
      expect(reads).toEqual([0]); // Transition holds value

      await Promise.resolve();
      expect(reads).toEqual([0, 0]); // Still held
      expect($x()).toBe(2); // Now committed
    });

    it("should complete transition when action finishes", async () => {
      const [$x, setX] = createSignal(0);
      const values: number[] = [];

      createRoot(() => {
        createRenderEffect(
          () => $x(),
          v => { values.push(v); }
        );
      });

      flush();

      const myAction = action(function* () {
        setX(5);
        yield Promise.resolve();
      });

      myAction();
      flush();
      expect(values).toEqual([0]); // Held

      await Promise.resolve();
      // Action finished, transition commits
      expect(values).toEqual([0, 5]);
    });

    it("should complete transition and commit final values when action finishes", async () => {
      const [$a, setA] = createSignal(1);
      const [$b, setB] = createSignal(10);

      const myAction = action(function* () {
        setA(2);
        setB(20);
        yield Promise.resolve();
        setA(3);
        yield Promise.resolve();
      });

      myAction();
      flush();
      
      // Wait for action to complete
      await Promise.resolve();
      flush();
      await Promise.resolve();
      flush();

      // Final values are committed
      expect($a()).toBe(3);
      expect($b()).toBe(20);
    });
  });

  describe("multiple actions", () => {
    it("should allow multiple concurrent actions in same transition", async () => {
      const [$x, setX] = createSignal(0);
      const steps: string[] = [];

      const action1 = action(function* () {
        steps.push("a1-start");
        setX(v => v + 1);
        yield Promise.resolve();
        steps.push("a1-end");
      });

      const action2 = action(function* () {
        steps.push("a2-start");
        setX(v => v + 10);
        yield Promise.resolve();
        steps.push("a2-end");
      });

      action1();
      action2();
      flush();
      expect(steps).toEqual(["a1-start", "a2-start"]);
      expect($x()).toBe(0); // Held

      await Promise.resolve();
      expect(steps).toEqual(["a1-start", "a2-start", "a1-end", "a2-end"]);
      expect($x()).toBe(11); // Both committed
    });

    it("should only complete transition when ALL actions finish", async () => {
      const [$x, setX] = createSignal(0);

      const shortAction = action(function* () {
        setX(1);
        yield Promise.resolve();
      });

      const longAction = action(function* () {
        setX(2);
        yield Promise.resolve();
        yield Promise.resolve();
        yield Promise.resolve();
        setX(3);
      });

      shortAction();
      longAction();
      flush();
      expect($x()).toBe(0);

      await Promise.resolve();
      // Short action done, but long action still running
      expect($x()).toBe(0);

      await Promise.resolve();
      expect($x()).toBe(0);

      await Promise.resolve();
      // Now both are done
      expect($x()).toBe(3);
    });

    it("should merge actions when one action calls another", async () => {
      const [$x, setX] = createSignal(0);
      const steps: string[] = [];

      const innerAction = action(function* () {
        steps.push("inner-start");
        setX(v => v + 100);
        yield Promise.resolve();
        steps.push("inner-end");
      });

      const outerAction = action(function* () {
        steps.push("outer-start");
        setX(1);
        innerAction(); // Call another action
        yield Promise.resolve();
        steps.push("outer-end");
      });

      outerAction();
      flush();
      expect(steps).toEqual(["outer-start", "inner-start"]);
      // Value is held during transition
      expect($x()).toBe(0);

      await Promise.resolve();
      // Inner completes before outer because it was started first in the same tick
      expect(steps).toEqual(["outer-start", "inner-start", "inner-end", "outer-end"]);
      // Both actions' changes committed: setX(1) then setX(v + 100) = 101
      expect($x()).toBe(101);
    });

    it("should isolate independent transitions that don't share signals", async () => {
      // Two completely independent signal/effect pairs
      const [$a, setA] = createSignal(0);
      const [$b, setB] = createSignal(0);
      const aValues: number[] = [];
      const bValues: number[] = [];

      createRoot(() => {
        createRenderEffect(
          () => $a(),
          v => { aValues.push(v); }
        );
        createRenderEffect(
          () => $b(),
          v => { bValues.push(v); }
        );
      });

      flush();
      expect(aValues).toEqual([0]);
      expect(bValues).toEqual([0]);

      // Action A - takes 3 ticks
      const actionA = action(function* () {
        setA(1);
        yield Promise.resolve();
        yield Promise.resolve();
        yield Promise.resolve();
        setA(2);
      });

      // Action B - takes 1 tick, started separately
      const actionB = action(function* () {
        setB(10);
        yield Promise.resolve();
        setB(20);
      });

      // Start action A first
      actionA();
      flush();

      // Start action B after a tick (separate transition)
      await Promise.resolve();
      actionB();
      flush();

      // Action B completes quickly
      await Promise.resolve();
      flush();
      // B should resolve independently - its final value commits
      expect($b()).toBe(20);
      expect(bValues).toContain(20);

      // A is still running, waiting for more ticks
      // A's value depends on transition behavior

      // Wait for action A to complete
      await Promise.resolve();
      flush();
      await Promise.resolve();
      flush();

      // Now A should be complete with its final value
      expect($a()).toBe(2);
      expect(aValues).toContain(2);
    });
  });

  describe("signal integration", () => {
    it("should hold regular signal updates during action", async () => {
      const [$x, setX] = createSignal(0);

      const myAction = action(function* () {
        setX(1);
        yield Promise.resolve();
        setX(2);
        yield Promise.resolve();
      });

      myAction();
      flush();
      expect($x()).toBe(0);

      await Promise.resolve();
      expect($x()).toBe(0);

      await Promise.resolve();
      expect($x()).toBe(2);
    });

    it("should flush held signals when action completes", async () => {
      const [$x, setX] = createSignal(0);
      const effectRuns = vi.fn();

      createRoot(() => {
        createRenderEffect(
          () => $x(),
          v => effectRuns(v)
        );
      });

      flush();
      expect(effectRuns).toHaveBeenCalledTimes(1);
      expect(effectRuns).toHaveBeenLastCalledWith(0);

      const myAction = action(function* () {
        setX(5);
        yield Promise.resolve();
      });

      myAction();
      flush();
      // Effect not triggered yet (held)
      expect(effectRuns).toHaveBeenCalledTimes(1);

      await Promise.resolve();
      // Now effect runs with committed value
      expect(effectRuns).toHaveBeenCalledTimes(2);
      expect(effectRuns).toHaveBeenLastCalledWith(5);
    });

    it("should commit final signal values when action completes", async () => {
      const [$a, setA] = createSignal(1);
      const [$b, setB] = createSignal(2);
      const [$c, setC] = createSignal(3);

      const myAction = action(function* () {
        setA(10);
        setB(20);
        yield Promise.resolve();
        setC(30);
        yield Promise.resolve();
      });

      myAction();
      flush();

      // Wait for action to complete
      await Promise.resolve();
      flush();
      await Promise.resolve();
      flush();

      // Final values are committed
      expect($a()).toBe(10);
      expect($b()).toBe(20);
      expect($c()).toBe(30);
    });
  });

  describe("edge cases", () => {
    it("should handle empty generator (immediate return)", () => {
      const executed = vi.fn();

      const myAction = action(function* () {
        executed();
        return;
      });

      myAction();
      expect(executed).toHaveBeenCalledTimes(1);
    });

    it("should handle generator that yields undefined", () => {
      const steps: string[] = [];

      const myAction = action(function* () {
        steps.push("before");
        yield undefined;
        steps.push("after");
      });

      myAction();
      expect(steps).toEqual(["before", "after"]);
    });

    it("should work with async generators", async () => {
      const steps: string[] = [];

      const myAction = action(async function* () {
        steps.push("start");
        yield await Promise.resolve("first");
        steps.push("middle");
        yield await Promise.resolve("second");
        steps.push("end");
      });

      myAction();
      // Async generator starts and runs to first yield synchronously
      // (the `await` inside happens before yield, not after)
      expect(steps).toContain("start");

      // Need multiple ticks for async generator iteration
      await new Promise(r => setTimeout(r, 0));
      expect(steps).toContain("middle");

      await new Promise(r => setTimeout(r, 0));
      expect(steps).toContain("end");
    });

    it("should handle action called multiple times", async () => {
      const [$x, setX] = createSignal(0);
      let callCount = 0;

      const myAction = action(function* (increment: number) {
        callCount++;
        setX(v => v + increment);
        yield Promise.resolve();
      });

      myAction(1);
      myAction(10);
      myAction(100);
      flush();

      expect(callCount).toBe(3);
      expect($x()).toBe(0); // All held

      await Promise.resolve();
      expect($x()).toBe(111); // All committed
    });
  });
});
