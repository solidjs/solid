import { describe, expect, it } from "vitest";
import { action, createEffect, createRoot, createSignal, flush } from "../src/index.js";

// #2913 — ruled behaves-as-designed (maintainer, 2026-07-17). See A26 in
// SPEC-ASYNC-SEMANTICS.md.
//
// A post-`await` continuation inside an action's async generator runs as a
// bare promise job: the driver only regains control at yield boundaries, so
// there is nothing to carry the transition across an internal `await` (no
// AsyncContext in the platform). Holding `activeTransition` open across the
// await window instead would capture unrelated ambient writes (a user click
// during `await fetch`) into the action's transaction — worse than the leak.
//
// The contract: `yield` is the transaction-safe suspension point. `await` is
// welcome for its TypeScript ergonomics (typed results), but a bare `yield`
// must come before any writes that follow it — that re-enters the
// transaction for the rest of the segment.

function deferred<T = void>() {
  let resolve!: (v: T) => void, reject!: (e: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const microtasks = async (n = 5) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

describe("action() transaction boundaries across await (#2913, A26)", () => {
  it("documented escape: a write between `await` and the next `yield` commits ambiently", async () => {
    const gate = deferred();
    const hold = deferred();

    const [x, setX] = createSignal(0);
    const [y, setY] = createSignal(0);

    const act = action(async function* () {
      setX(1); // sync segment: held by the transaction
      await gate.promise; // continuation runs outside the driver
      setY(5); // escapes — documented limitation
      yield hold.promise;
      setX(2);
    });

    const done = act();
    flush();
    gate.resolve();
    await microtasks();
    flush();

    // Mid-flight: the pre-await write is held, the post-await write leaked.
    expect(x()).toBe(0);
    expect(y()).toBe(5);

    hold.resolve();
    await microtasks();
    flush();
    await done;
    flush();
    expect(x()).toBe(2);
  });

  it("the idiom: `await` for typed results, bare `yield` before writing", async () => {
    const gate = deferred<number>();
    const hold = deferred();

    const [y, setY] = createSignal(0);
    const yLog: number[] = [];

    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      createEffect(
        () => y(),
        v => {
          yLog.push(v);
        }
      );
    });
    flush();

    const act = action(async function* () {
      const value = await gate.promise; // typed: number
      yield; // re-enter the transaction before writing
      setY(value);
      yield hold.promise;
    });

    const done = act();
    flush();
    gate.resolve(5);
    await microtasks();
    flush();

    // Mid-flight: the write after the bare yield is held by the transaction.
    expect(y()).toBe(0);
    expect(yLog).toEqual([0]);

    hold.resolve();
    await microtasks();
    flush();
    await done;
    flush();
    expect(y()).toBe(5);
    expect(yLog).toEqual([0, 5]);
    dispose();
  });

  it("yielding the promise batches the same way (untyped alternative)", async () => {
    const gate = deferred<number>();
    const hold = deferred();

    const [y, setY] = createSignal(0);

    const act = action(async function* () {
      const value = yield gate.promise; // works, but the result is untyped
      setY(value as number);
      yield hold.promise;
    });

    const done = act();
    flush();
    gate.resolve(7);
    await microtasks();
    flush();

    expect(y()).toBe(0); // held

    hold.resolve();
    await microtasks();
    flush();
    await done;
    flush();
    expect(y()).toBe(7);
  });

  it("signals written before the await rejoin the transaction after it", async () => {
    const gate = deferred();
    const hold = deferred();

    const [x, setX] = createSignal(0);

    const act = action(async function* () {
      setX(1); // stamps the signal with the transaction
      await gate.promise;
      setX(2); // rejoins via the _transition stamp despite the bare continuation
      yield hold.promise;
    });

    const done = act();
    flush();
    gate.resolve();
    await microtasks();
    flush();

    expect(x()).toBe(0); // both writes held

    hold.resolve();
    await microtasks();
    flush();
    await done;
    flush();
    expect(x()).toBe(2);
  });
});
