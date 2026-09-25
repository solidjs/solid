/**
 * A lane landing calls a user `equals` as `(prev, next)` — the order every
 * other commit path uses (sync recompute, the plain async landing, verdicts,
 * optimistic folds). A comparator keyed on which side is incoming
 * (`dynamic`'s binding gate delivers `next`'s address) must read a landing
 * under an optimistic lane the same way it reads any other commit; the lane
 * branch of `asyncWrite` used to hand it `(next, prev)`.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  flush
} from "../src/index.js";

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

async function tick(n = 4) {
  for (let i = 0; i < n; i++) await Promise.resolve();
  flush();
}

describe("asyncWrite lane landing: comparator argument order", () => {
  it("calls a user equals as (prev, next) when the landing routes through an optimistic lane", async () => {
    const [opt, setOpt] = createOptimistic(0);
    const gates = { current: deferred() };
    const calls: Array<[unknown, unknown]> = [];
    const shown: unknown[] = [];
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const derived = createMemo(
        async () => {
          const v = opt();
          await gates.current.promise;
          return { v };
        },
        {
          equals: (prev, next) => {
            calls.push([prev, next]);
            return false;
          }
        }
      );
      createRenderEffect(derived, v => void shown.push(v));
    });
    flush();
    const mountGate = gates.current;
    gates.current = deferred();
    mountGate.resolve();
    await tick();
    expect(shown).toEqual([{ v: 0 }]);
    // The first landing initializes the node: no comparison.
    expect(calls).toEqual([]);

    const gate = gates.current;
    const hold = deferred();
    const act = action(function* () {
      setOpt(1);
      yield hold.promise;
    });
    const done = act();
    await tick();
    gate.resolve();
    await tick();
    hold.resolve();
    await done;
    await tick();

    // The landing under the lane compared the held value against the
    // incoming one — `prev` first, `next` second. (The optimistic value
    // reverts once the action completes; only the lane landing is under
    // test here.)
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]).toEqual([{ v: 0 }, { v: 1 }]);
    expect(shown.slice(0, 2)).toEqual([{ v: 0 }, { v: 1 }]);
    dispose();
  });
});
