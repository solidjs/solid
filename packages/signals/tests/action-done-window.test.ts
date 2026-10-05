// #2916: inject work after an async action completes but before a pending
// flush. Assert both the ordering and the eventual write/revert/release.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  action,
  affects,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending
} from "../src/index.js";

const tick = () => Promise.resolve();

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

describe("post-action done() window", () => {
  it("a completed action's write survives another action resuming in its done-window", async () => {
    const [x, setX] = createSignal(0);

    let resolveA!: () => void;
    const pA = new Promise<void>(r => (resolveA = r));

    const A = action(async function* () {
      setX(1);
      yield pA;
    });

    // B yields a custom thenable so the test controls exactly when B resumes.
    let resumeB!: (v?: any) => void;
    let hasResumeB = false;
    const thenB = {
      then(onFulfilled: (v: any) => void) {
        resumeB = onFulfilled;
        hasResumeB = true;
      }
    };
    const B = action(function* () {
      yield thenB as any;
    });

    const aDone = A();
    flush(); // stash T_A
    await tick();
    const bDone = B(); // B remains open until its controlled thenable resumes.
    flush(); // stash T_B

    await tick(); // drain the initial scheduled flushes
    let bCompleted = false;
    void bDone.then(() => {
      bCompleted = true;
    });
    await inDoneWindow(aDone, resolveA, () => {
      expect(hasResumeB).toBe(true);
      expect(bCompleted).toBe(false);
      resumeB(undefined);
    });

    await Promise.all([aDone, bDone]);
    await new Promise(r => setTimeout(r, 0));
    flush();

    expect(x()).toBe(1);

    // And the signal must remain writable afterwards.
    setX(9);
    flush();
    expect(x()).toBe(9);
  });

  it("a bare optimistic write in the done-window still reverts", async () => {
    const [opt, setOpt] = createOptimistic(0);
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const m = createMemo(() => opt() * 2);
      createRenderEffect(m, () => {});
    });
    flush();

    let resolveA!: () => void;
    const pA = new Promise<void>(r => (resolveA = r));
    const A = action(async function* () {
      yield pA;
    });
    const aDone = A();
    flush();

    await tick(); // drain the initial scheduled flush
    await inDoneWindow(aDone, resolveA, () => {
      setOpt(5);
    });

    await aDone;
    await new Promise(r => setTimeout(r, 0));
    flush();
    flush();

    // Every batch that could own the write has settled: it must have reverted.
    expect(opt()).toBe(0);
    dispose();
  });

  it("an affects() mark in the done-window is released by the settling flush", async () => {
    const [count] = createSignal(1);
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const m = createMemo(() => count() * 2);
      createRenderEffect(m, () => {});
    });
    flush();

    let resolveA!: () => void;
    const pA = new Promise<void>(r => (resolveA = r));
    const A = action(async function* () {
      yield pA;
    });
    const aDone = A();
    flush();

    await tick(); // drain the initial scheduled flush
    await inDoneWindow(aDone, resolveA, () => {
      affects(count);
    });

    await aDone;
    await new Promise(r => setTimeout(r, 0));
    flush();
    flush();

    // The mark must release at settle; before the fix it landed in a
    // detached ambient batch, where
    // (in combination with other pending work) it could leak forever
    // (isPending stuck true, INV-10 on the next quiescent flush).
    expect(isPending(() => count())).toBe(false);
    dispose();
  });
});
