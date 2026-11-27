import {
  clearSnapshots,
  createMemo,
  createRoot,
  createSignal,
  flush,
  getOwner,
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
// A tracked or untracked read by the pass itself still replays it.
afterEach(() => {
  clearSnapshots();
  setSnapshotCapture(false);
  flush();
});

function claim(read: ($x: () => number) => number) {
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

  it("control: the pass's own untracked read still replays it at release", () => {
    expect(claim($x => untrack($x))).toEqual([1, 5]);
  });

  it("control: the pass's own tracked read still replays it at release", () => {
    expect(claim($x => $x())).toEqual([1, 5]);
  });
});
