// Transition-merge state transfer (mergeTransitionState + the adoption pass
// in initTransition). The global queue's arrays alias the active transition's
// after initTransition, so a merge must MOVE (not copy) the outgoing arrays —
// otherwise the adoption pass re-pushes their contents into the target,
// duplicating every entry.

import { describe, expect, it } from "vitest";
import { action, createOptimistic, createRoot, flush } from "../src/index.js";
import * as scheduler from "../src/core/scheduler.js";

describe("transition merge", () => {
  it("does not duplicate _optimisticNodes when a resumed action merges into another transition", async () => {
    let setO1!: (v: number) => void;
    let setO2!: (v: number) => void;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      [, setO1] = createOptimistic<number>(0);
      [, setO2] = createOptimistic<number>(0);
    });
    flush();

    let resolve1!: () => void;
    const p1 = new Promise<void>(r => (resolve1 = r));
    let resolve2!: () => void;
    const p2 = new Promise<void>(r => (resolve2 = r));

    let snapshot: unknown[] = [];

    const act1 = action(function* () {
      setO1(1); // lands in transition A's _optimisticNodes
      yield p1; // A gets stashed across the flush below
      // Resumes with A active again (the queue re-aliases A's arrays); o2
      // holds an override owned by transition B, so this write resolves to B
      // and initTransition(B) merges A into B while the queue still aliases
      // A's _optimisticNodes.
      setO2(2);
      snapshot = [...scheduler.activeTransition!._optimisticNodes];
    });

    const act2 = action(function* () {
      setO2(99); // lands in transition B's _optimisticNodes
      yield p2; // B gets stashed across the flush below
    });

    const done1 = act1();
    flush(); // stash transition A
    const done2 = act2();
    flush(); // stash transition B

    resolve1();
    await Promise.resolve();
    await Promise.resolve();

    // Pre-fix, A's node appeared twice in the merged array: once from the
    // mergeTransitionState copy, once from the adoption re-push.
    expect(snapshot.length).toBe(new Set(snapshot).size);

    resolve2();
    await done1;
    await done2;
    flush();
    dispose();
    flush();
  });
});
