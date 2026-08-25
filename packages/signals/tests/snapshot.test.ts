import {
  clearSnapshots,
  createErrorBoundary,
  createMemo,
  createProjection,
  createRoot,
  createSignal,
  createStore,
  flush,
  getOwner,
  markSnapshotScope,
  releaseSnapshotScope,
  setSnapshotCapture,
  snapshot
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

describe("ownedWrite signals excluded from snapshot capture", () => {
  it("error boundary functions correctly under active snapshot capture", () => {
    let result!: () => any;
    let owner!: any;

    createRoot(() => {
      setSnapshotCapture(true);
      owner = getOwner()!;
      markSnapshotScope(owner);

      result = createErrorBoundary(
        () => {
          throw new Error("test error");
        },
        (err: any) => `fallback: ${err().message}`
      );
    });
    flush();

    expect(result()).toBe("fallback: test error");

    releaseSnapshotScope(owner);
    clearSnapshots();
  });

  it("error boundary reset works under active snapshot capture", () => {
    let result!: () => any;
    let resetFn!: () => void;
    let owner!: any;

    createRoot(() => {
      setSnapshotCapture(true);
      owner = getOwner()!;
      markSnapshotScope(owner);

      result = createErrorBoundary(
        () => "success",
        (err: any, reset) => {
          resetFn = reset;
          return `fallback: ${err().message}`;
        }
      );
    });
    flush();

    expect(result()).toBe("success");

    releaseSnapshotScope(owner);
    clearSnapshots();
  });

  it("load boundary functions correctly under active snapshot capture", () => {
    // Ensures ownedWrite signals in CollectionQueue._disabled are not
    // snapshot-captured, which would freeze the boundary in its initial state
    let result!: () => any;
    let owner!: any;

    createRoot(() => {
      setSnapshotCapture(true);
      owner = getOwner()!;
      markSnapshotScope(owner);

      result = createErrorBoundary(
        () => "children content",
        (err: any) => `fallback: ${err().message}`
      );
    });
    flush();

    expect(result()).toBe("children content");

    releaseSnapshotScope(owner);
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

  it("preserves an overridden array length of 0", () => {
    const [store, setStore] = createStore<number[]>([1, 2, 3]);

    setStore(() => []);

    expect(snapshot(store)).toEqual([]);
  });

  it("preserves symbol-keyed properties after a write", () => {
    const meta = Symbol("meta");
    const [store, setStore] = createStore({ value: 1, [meta]: "keep" });

    setStore(s => {
      s.value = 2;
    });
    flush();

    expect(snapshot(store)[meta]).toBe("keep");
  });

  it("captures a write inside a symbol-keyed subtree", () => {
    const meta = Symbol("meta");
    const [store, setStore] = createStore({ [meta]: { value: 1 } });

    setStore(s => {
      s[meta].value = 2;
    });
    flush();

    expect(snapshot(store)[meta].value).toBe(2);
  });

  it("unwraps an unread symbol-keyed store-in-store value", () => {
    const meta = Symbol("meta");
    const [child] = createStore({ value: 1 });
    const [parent] = createStore({ [meta]: child });

    const plain = snapshot(parent);

    expect(plain[meta]).not.toBe(child);
    expect(plain[meta]).toEqual({ value: 1 });
  });

  it("preserves symbol-keyed array metadata after an index write", () => {
    const meta = Symbol("meta");
    const initial = Object.assign([1], { [meta]: "keep" });
    const [store, setStore] = createStore(initial);

    setStore(s => {
      s[0] = 2;
    });
    flush();

    expect(snapshot(store)[meta]).toBe("keep");
  });

  it("preserves a symbol-keyed property added after a snapshot", () => {
    const meta = Symbol("meta");
    const [store, setStore] = createStore<{ value: number; [meta]?: string }>({ value: 1 });

    snapshot(store);
    setStore(s => {
      s[meta] = "added";
    });
    flush();

    expect(snapshot(store)[meta]).toBe("added");
  });

  it("preserves symbols on an untouched nested store value", () => {
    const meta = Symbol("meta");
    const [store] = createStore({ child: { value: 1, [meta]: "keep" } });

    expect(snapshot(store).child[meta]).toBe("keep");
    expect(snapshot(store).child[meta]).toBe("keep");
  });

  it("drops a deleted symbol-keyed property", () => {
    const meta = Symbol("meta");
    const [store, setStore] = createStore<{ value: number; [meta]?: string }>({
      value: 1,
      [meta]: "gone"
    });

    setStore(s => {
      delete s[meta];
    });
    flush();

    expect(meta in snapshot(store)).toBe(false);
  });

  it("drops a deleted symbol-keyed array metadata property", () => {
    const meta = Symbol("meta");
    const initial = Object.assign([1], { [meta]: "gone" });
    const [store, setStore] = createStore<number[] & { [meta]?: string }>(initial);

    setStore(s => {
      delete s[meta];
    });
    flush();

    expect(meta in snapshot(store)).toBe(false);
  });

  it("excludes non-enumerable symbol-keyed properties from written copies", () => {
    const meta = Symbol("meta");
    const raw: { value: number; [meta]?: string } = { value: 1 };
    Object.defineProperty(raw, meta, { value: "hidden", enumerable: false });
    const [store, setStore] = createStore(raw);

    setStore(s => {
      s.value = 2;
    });
    flush();

    expect(meta in snapshot(store)).toBe(false);
  });

  it("preserves a cycle reached through a symbol key", () => {
    const meta = Symbol("meta");
    const [store, setStore] = createStore<{ node: { name: string; [meta]?: unknown } }>({
      node: { name: "n" }
    });

    setStore(s => {
      s.node[meta] = s.node;
    });
    flush();

    const snap = snapshot(store);
    expect(snap.node[meta]).toBe(snap.node);
  });

  it("keeps shared references between symbol and string keys", () => {
    const meta = Symbol("meta");
    const shared = { value: 1 };
    const [store, setStore] = createStore<{ named: typeof shared; [meta]?: typeof shared }>({
      named: shared,
      [meta]: shared
    });

    setStore(s => {
      s.named.value = 2;
    });
    flush();

    const snap = snapshot(store);
    expect(snap[meta]).toBe(snap.named);
    expect(snap.named.value).toBe(2);
  });

  it("unwraps a symbol-keyed store-in-store value under a written parent", () => {
    const meta = Symbol("meta");
    const [child] = createStore({ value: 1 });
    const [parent, setParent] = createStore<{ label: string; [meta]?: typeof child }>({
      label: "a",
      [meta]: child
    });

    setParent(s => {
      s.label = "b";
    });
    flush();

    const plain = snapshot(parent);
    expect(plain[meta]).not.toBe(child);
    expect(plain[meta]).toEqual({ value: 1 });
  });

  it("preserves symbol-keyed properties when materializing a written subtree", () => {
    const meta = Symbol("meta");
    const [source, setSource] = createStore({ child: { value: 1, [meta]: "keep" } });

    setSource(s => {
      s.child.value = 2;
    });
    flush();

    const [target, setTarget] = createStore<{ child?: typeof source.child }>({});
    setTarget(s => {
      s.child = source.child;
    });
    flush();

    expect(target.child?.[meta]).toBe("keep");
  });
});

describe("pending projection skips snapshot capture", () => {
  it("snapshot is not frozen at the empty pending state", async () => {
    let proj: any;
    let $value!: () => number;
    let owner!: any;

    createRoot(() => {
      setSnapshotCapture(true);
      owner = getOwner()!;
      markSnapshotScope(owner);

      proj = createProjection(
        async (draft: any) => {
          await Promise.resolve();
          draft.value = 42;
        },
        { value: 0 }
      );

      $value = createMemo(() => proj.value);
    });

    flush();
    await Promise.resolve();
    await Promise.resolve();

    // Without the fix, the snapshot would have frozen value=0 (the pending
    // state) and releaseSnapshotScope + flush would still show 0.
    // With the fix, no snapshot was captured while pending, so the memo
    // sees the resolved value after release.
    releaseSnapshotScope(owner);
    flush();

    expect($value()).toBe(42);
    clearSnapshots();
  });

  it("store properties are not snapshot-frozen while projection is pending", async () => {
    let proj: any;
    let $name!: () => string;
    let owner!: any;

    createRoot(() => {
      setSnapshotCapture(true);
      owner = getOwner()!;
      markSnapshotScope(owner);

      proj = createProjection(
        async (draft: any) => {
          await Promise.resolve();
          draft.name = "resolved";
        },
        { name: "initial" }
      );

      $name = createMemo(() => proj.name);
    });

    flush();
    await Promise.resolve();
    await Promise.resolve();

    // Without the fix, the store set trap would have captured
    // STORE_SNAPSHOT_PROPS for "name" = "initial" while the projection
    // was pending, freezing the snapshot at the pending state.
    releaseSnapshotScope(owner);
    flush();

    expect($name()).toBe("resolved");
    clearSnapshots();
  });
});
