// #2916: a write between action completion and a pending scheduler flush must
// commit and leave the signal writable, even while another action is open.
// The original stranded pending node violated INV-7 on the next flush.

import { afterEach, describe, expect, it, vi } from "vitest";
import { action, createSignal, flush } from "../src/index.js";

afterEach(() => vi.restoreAllMocks());

// Hold scheduler flushes while Promise callbacks complete the action.
// Await its result, inject the operation, then release the held callbacks.
// The callbacks can come from joining or completing a transaction.
async function inDoneWindow(done: Promise<void>, complete: () => void, operation: () => void) {
  const queued: VoidFunction[] = [];
  const events: string[] = [];
  const microtask = vi.spyOn(globalThis, "queueMicrotask").mockImplementation(callback => {
    queued.push(() => {
      events.push("flush");
      callback();
    });
  });
  try {
    complete();
    await done;
    events.push("done");
    expect(queued.length).toBeGreaterThan(0);
    expect(events).toEqual(["done"]);
    operation();
    events.push("operation");
    expect(events).toEqual(["done", "operation"]);
    while (queued.length) queued.shift()!();
    expect(events[2]).toBe("flush");
  } finally {
    microtask.mockRestore();
    while (queued.length) queued.shift()!();
  }
}

describe("post-action completion race (#2916)", () => {
  it("commits an ambient write after an action completes and before a pending flush", async () => {
    const [y, setY] = createSignal(0);

    let resolveA!: () => void;
    const pA = new Promise<void>(r => (resolveA = r));
    let resolveB!: () => void;
    const pB = new Promise<void>(r => (resolveB = r));

    // A must be an async generator: its done() runs from the iterator-result
    // microtask with no synchronous flush after it, opening the window.
    const A = action(async function* () {
      yield pA;
    });
    const B = action(function* () {
      yield pB;
    });

    const aDone = A();
    const bDone = B();
    flush();
    await Promise.resolve(); // drain the initial scheduled flush before interception

    let bCompleted = false;
    void bDone.then(() => {
      bCompleted = true;
    });
    await inDoneWindow(aDone, resolveA, () => {
      expect(bCompleted).toBe(false);
      setY(7);
    });

    resolveB();
    await Promise.all([aDone, bDone]);

    flush(); // dev INV-7 threw here pre-fix

    expect(y()).toBe(7);

    // The signal must remain usable after the transition completes.
    setY(9);
    flush();
    expect(y()).toBe(9);
  });
});
