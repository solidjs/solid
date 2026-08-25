// #2918: a yielded thenable whose `then` getter or `then()` method throws
// synchronously must not leak the action's iterator in its transition.
// Assimilation failures behave like `await` of the same value: the error is
// thrown back into the generator at the yield point (catchable there); if
// uncaught, the action settles through done(failed) and pre-yield plain
// writes commit when the transition completes.

import { describe, expect, it } from "vitest";
import { action, createSignal, flush } from "../src/index.js";

describe("action thenable assimilation failures (#2918)", () => {
  it("rejects and commits pre-yield writes when a yielded thenable's `then` getter throws", async () => {
    const [value, setValue] = createSignal(0);

    const badThenable = Object.defineProperty({}, "then", {
      get() {
        throw new Error("then getter failed");
      }
    });

    const run = action(function* () {
      setValue(1);
      yield badThenable as PromiseLike<void>;
    });

    await expect(run()).rejects.toThrow("then getter failed");

    flush();
    // Plain writes before an action rejection commit.
    expect(value()).toBe(1);

    // Later writes to the same signal must remain usable.
    setValue(2);
    flush();
    expect(value()).toBe(2);
  });

  it("rejects and commits pre-yield writes when a yielded thenable's `then()` method throws", async () => {
    const [value, setValue] = createSignal(0);

    const badThenable = {
      then() {
        throw new Error("then call failed");
      }
    };

    const run = action(function* () {
      setValue(1);
      yield badThenable as unknown as PromiseLike<void>;
    });

    await expect(run()).rejects.toThrow("then call failed");

    flush();
    expect(value()).toBe(1);

    setValue(2);
    flush();
    expect(value()).toBe(2);
  });

  it("throws the assimilation failure back into the generator at the yield point", async () => {
    const steps: string[] = [];

    const badThenable = {
      then() {
        throw new Error("assimilation boom");
      }
    };

    const run = action(function* () {
      steps.push("start");
      try {
        yield badThenable as unknown as PromiseLike<void>;
        steps.push("unreachable");
      } catch (e: any) {
        steps.push("caught: " + e.message);
      }
      steps.push("end");
    });

    await run();
    expect(steps).toEqual(["start", "caught: assimilation boom", "end"]);
  });

  it("ignores a `then()` throw after the thenable already settled synchronously (A+ 2.3.3.3.4.1)", async () => {
    const [value, setValue] = createSignal(0);

    const settleThenThrow = {
      then(onFulfilled: (v: unknown) => void) {
        onFulfilled(42);
        throw new Error("post-settle throw");
      }
    };

    let resumed: unknown;
    const run = action(function* () {
      setValue(1);
      resumed = yield settleThenThrow as unknown as PromiseLike<number>;
      setValue(2);
    });

    await run();
    expect(resumed).toBe(42);
    flush();
    expect(value()).toBe(2);
  });
});
