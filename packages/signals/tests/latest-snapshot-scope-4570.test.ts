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
  runWithOwner,
  setSnapshotCapture
} from "../src/index.js";

// #4570: a reader in a snapshot scope (a hydration claim) is served the value
// the server rendered with. `latest()` and `isPending()` read through the
// verdict window, which must serve the snapshot as a plain read does: in a
// claim, `latest(a)` beside `a()` shows the server's frame whole (F-1).
afterEach(() => {
  clearSnapshots();
  setSnapshotCapture(false);
  flush();
});

describe("#4570: verdict reads in a snapshot scope", () => {
  it("latest() and a plain read agree on the snapshot until release", () => {
    let setX!: (v: number) => void;
    let $x!: () => number;
    let owner!: any;
    createRoot(() => {
      [$x, setX] = createSignal(1);
      setSnapshotCapture(true);
      owner = getOwner()!;
      markSnapshotScope(owner);
    });

    // A client write before the claim's readers exist.
    setX(5);
    flush();

    let plain!: () => number, viaLatest!: () => number, pending!: () => boolean;
    runWithOwner(owner, () => {
      plain = createMemo(() => $x());
      viaLatest = createMemo(() => latest($x));
      pending = createMemo(() => isPending($x));
    });
    expect([plain(), viaLatest(), pending()]).toEqual([1, 1, false]);

    releaseSnapshotScope(owner);
    flush();
    expect([plain(), viaLatest(), pending()]).toEqual([5, 5, false]);
  });
});
