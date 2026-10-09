import {
  clearSnapshots,
  createErrorBoundary,
  createMemo,
  createEffect,
  createRenderEffect,
  createLoadingBoundary,
  createRoot,
  createSignal,
  flush,
  getOwner,
  markSnapshotScope,
  releaseSnapshotScope,
  setSnapshotCapture
} from "../src/index.js";

it.each([false, true])(
  "does not capture an unpublished placeholder from a born-held memo (failure: %s)",
  async fails => {
    let resolve!: (value: number) => void;
    let request = Promise.resolve(1);
    const marker = new Error("born-held failure");
    const [count, setCount] = createSignal(1);
    const disposeSlow = createRoot(d => {
      const slow = createMemo(() => {
        count();
        return request;
      });
      createRenderEffect(slow, () => {}, { schedule: true });
      return d;
    });
    flush();
    await new Promise(r => setTimeout(r, 0));
    flush();
    request = new Promise(r => {
      resolve = r;
    });
    setCount(2);
    flush();
    let view!: () => number;
    const published: unknown[] = [];
    setSnapshotCapture(true);
    const dispose = createRoot(d => {
      markSnapshotScope(getOwner()!);
      const source = createMemo<number>(() => {
        count();
        if (fails) throw marker;
        return 7;
      });
      view = createMemo(source);
      createEffect(view, {
        effect: v => {
          published.push(v);
        },
        error: e => {
          published.push(e);
        }
      });
      return d;
    });
    try {
      flush();
      resolve(2);
      await new Promise(r => setTimeout(r, 0));
      flush();
      expect(published).toEqual([fails ? marker : 7]);
      if (fails) expect(view).toThrow("born-held failure");
      else expect(view()).toBe(7);
    } finally {
      clearSnapshots();
      dispose();
      disposeSlow();
      flush();
    }
  }
);

it.each([false, true])(
  "snapshot reads retain the captured outcome (initial error: %s)",
  initiallyBad => {
    const marker = new Error("snapshot failure");
    const [bad, setBad] = createSignal(initiallyBad);
    let view!: () => number | string;
    let owner!: ReturnType<typeof getOwner>;
    setSnapshotCapture(true);
    const dispose = createRoot(d => {
      const source = createMemo(() => {
        if (bad()) throw marker;
        return 1;
      });
      owner = getOwner();
      markSnapshotScope(owner!);
      view = createErrorBoundary(source, () => "failed");
      return d;
    });
    try {
      flush();
      expect(view()).toBe(initiallyBad ? "failed" : 1);
      setBad(!initiallyBad);
      flush();
      expect(view()).toBe(initiallyBad ? "failed" : 1);
      releaseSnapshotScope(owner!);
      flush();
      expect(view()).toBe(initiallyBad ? 1 : "failed");
    } finally {
      clearSnapshots();
      dispose();
      flush();
    }
  }
);

it("lets a nested Loading fallback resume with a first failure during snapshot capture", async () => {
  const marker = new Error("first server answer failed");
  let reject!: (error: unknown) => void;
  const request = new Promise<number>((_, bad) => {
    reject = bad;
  });
  let view!: () => number | string;
  setSnapshotCapture(true);
  const dispose = createRoot(d => {
    markSnapshotScope(getOwner()!);
    const source = createMemo(() => request);
    view = createErrorBoundary(
      () => createLoadingBoundary(source, () => "loading")(),
      error => {
        expect(error()).toBe(marker);
        return "failed";
      }
    );
    return d;
  });
  try {
    flush();
    expect(view()).toBe("loading");
    reject(marker);
    await new Promise(resolve => setTimeout(resolve, 0));
    flush();
    expect(view()).toBe("failed");
  } finally {
    clearSnapshots();
    dispose();
    flush();
  }
});
