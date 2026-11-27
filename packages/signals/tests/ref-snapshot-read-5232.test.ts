import {
  clearSnapshots,
  createMemo,
  createRoot,
  createSignal,
  flush,
  getOwner,
  isPending,
  latest,
  markSnapshotScope,
  releaseSnapshotScope,
  runRefCallback,
  runWithOwner,
  setSnapshotCapture,
  untrack
} from "../src/index.js";

// #5232: a ref callback runs untracked in its creating pass (#4761). In a
// hydration claim its read is served the snapshot like any other, but the
// creating pass is not replayed for it at release: the ref is one-shot, and
// replaying the pass that built the element would rebuild the served node.
// A tracked or untracked read by the pass itself still replays it, and so
// does a read the ref makes under another owner.
afterEach(() => {
  clearSnapshots();
  setSnapshotCapture(false);
  flush();
});

/** A snapshot scope whose `x` was 1 when hydration began and is 5 now. */
function scope() {
  let setX!: (v: number) => void;
  let $x!: () => number;
  let owner!: any;
  createRoot(() => {
    [$x, setX] = createSignal(1);
    setSnapshotCapture(true);
    owner = getOwner()!;
    markSnapshotScope(owner);
  });
  setX(5);
  flush();
  return { $x, owner };
}

/** Runs a pass in a snapshot scope, releases it, and returns each run's value. */
function claim(read: ($x: () => number) => number) {
  const { $x, owner } = scope();
  const runs: number[] = [];
  let memo!: () => number;
  runWithOwner(owner, () => {
    memo = createMemo(() => {
      const v = read($x);
      runs.push(v);
      return v;
    });
  });
  memo();
  releaseSnapshotScope(owner);
  flush();
  memo();
  return runs;
}

describe("#5232: a ref's read in a snapshot scope", () => {
  it("a ref's plain read is served the snapshot and does not replay its pass", () => {
    const runs = claim($x => {
      let seen = -1;
      runRefCallback(() => (seen = $x()));
      return seen;
    });
    expect(runs).toEqual([1]);
  });

  it("a ref's latest() read is served the snapshot and does not replay its pass", () => {
    const runs = claim($x => {
      let seen = -1;
      runRefCallback(() => (seen = latest($x)));
      return seen;
    });
    expect(runs).toEqual([1]);
  });

  it("a ref's isPending() read does not replay its pass", () => {
    const runs = claim($x => {
      let pending = true;
      runRefCallback(() => (pending = isPending($x)));
      return pending ? 1 : 0;
    });
    expect(runs).toEqual([0]);
  });

  it("a ref's read after a nested ref under another owner does not replay its pass", () => {
    const { owner } = scope();
    let other!: any;
    runWithOwner(owner, () => createMemo(() => ((other = getOwner()), 0))());
    const runs = claim($x => {
      let seen = -1;
      runRefCallback(() => {
        runWithOwner(other, () => runRefCallback(() => {}));
        seen = $x();
      });
      return seen;
    });
    expect(runs).toEqual([1]);
  });

  it("control: the pass's own untracked read still replays it at release", () => {
    expect(claim($x => untrack($x))).toEqual([1, 5]);
  });

  it("control: the pass's own tracked read still replays it at release", () => {
    expect(claim($x => $x())).toEqual([1, 5]);
  });

  it("control: the pass's untracked read after a ref that threw still replays it", () => {
    const runs = claim($x => {
      try {
        runRefCallback(() => {
          throw new Error("ref");
        });
      } catch {}
      return untrack($x);
    });
    expect(runs).toEqual([1, 5]);
  });

  it("control: a computation a ref parents under another owner still replays at release", () => {
    // `runWithOwner` in a ref is the allowed way to create a computation there.
    const { $x, owner } = scope();
    const runs: number[] = [];
    let inner!: () => number;
    runWithOwner(owner, () => {
      createMemo(() => {
        runRefCallback(() =>
          runWithOwner(owner, () => {
            inner = createMemo(() => {
              const v = untrack($x);
              runs.push(v);
              return v;
            });
            inner();
          })
        );
        return 0;
      })();
    });
    releaseSnapshotScope(owner);
    flush();
    inner();
    expect(runs).toEqual([1, 5]);
  });
});
