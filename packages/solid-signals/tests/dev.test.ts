import { describe, expect, it, vi, afterEach } from "vitest";
import {
  createRoot,
  createSignal,
  createMemo,
  createEffect,
  createStore,
  createOptimistic,
  getOwner,
  flush,
  DEV,
  isDisposed,
  type Owner
} from "../src/index.js";

const { getChildren, getSignals, getParent, getSources, getObservers } = DEV!;

afterEach(() => {
  DEV!.hooks.onOwner = undefined;
  DEV!.hooks.onGraph = undefined;
  DEV!.hooks.onUpdate = undefined;
  DEV!.hooks.onStoreNodeUpdate = undefined;
});

describe("Phase 1a: Signal-to-owner tracking", () => {
  it("tracks plain signal on its creating owner", () => {
    createRoot(() => {
      const owner = getOwner()!;
      createSignal(0);
      const signals = getSignals(owner);
      expect(signals.length).toBe(1);
      expect(signals[0]._name).toBe("signal");
    });
  });

  it("sets back-reference from signal to owner", () => {
    createRoot(() => {
      const owner = getOwner()!;
      createSignal(0);
      const signals = getSignals(owner);
      expect(signals[0]._owner).toBe(owner);
    });
  });

  it("tracks multiple signals on the same owner", () => {
    createRoot(() => {
      const owner = getOwner()!;
      createSignal(0, { name: "count" });
      createSignal("hello", { name: "greeting" });
      const signals = getSignals(owner);
      expect(signals.length).toBe(2);
      expect(signals[0]._name).toBe("count");
      expect(signals[1]._name).toBe("greeting");
    });
  });

  it("tracks optimistic signal on its creating owner", () => {
    createRoot(() => {
      const owner = getOwner()!;
      createOptimistic(0, { name: "opt" });
      const signals = getSignals(owner);
      expect(signals.length).toBe(1);
    });
  });

  it("tracks signal created without an owner (unowned)", () => {
    const [count] = createSignal(0, { name: "unowned" });
    // Unowned signals still get _owner = null, and are not on any owner's list
    // but the onGraph hook fires for them
  });

  it("does not track computed/memo in signals list (they are owners)", () => {
    createRoot(() => {
      const owner = getOwner()!;
      createMemo(() => 42);
      // Memos are child owners, not in the signals list
      expect(getSignals(owner).length).toBe(0);
      // But they should appear as children
      expect(getChildren(owner).length).toBe(1);
    });
  });

  it("clears signal list when owner re-runs", () => {
    let setCount: (v: number) => void;
    let memoOwner: Owner | null = null;
    createRoot(() => {
      const [count, _setCount] = createSignal(0);
      setCount = _setCount;
      const m = createMemo(() => {
        memoOwner = getOwner();
        createSignal(count(), { name: "inner" });
        return count();
      });
      m();
      flush();
      expect(getSignals(memoOwner!).length).toBe(1);
    });

    setCount!(1);
    flush();
    expect(getSignals(memoOwner!).length).toBe(1);
  });

  it("clears signal list on disposal", () => {
    let savedOwner: Owner | null = null;
    const dispose = createRoot(d => {
      savedOwner = getOwner();
      createSignal(0);
      return d;
    });
    expect(getSignals(savedOwner!).length).toBe(1);
    dispose();
    expect(getSignals(savedOwner!).length).toBe(0);
  });

  it("tracks store on its creating owner", () => {
    createRoot(() => {
      const owner = getOwner()!;
      createStore({ count: 0 });
      const signals = getSignals(owner);
      expect(signals.length).toBe(1);
    });
  });
});

describe("Phase 1b: Notification hooks", () => {
  describe("onOwner", () => {
    it("fires when createRoot creates an owner", () => {
      const owners: Owner[] = [];
      DEV!.hooks.onOwner = o => owners.push(o);
      createRoot(() => {});
      expect(owners.length).toBe(1);
    });

    it("fires when createMemo creates a computed owner", () => {
      const owners: Owner[] = [];
      DEV!.hooks.onOwner = o => owners.push(o);
      createRoot(() => {
        createMemo(() => 42);
      });
      // root + memo = 2
      expect(owners.length).toBe(2);
    });

    it("fires for transparent owners", () => {
      const owners: Owner[] = [];
      DEV!.hooks.onOwner = o => owners.push(o);
      createRoot(() => {}, { transparent: true });
      expect(owners.length).toBe(1);
      expect(owners[0]._transparent).toBe(true);
    });
  });

  describe("onGraph", () => {
    it("fires when a signal is created with an owner", () => {
      const entries: any[] = [];
      DEV!.hooks.onGraph = (value, owner) => entries.push({ value, owner });
      createRoot(() => {
        createSignal(0, { name: "test" });
      });
      expect(entries.length).toBe(1);
      expect(entries[0].value._name).toBe("test");
      expect(entries[0].owner).not.toBeNull();
    });

    it("fires for unowned signals with owner=null", () => {
      const entries: any[] = [];
      DEV!.hooks.onGraph = (value, owner) => entries.push({ value, owner });
      createSignal(0, { name: "unowned" });
      expect(entries.length).toBe(1);
      expect(entries[0].owner).toBeNull();
    });

    it("fires for stores", () => {
      const entries: any[] = [];
      DEV!.hooks.onGraph = (value, owner) => entries.push({ value, owner });
      createRoot(() => {
        createStore({ count: 0 });
      });
      expect(entries.length).toBe(1);
    });
  });

  describe("onUpdate", () => {
    it("fires once per flush", () => {
      const calls: number[] = [];
      DEV!.hooks.onUpdate = () => calls.push(1);
      let setCount: (v: number) => void;
      createRoot(() => {
        const [count, _setCount] = createSignal(0);
        setCount = _setCount;
        createEffect(
          () => count(),
          () => {}
        );
        flush();
        expect(calls.length).toBe(1);
      });

      setCount!(1);
      flush();
      expect(calls.length).toBe(2);
    });

    it("fires once even with multiple signal writes", () => {
      const calls: number[] = [];
      DEV!.hooks.onUpdate = () => calls.push(1);
      let setA: (v: number) => void;
      let setB: (v: number) => void;
      createRoot(() => {
        const [a, _setA] = createSignal(0);
        const [b, _setB] = createSignal(0);
        setA = _setA;
        setB = _setB;
        createEffect(
          () => a() + b(),
          () => {}
        );
        flush();
      });
      const before = calls.length;

      setA!(1);
      setB!(2);
      flush();
      expect(calls.length - before).toBe(1);
    });
  });

  describe("onStoreNodeUpdate", () => {
    it("fires on store property mutation with old and new values", () => {
      const updates: any[] = [];
      DEV!.hooks.onStoreNodeUpdate = (state, property, value, prev) =>
        updates.push({ state, property, value, prev });

      createRoot(() => {
        const [store, setStore] = createStore({ count: 0, name: "test" });
        setStore(s => {
          s.count = 5;
        });
        flush();
        expect(updates.length).toBe(1);
        expect(updates[0].property).toBe("count");
        expect(updates[0].value).toBe(5);
        expect(updates[0].prev).toBe(0);
      });
    });
  });
});

describe("Phase 1c: Graph traversal helpers", () => {
  describe("getChildren", () => {
    it("returns child owners", () => {
      createRoot(() => {
        const owner = getOwner()!;
        createMemo(() => 1);
        createMemo(() => 2);
        const children = getChildren(owner);
        expect(children.length).toBe(2);
      });
    });

    it("returns empty array for owner with no children", () => {
      createRoot(() => {
        expect(getChildren(getOwner()!).length).toBe(0);
      });
    });
  });

  describe("getSignals", () => {
    it("returns signals created in the owner", () => {
      createRoot(() => {
        const owner = getOwner()!;
        createSignal(0, { name: "a" });
        createSignal(0, { name: "b" });
        const signals = getSignals(owner);
        expect(signals.length).toBe(2);
      });
    });

    it("returns a copy, not a reference to the internal list", () => {
      createRoot(() => {
        const owner = getOwner()!;
        createSignal(0);
        const s1 = getSignals(owner);
        const s2 = getSignals(owner);
        expect(s1).not.toBe(s2);
        expect(s1).toEqual(s2);
      });
    });
  });

  describe("getParent", () => {
    it("returns the parent owner", () => {
      createRoot(() => {
        const parent = getOwner()!;
        createMemo(() => {
          expect(getParent(getOwner()!)).toBe(parent);
          return 0;
        })();
      });
    });

    it("returns null for root with no parent", () => {
      createRoot(() => {
        // The root's parent is null when created outside another root
        const root = getOwner()!;
        expect(getParent(root)).toBeNull();
      });
    });
  });

  describe("getSources / getObservers", () => {
    it("getSources returns dependencies of a computation", () => {
      createRoot(() => {
        const [a] = createSignal(1, { name: "a" });
        const [b] = createSignal(2, { name: "b" });
        let memoOwner: any = null;
        const m = createMemo(() => {
          memoOwner = getOwner();
          return a() + b();
        });
        m();
        flush();
        const sources = getSources(memoOwner!);
        expect(sources.length).toBe(2);
      });
    });

    it("getObservers returns subscribers of a signal", () => {
      createRoot(() => {
        const [a] = createSignal(1);
        const signals = getSignals(getOwner()!);
        const m = createMemo(() => a());
        m();
        flush();
        const observers = getObservers(signals[0]);
        expect(observers.length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe("isDisposed", () => {
    it("returns false for active owner", () => {
      createRoot(() => {
        expect(isDisposed(getOwner()!)).toBe(false);
      });
    });

    it("returns true after disposal", () => {
      let savedOwner: Owner | null = null;
      const dispose = createRoot(d => {
        savedOwner = getOwner();
        return d;
      });
      expect(isDisposed(savedOwner!)).toBe(false);
      dispose();
      expect(isDisposed(savedOwner!)).toBe(true);
    });
  });
});
