import {
  createMemo,
  createRoot,
  createSignal,
  createStore,
  flush,
  getOwner,
  setSnapshotCapture,
  markSnapshotScope,
  releaseSnapshotScope,
  clearSnapshots
} from "../src/index.js";

afterEach(() => {
  clearSnapshots();
  flush();
});

describe("setSnapshotCapture", () => {
  it("signals created during capture get _snapshotValue", () => {
    createRoot(() => {
      setSnapshotCapture(true);
      const [$x] = createSignal(42);
      expect($x()).toBe(42);
      clearSnapshots();
    });
  });

  it("signals created outside capture have no snapshot overhead", () => {
    let setX!: (v: number) => void;
    let $x!: () => number;
    createRoot(() => {
      [$x, setX] = createSignal(1);
    });
    setX(2);
    flush();
    expect($x()).toBe(2);
  });

  it("handles undefined signal values with NO_SNAPSHOT sentinel", () => {
    createRoot(() => {
      setSnapshotCapture(true);
      const [$x] = createSignal(undefined);
      expect($x()).toBeUndefined();
      clearSnapshots();
    });
  });

  it("memos created during capture get _snapshotValue from first evaluation", () => {
    createRoot(() => {
      const [$x] = createSignal(10);
      setSnapshotCapture(true);
      const $double = createMemo(() => $x() * 2);
      expect($double()).toBe(20);
      clearSnapshots();
    });
  });
});

describe("markSnapshotScope + read-path interception", () => {
  it("snapshot-scoped computation reads _snapshotValue instead of _value", () => {
    let setX!: (v: number) => void;
    let $derived!: () => number;
    let owner!: any;
    createRoot(() => {
      setSnapshotCapture(true);
      const [$x, _setX] = createSignal(1);
      setX = _setX;

      owner = getOwner()!;
      markSnapshotScope(owner);

      $derived = createMemo(() => $x() * 10);
      expect($derived()).toBe(10);
    });

    setX(2);
    flush();

    expect($derived()).toBe(10);

    releaseSnapshotScope(owner);
    flush();

    expect($derived()).toBe(20);
    clearSnapshots();
  });

  it("signal created before capture has no snapshot — writes propagate normally", () => {
    let setX!: (v: number) => void;
    let $derived!: () => number;
    let owner!: any;
    createRoot(() => {
      const [$x, _setX] = createSignal(1);
      setX = _setX;

      setSnapshotCapture(true);
      owner = getOwner()!;
      markSnapshotScope(owner);

      $derived = createMemo(() => $x() * 10);
      expect($derived()).toBe(10);
    });

    setX(5);
    flush();

    // $x has no snapshot (created before capture), so writes propagate normally
    expect($derived()).toBe(50);

    releaseSnapshotScope(owner);
    clearSnapshots();
  });

  it("nested snapshot scopes are independent", () => {
    let setX!: (v: number) => void;
    let $outer!: () => number;
    let $inner!: () => number;
    let rootOwner!: any;
    let innerOwner!: any;

    createRoot(() => {
      setSnapshotCapture(true);
      const [$x, _setX] = createSignal(1);
      setX = _setX;

      rootOwner = getOwner()!;
      markSnapshotScope(rootOwner);

      $outer = createMemo(() => $x() + 100);
      expect($outer()).toBe(101);

      createRoot(() => {
        innerOwner = getOwner()!;
        markSnapshotScope(innerOwner);
        $inner = createMemo(() => $x() + 200);
      });
      expect($inner()).toBe(201);
    });

    setX(5);
    flush();

    expect($outer()).toBe(101);
    expect($inner()).toBe(201);

    // Release root scope — skips innerOwner (still a snapshot scope)
    releaseSnapshotScope(rootOwner);
    flush();

    expect($outer()).toBe(105);
    expect($inner()).toBe(201);

    // Release inner
    releaseSnapshotScope(innerOwner);
    flush();

    expect($inner()).toBe(205);

    clearSnapshots();
  });

  it("writes during snapshot scope don't affect scoped readers", () => {
    let setX!: (v: string) => void;
    let $upper!: () => string;
    let owner!: any;

    createRoot(() => {
      setSnapshotCapture(true);
      const [$x, _setX] = createSignal("hello");
      setX = _setX;

      owner = getOwner()!;
      markSnapshotScope(owner);

      $upper = createMemo(() => $x().toUpperCase());
      expect($upper()).toBe("HELLO");
    });

    setX("world");

    // Scoped reader still sees snapshot
    expect($upper()).toBe("HELLO");

    releaseSnapshotScope(owner);
    flush();

    expect($upper()).toBe("WORLD");
    clearSnapshots();
  });
});

describe("releaseSnapshotScope", () => {
  it("schedules stale computations for rerun via schedule (not sync)", () => {
    let setX!: (v: number) => void;
    let $derived!: () => number;
    let runCount = 0;
    let owner!: any;

    createRoot(() => {
      setSnapshotCapture(true);
      const [$x, _setX] = createSignal(1);
      setX = _setX;

      owner = getOwner()!;
      markSnapshotScope(owner);

      $derived = createMemo(() => {
        runCount++;
        return $x() * 2;
      });
      expect($derived()).toBe(2);
      expect(runCount).toBe(1);
    });

    setX(10);

    // Release — stale computations are scheduled, not run synchronously
    releaseSnapshotScope(owner);
    expect(runCount).toBe(1);

    flush();
    expect($derived()).toBe(20);
    expect(runCount).toBe(2);

    clearSnapshots();
  });

  it("is idempotent — re-releasing an already-released scope is a no-op", () => {
    let $derived!: () => number;
    let owner!: any;

    createRoot(() => {
      setSnapshotCapture(true);
      const [$x] = createSignal(1);

      owner = getOwner()!;
      markSnapshotScope(owner);

      $derived = createMemo(() => $x());

      releaseSnapshotScope(owner);
      // Second release should not throw or cause issues
      releaseSnapshotScope(owner);
    });

    flush();
    expect($derived()).toBe(1);
    clearSnapshots();
  });
});

describe("clearSnapshots", () => {
  it("removes _snapshotValue from all tracked sources", () => {
    let setX!: (v: number) => void;
    let $derived!: () => number;
    let owner!: any;

    createRoot(() => {
      setSnapshotCapture(true);
      const [$x, _setX] = createSignal(1);
      setX = _setX;

      owner = getOwner()!;
      markSnapshotScope(owner);

      $derived = createMemo(() => $x() * 3);
      expect($derived()).toBe(3);
    });

    setX(10);

    releaseSnapshotScope(owner);
    clearSnapshots();
    flush();

    // After clearSnapshots, reads use _value normally
    expect($derived()).toBe(30);
  });

  it("resets snapshotCaptureActive", () => {
    setSnapshotCapture(true);
    clearSnapshots();
    // After clearing, new signals should not get snapshot values
    let setX!: (v: number) => void;
    let $x!: () => number;
    createRoot(() => {
      [$x, setX] = createSignal(1);
    });
    setX(2);
    flush();
    expect($x()).toBe(2);
  });
});

describe("insertSubs optimization", () => {
  it("source changes during snapshot scope don't trigger recompute", () => {
    let setX!: (v: number) => void;
    let $derived!: () => number;
    let computeCount = 0;
    let owner!: any;

    createRoot(() => {
      setSnapshotCapture(true);
      const [$x, _setX] = createSignal(1);
      setX = _setX;

      owner = getOwner()!;
      markSnapshotScope(owner);

      $derived = createMemo(() => {
        computeCount++;
        return $x() + 1;
      });

      expect($derived()).toBe(2);
      expect(computeCount).toBe(1);
    });

    // Write to source — propagation should skip snapshot-scoped subscriber
    setX(100);
    flush();

    // Computation should NOT have re-run
    expect(computeCount).toBe(1);
    expect($derived()).toBe(2);

    // After release, it should rerun
    releaseSnapshotScope(owner);
    flush();

    expect(computeCount).toBe(2);
    expect($derived()).toBe(101);

    clearSnapshots();
  });
});

describe("store snapshot support", () => {
  it("store property written during capture preserves original in _snapshotProps", () => {
    let setStore!: (...args: any[]) => void;
    let $name!: () => string;
    let owner!: any;

    createRoot(() => {
      setSnapshotCapture(true);
      const [store, _setStore] = createStore({ name: "Alice", age: 30 });
      setStore = _setStore;

      owner = getOwner()!;
      markSnapshotScope(owner);

      $name = createMemo(() => store.name);
      expect($name()).toBe("Alice");
    });

    // Write to store outside owned scope
    setStore((s: any) => {
      s.name = "Bob";
    });
    flush();

    // Scoped reader still sees snapshot
    expect($name()).toBe("Alice");

    releaseSnapshotScope(owner);
    flush();

    expect($name()).toBe("Bob");
    clearSnapshots();
  });

  it("unwritten store properties use current value as snapshot", () => {
    let $age!: () => number;
    let owner!: any;

    createRoot(() => {
      setSnapshotCapture(true);
      const [store] = createStore({ name: "Alice", age: 30 });

      owner = getOwner()!;
      markSnapshotScope(owner);

      $age = createMemo(() => store.age);
      expect($age()).toBe(30);
    });

    releaseSnapshotScope(owner);
    flush();

    expect($age()).toBe(30);
    clearSnapshots();
  });
});
