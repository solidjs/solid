// #3621: a memo that disposed its own root during its recompute came back
// alive. `disposeChildren` set REACTIVE_DISPOSED on it reentrantly, and
// `recompute`'s `finally` then rebuilt `_flags` from the ZOMBIE bit alone,
// dropping it. `isDisposed()` read false, `refresh()` re-ran the memo, and the
// reads that followed the `dispose()` call inside the pass had re-linked the
// dead node to its sources — it kept re-running in a torn-down tree.
//
// Sibling of #3601 / #3606 (cleanups disposing the root mid-run). The ruling
// here is the disposal path's: a node that dies during its own pass is dead
// at the end of it, and the pass is void — no value commits or propagates
// (#3024: a dead node freezes at its last committed value), no dependencies
// survive it.

import {
  $REFRESH,
  createEffect,
  createMemo,
  createOwner,
  createRoot,
  createSignal,
  flush,
  isDisposed,
  refresh,
  runWithOwner
} from "../src/index.js";

const node = (accessor: () => unknown) => (accessor as any)[$REFRESH];

afterEach(() => flush());

describe("#3621 a memo disposing its own root mid-recompute stays disposed", () => {
  it("issue repro: isDisposed is true and refresh() does not re-run it", () => {
    const [n, setN] = createSignal(0);
    let memo!: () => number;
    let runs = 0;

    createRoot(dispose => {
      memo = createMemo(() => {
        runs++;
        if (n() === 1) dispose();
        return n();
      });
      createEffect(memo, () => {});
    });

    flush();
    expect(runs).toBe(1);
    setN(1);
    flush();
    expect(runs).toBe(2);

    expect(isDisposed(node(memo))).toBe(true);
    refresh(memo);
    flush();
    expect(runs).toBe(2);
  });

  it("the reads after dispose() inside the pass leave no subscription behind", () => {
    const [n, setN] = createSignal(0);
    let memo!: () => number;
    let runs = 0;

    createRoot(dispose => {
      memo = createMemo(() => {
        runs++;
        if (n() === 1) dispose();
        // Read AFTER the dispose: this link was created on a dead node.
        return n();
      });
      createEffect(memo, () => {});
    });

    flush();
    setN(1);
    flush();
    expect(runs).toBe(2);

    // No subscriber on the source, no dependency on the memo.
    expect(node(n)._subs).toBeNull();
    expect(node(memo)._deps).toBeNull();

    // And a write to the source does not reach it.
    setN(2);
    flush();
    expect(runs).toBe(2);
  });

  it("the value produced by the dying pass is not committed: the memo freezes at its last committed value (#3024)", () => {
    const [n, setN] = createSignal(0);
    let memo!: () => number;

    createRoot(dispose => {
      memo = createMemo(() => {
        if (n() === 1) dispose();
        return n();
      });
      createEffect(memo, () => {});
    });

    flush();
    expect(memo()).toBe(0);
    setN(1);
    flush();
    expect(memo()).toBe(0);
  });

  it("an effect downstream of the memo (outside the disposed root) does not fire from the mid-compute value", () => {
    const [n, setN] = createSignal(0);
    let memo!: () => number;
    const seen: number[] = [];

    createRoot(dispose => {
      memo = createMemo(() => {
        if (n() === 1) dispose();
        return n();
      });
    });
    createRoot(() => {
      createEffect(memo, v => {
        seen.push(v);
      });
    });

    flush();
    expect(seen).toEqual([0]);
    setN(1);
    flush();
    expect(seen).toEqual([0]);
    setN(2);
    flush();
    expect(seen).toEqual([0]);
  });

  it("effect twin: an effect whose compute phase disposes its root does not run its effect phase", () => {
    const [n, setN] = createSignal(0);
    const seen: number[] = [];
    let computes = 0;

    createRoot(dispose => {
      createEffect(
        () => {
          computes++;
          if (n() === 1) dispose();
          return n();
        },
        v => {
          seen.push(v);
        }
      );
    });

    flush();
    expect(seen).toEqual([0]);
    expect(computes).toBe(1);
    setN(1);
    flush();
    expect(computes).toBe(2);
    expect(seen).toEqual([0]);
    // Dead: no subscription survived the pass.
    expect(node(n)._subs).toBeNull();
    setN(2);
    flush();
    expect(computes).toBe(2);
    expect(seen).toEqual([0]);
  });

  it("a memo disposing a parent owner (not its root) mid-compute stays disposed; the root survives", () => {
    const [n, setN] = createSignal(0);
    let memo!: () => number;
    let sibling!: () => number;
    let runs = 0;
    let siblingRuns = 0;

    createRoot(() => {
      const owner = createOwner();
      runWithOwner(owner, () => {
        memo = createMemo(() => {
          runs++;
          if (n() === 1) owner.dispose();
          return n();
        });
        createEffect(memo, () => {});
      });
      // Owned by the root directly: must keep running after the inner owner dies.
      sibling = createMemo(() => {
        siblingRuns++;
        return n() * 10;
      });
      createEffect(sibling, () => {});
    });

    flush();
    expect(runs).toBe(1);
    expect(siblingRuns).toBe(1);
    setN(1);
    flush();
    expect(runs).toBe(2);
    expect(siblingRuns).toBe(2);

    expect(isDisposed(node(memo))).toBe(true);
    expect(isDisposed(node(sibling))).toBe(false);
    expect(node(memo)._deps).toBeNull();
    refresh(memo);
    flush();
    expect(runs).toBe(2);

    setN(2);
    flush();
    expect(runs).toBe(2);
    expect(siblingRuns).toBe(3);
    expect(sibling()).toBe(20);
  });

  it("control: disposing after the flush (non-reentrant) is unchanged", () => {
    const [n, setN] = createSignal(0);
    let memo!: () => number;
    let runs = 0;
    let dispose!: () => void;

    createRoot(d => {
      dispose = d;
      memo = createMemo(() => {
        runs++;
        return n();
      });
      createEffect(memo, () => {});
    });

    flush();
    setN(1);
    flush();
    expect(runs).toBe(2);
    expect(memo()).toBe(1);

    dispose();
    expect(isDisposed(node(memo))).toBe(true);
    expect(node(n)._subs).toBeNull();
    refresh(memo);
    flush();
    expect(runs).toBe(2);
    setN(2);
    flush();
    expect(runs).toBe(2);
    // Frozen at the last committed value (#3024).
    expect(memo()).toBe(1);
  });
});
