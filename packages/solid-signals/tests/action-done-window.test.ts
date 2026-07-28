/**
 * The post-action done() window (#2916 shape): an async-generator action's
 * done() runs from an iterator-result microtask, restoring activeTransition
 * with no synchronous flush after it. Until the scheduled flush runs,
 * globalQueue._batch was a detached ambient batch — so anything registered in
 * that window (ordinary writes held by a merged transition, optimistic
 * overrides, affects() marks) landed in a batch that nothing ever finalized.
 * done() now re-adopts the batch through initTransition, the same path every
 * other transition-resumption site uses.
 *
 * Each test polls microtasks until it observes the restored transition
 * (scheduler.activeTransition !== null) and injects its work exactly there.
 */
import { describe, expect, it } from "vitest";
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
import * as scheduler from "../src/core/scheduler.js";

const tick = () => Promise.resolve();

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
    const bDone = B(); // fresh transition T_B (T_A stashed, activeTransition null)
    flush(); // stash T_B

    resolveA();

    // Land in A's done-window and resume B there, so initTransition(T_B)
    // merges the restored T_A into T_B. T_A's held write must survive the
    // merge and commit when T_B settles.
    let resumed = false;
    for (let i = 0; i < 16; i++) {
      await tick();
      if (!resumed && scheduler.activeTransition !== null && hasResumeB) {
        resumed = true;
        resumeB(undefined);
      }
    }
    expect(resumed).toBe(true);

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

    resolveA();

    let wrote = false;
    for (let i = 0; i < 16; i++) {
      await tick();
      if (!wrote && scheduler.activeTransition !== null) {
        wrote = true;
        setOpt(5);
      }
    }
    expect(wrote).toBe(true);

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

    resolveA();

    let marked = false;
    for (let i = 0; i < 16; i++) {
      await tick();
      if (!marked && scheduler.activeTransition !== null) {
        marked = true;
        affects(count);
      }
    }
    expect(marked).toBe(true);

    await aDone;
    await new Promise(r => setTimeout(r, 0));
    flush();
    flush();

    // The mark now belongs to the restored transaction and releases at its
    // settle; before the fix it landed in the detached ambient batch, where
    // (in combination with other pending work) it could leak forever
    // (isPending stuck true, INV-10 on the next quiescent flush).
    expect(isPending(() => count())).toBe(false);
    dispose();
  });
});
