// #2916: when an action's done() restores activeTransition (without adopting
// the ambient batch) and the shared transition is still incomplete, an
// ordinary write in the microtask window before the scheduled flush lands in
// the detached ambient batch. The incomplete-transition stash then replaced
// that batch wholesale, stranding the queued pending node: the write never
// committed and every later write to the same signal stayed frozen (dev
// INV-7).

import { describe, expect, it } from "vitest";
import { action, createSignal, flush } from "../src/index.js";
import * as scheduler from "../src/core/scheduler.js";

const tick = () => Promise.resolve();

describe("post-action completion race (#2916)", () => {
  it("commits an ambient write made between an action's done() and its scheduled flush", async () => {
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
    flush(); // stash the shared incomplete transition

    resolveA();

    // Write in the window where A's done() has restored activeTransition but
    // its scheduled flush has not run. The internal read only makes the
    // timing deterministic; the write itself is an ordinary application
    // write.
    let wrote = false;
    for (let i = 0; i < 16; i++) {
      await tick();
      if (!wrote && scheduler.activeTransition !== null) {
        wrote = true;
        setY(7);
      }
    }
    expect(wrote).toBe(true);

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
