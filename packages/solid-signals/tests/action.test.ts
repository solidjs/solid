import { action, createRenderEffect, createRoot, createSignal, flush } from "../src/index.js";

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

    it("should return a Promise that resolves with the return value", async () => {
      const myAction = action(function* () {
        return 123;
      });

      const result = myAction();
      expect(result).toBeInstanceOf(Promise);
      expect(await result).toBe(123);
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
          v => {
            values.push(v);
          }
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
      // Value is held during transition
      expect(values).toEqual([0]);
      expect($x()).toBe(0);

      await Promise.resolve();
      flush();
      // Still held
      expect(values).toEqual([0]);
      expect($x()).toBe(0);

      await Promise.resolve();
      // Action complete, final value commits
      expect(values).toEqual([0, 2]);
      expect($x()).toBe(2);
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
          v => {
            values.push(v);
          }
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
          v => {
            aValues.push(v);
          }
        );
        createRenderEffect(
          () => $b(),
          v => {
            bValues.push(v);
          }
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
      await Promise.resolve();

      // B should resolve independently - its final value commits
      expect($b()).toBe(20);
      expect(bValues).toContain(20);

      // A is still running, waiting for more ticks
      // A's value depends on transition behavior

      // Wait for action A to complete
      await Promise.resolve();
      await Promise.resolve();

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

  describe("yield* with helper generators", () => {
    it("should support yield* with sync helper generator", () => {
      const steps: string[] = [];

      function* helper() {
        steps.push("helper-1");
        yield;
        steps.push("helper-2");
        yield;
        steps.push("helper-3");
      }

      const myAction = action(function* () {
        steps.push("start");
        yield* helper();
        steps.push("end");
      });

      myAction();
      expect(steps).toEqual(["start", "helper-1", "helper-2", "helper-3", "end"]);
    });

    it("should support yield* with async helper generator", async () => {
      const [$x, setX] = createSignal(0);
      const steps: string[] = [];

      function* helper() {
        steps.push("helper-start");
        setX(1);
        yield Promise.resolve();
        steps.push("helper-middle");
        setX(2);
        yield Promise.resolve();
        steps.push("helper-end");
      }

      const myAction = action(function* () {
        steps.push("action-start");
        yield* helper();
        steps.push("action-end");
        setX(3);
      });

      myAction();
      flush();
      expect(steps).toEqual(["action-start", "helper-start"]);
      expect($x()).toBe(0); // Held

      await Promise.resolve();
      flush();
      expect(steps).toEqual(["action-start", "helper-start", "helper-middle"]);
      expect($x()).toBe(0); // Still held

      await Promise.resolve();
      expect(steps).toEqual(["action-start", "helper-start", "helper-middle", "helper-end", "action-end"]);
      expect($x()).toBe(3); // Committed
    });

    it("should support nested yield* (helper uses yield* on another helper)", async () => {
      const steps: string[] = [];

      function* innerHelper() {
        steps.push("inner-1");
        yield Promise.resolve();
        steps.push("inner-2");
      }

      function* outerHelper() {
        steps.push("outer-start");
        yield* innerHelper();
        steps.push("outer-end");
      }

      const myAction = action(function* () {
        steps.push("action-start");
        yield* outerHelper();
        steps.push("action-end");
      });

      myAction();
      expect(steps).toEqual(["action-start", "outer-start", "inner-1"]);

      await Promise.resolve();
      expect(steps).toEqual(["action-start", "outer-start", "inner-1", "inner-2", "outer-end", "action-end"]);
    });

    it("should maintain transition context across all delegated yields", async () => {
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

      function* helper() {
        setX(1);
        yield Promise.resolve();
        setX(2);
        yield Promise.resolve();
      }

      const myAction = action(function* () {
        yield* helper();
        setX(3);
      });

      myAction();
      flush();
      // Effect not triggered yet (held)
      expect(effectRuns).toHaveBeenCalledTimes(1);

      await Promise.resolve();
      flush();
      expect(effectRuns).toHaveBeenCalledTimes(1); // Still held

      await Promise.resolve();
      // Action complete, final value commits
      expect(effectRuns).toHaveBeenCalledTimes(2);
      expect(effectRuns).toHaveBeenLastCalledWith(3);
      expect($x()).toBe(3);
    });

    it("should support multiple yield* in sequence", async () => {
      const steps: string[] = [];

      function* helperA() {
        steps.push("A-1");
        yield Promise.resolve();
        steps.push("A-2");
      }

      function* helperB() {
        steps.push("B-1");
        yield Promise.resolve();
        steps.push("B-2");
      }

      const myAction = action(function* () {
        yield* helperA();
        yield* helperB();
      });

      myAction();
      expect(steps).toEqual(["A-1"]);

      await Promise.resolve();
      expect(steps).toEqual(["A-1", "A-2", "B-1"]);

      await Promise.resolve();
      expect(steps).toEqual(["A-1", "A-2", "B-1", "B-2"]);
    });

    it("should pass values through yield* correctly", async () => {
      const received: any[] = [];

      function* helper(): Generator<Promise<number>, string, number> {
        const a = yield Promise.resolve(1);
        received.push(a);
        const b = yield Promise.resolve(2);
        received.push(b);
        return "helper-result";
      }

      const myAction = action(function* () {
        const result = yield* helper();
        received.push(result);
        return "action-result";
      });

      const promise = myAction();

      await Promise.resolve();
      await Promise.resolve();

      expect(received).toEqual([1, 2, "helper-result"]);
      expect(await promise).toBe("action-result");
    });
  });

  describe("error handling", () => {
    it("should allow try/catch inside generator for yielded promise rejections", async () => {
      const steps: string[] = [];

      const myAction = action(function* () {
        steps.push("start");
        try {
          yield Promise.reject(new Error("test error"));
          steps.push("unreachable");
        } catch (e: any) {
          steps.push("caught: " + e.message);
        }
        steps.push("end");
      });

      await myAction();
      expect(steps).toEqual(["start", "caught: test error", "end"]);
    });

    it("should reject the promise for uncaught errors", async () => {
      const myAction = action(function* () {
        yield Promise.reject(new Error("uncaught error"));
      });

      await expect(myAction()).rejects.toThrow("uncaught error");
    });

    it("should reject the promise when generator throws synchronously", async () => {
      const myAction = action(function* () {
        throw new Error("sync error");
      });

      await expect(myAction()).rejects.toThrow("sync error");
    });

    it("should reject the promise when generator throws after yield", async () => {
      const myAction = action(function* () {
        yield Promise.resolve();
        throw new Error("error after yield");
      });

      await expect(myAction()).rejects.toThrow("error after yield");
    });

    it("should remove action from transition on error but let transition continue", async () => {
      const [$x, setX] = createSignal(0);

      const errorAction = action(function* () {
        setX(1);
        yield Promise.reject(new Error("error"));
      });

      const successAction = action(function* () {
        setX(v => v + 10);
        yield Promise.resolve();
        yield Promise.resolve();
        setX(v => v + 100);
      });

      // Start both actions in the same transition
      const errorPromise = errorAction();
      successAction();
      flush();
      expect($x()).toBe(0); // Held

      await Promise.resolve();
      // Error action fails, but success action continues
      await expect(errorPromise).rejects.toThrow("error");

      await Promise.resolve();
      // Success action completes, transition commits
      expect($x()).toBe(111); // 1 + 10 + 100
    });

    it("should allow recovery and continuation after caught error", async () => {
      const [$x, setX] = createSignal(0);

      const myAction = action(function* () {
        setX(1);
        try {
          yield Promise.reject(new Error("recoverable"));
        } catch {
          setX(2); // Recover
        }
        yield Promise.resolve();
        setX(3);
      });

      await myAction();
      expect($x()).toBe(3);
    });

    it("should handle errors in yield* delegated generators", async () => {
      const steps: string[] = [];

      function* helper(): Generator<Promise<void>, void, void> {
        steps.push("helper-start");
        yield Promise.reject(new Error("helper error"));
        steps.push("helper-unreachable");
      }

      const myAction = action(function* () {
        steps.push("action-start");
        try {
          yield* helper();
        } catch (e: any) {
          steps.push("caught: " + e.message);
        }
        steps.push("action-end");
      });

      await myAction();
      expect(steps).toEqual(["action-start", "helper-start", "caught: helper error", "action-end"]);
    });
  });

  describe("promise return", () => {
    it("should resolve with the generator return value", async () => {
      const myAction = action(function* () {
        yield Promise.resolve();
        return 42;
      });

      expect(await myAction()).toBe(42);
    });

    it("should support await for waiting on action completion", async () => {
      const [$x, setX] = createSignal(0);

      const myAction = action(function* () {
        setX(1);
        yield Promise.resolve();
        setX(2);
        return "done";
      });

      const result = await myAction();
      expect(result).toBe("done");
      expect($x()).toBe(2);
    });

    it("should support Promise.all for parallel actions", async () => {
      const [$x, setX] = createSignal(0);
      const steps: string[] = [];

      const actionA = action(function* () {
        steps.push("A-start");
        setX(v => v + 1);
        yield Promise.resolve();
        steps.push("A-end");
        return "A";
      });

      const actionB = action(function* () {
        steps.push("B-start");
        setX(v => v + 10);
        yield Promise.resolve();
        steps.push("B-end");
        return "B";
      });

      const results = await Promise.all([actionA(), actionB()]);

      expect(results).toEqual(["A", "B"]);
      expect(steps).toContain("A-start");
      expect(steps).toContain("B-start");
      expect(steps).toContain("A-end");
      expect(steps).toContain("B-end");
      expect($x()).toBe(11);
    });

    it("should support yielding another action's promise", async () => {
      const [$x, setX] = createSignal(0);
      const steps: string[] = [];

      const innerAction = action(function* () {
        steps.push("inner-start");
        setX(v => v + 10);
        yield Promise.resolve();
        steps.push("inner-end");
        return "inner-result";
      });

      const outerAction = action(function* () {
        steps.push("outer-start");
        setX(1);
        const innerResult = yield innerAction();
        steps.push("got: " + innerResult);
        setX(v => v + 100);
        steps.push("outer-end");
        return "outer-result";
      });

      const result = await outerAction();

      expect(result).toBe("outer-result");
      expect(steps).toEqual([
        "outer-start",
        "inner-start",
        "inner-end",
        "got: inner-result",
        "outer-end"
      ]);
      expect($x()).toBe(111); // 1 + 10 + 100
    });

    it("should resolve immediately for sync actions", async () => {
      const myAction = action(function* () {
        return "immediate";
      });

      // Should resolve in the same tick
      let resolved = false;
      myAction().then(() => {
        resolved = true;
      });

      // Promise resolves in microtask
      await Promise.resolve();
      expect(resolved).toBe(true);
    });
  });

  describe("attempt helper pattern", () => {
    // Go-style error handling: [result, error] tuple
    type AttemptResult<T, E = Error> = [T, undefined] | [undefined, E];

    function* attempt<T>(
      promise: Promise<T>
    ): Generator<Promise<T>, AttemptResult<T>, T> {
      try {
        const result: T = yield promise;
        return [result, undefined];
      } catch (e) {
        return [undefined, e instanceof Error ? e : new Error(String(e))];
      }
    }

    it("should return [value, undefined] on success", async () => {
      const myAction = action(function* () {
        const [res, err] = yield* attempt(Promise.resolve(42));
        return { res, err };
      });

      const result = await myAction();
      expect(result.res).toBe(42);
      expect(result.err).toBeUndefined();
    });

    it("should return [undefined, error] on failure", async () => {
      const myAction = action(function* () {
        const [res, err] = yield* attempt(Promise.reject<string>(new Error("test error")));
        return { res, err };
      });

      const result = await myAction();
      expect(result.res).toBeUndefined();
      expect(result.err).toBeInstanceOf(Error);
      expect(result.err?.message).toBe("test error");
    });

    it("should convert non-Error rejections to Error", async () => {
      const myAction = action(function* () {
        const [res, err] = yield* attempt(Promise.reject<string>("string error"));
        return { res, err };
      });

      const result = await myAction();
      expect(result.res).toBeUndefined();
      expect(result.err).toBeInstanceOf(Error);
      expect(result.err?.message).toBe("string error");
    });

    it("should hold signal updates during attempt and commit after action completes", async () => {
      const [$x, setX] = createSignal(0);
      const values: number[] = [];

      createRoot(() => {
        createRenderEffect(
          () => $x(),
          v => {
            values.push(v);
          }
        );
      });

      flush();
      expect(values).toEqual([0]);

      const myAction = action(function* () {
        setX(1);
        const [, err] = yield* attempt(Promise.resolve("success"));
        if (!err) {
          setX(2);
        }
        yield Promise.resolve(); // Another async point
        setX(3);
      });

      const promise = myAction();

      // During action - values should be held (transition pending)
      flush();
      expect(values).toEqual([0]); // Still held

      await promise;

      // After action completes - all updates committed
      expect($x()).toBe(3);
      expect(values).toEqual([0, 3]); // Batched update
    });

    it("should properly narrow types after error check (TypeScript validation)", async () => {
      const myAction = action(function* () {
        const [res, err] = yield* attempt(Promise.resolve({ id: 1, name: "test" }));

        if (err) {
          // err is narrowed to Error, res is narrowed to undefined
          return { error: err.message };
        }

        // res is narrowed to { id: number, name: string }
        return { id: res.id, name: res.name };
      });

      const result = await myAction();
      expect(result).toEqual({ id: 1, name: "test" });
    });

    it("should work with async generator actions", async () => {
      const myAction = action(async function* () {
        const [res, err] = yield* attempt(Promise.resolve(100));
        if (err) {
          return -1;
        }
        return res * 2;
      });

      const result = await myAction();
      expect(result).toBe(200);
    });

    it("should allow multiple attempt calls in sequence", async () => {
      const myAction = action(function* () {
        const [a, errA] = yield* attempt(Promise.resolve(1));
        if (errA) return { error: "a failed" };

        const [b, errB] = yield* attempt(Promise.resolve(2));
        if (errB) return { error: "b failed" };

        const [c, errC] = yield* attempt(Promise.reject<number>(new Error("c failed")));
        if (errC) return { error: errC.message, partial: a + b };

        return { sum: a + b + c! };
      });

      const result = await myAction();
      expect(result).toEqual({ error: "c failed", partial: 3 });
    });

    it("should maintain transition context across multiple attempts", async () => {
      const [$x, setX] = createSignal(0);

      const myAction = action(function* () {
        setX(1);
        const [, err1] = yield* attempt(Promise.resolve());
        if (err1) return;

        setX(2);
        const [, err2] = yield* attempt(Promise.resolve());
        if (err2) return;

        setX(3);
      });

      await myAction();
      expect($x()).toBe(3);
    });
  });
});
