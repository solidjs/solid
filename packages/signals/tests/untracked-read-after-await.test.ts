import { describe, expect, it, vi } from "vitest";
import {
  action,
  createMemo,
  createRoot,
  createSignal,
  createStore,
  flush,
  untrack,
  type SourceAccessor,
  OBSERVE
} from "../src/index.js";
import { asyncTailFlights } from "../src/core/dev.js";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

async function settle() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  flush();
}

function captureWarnings() {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const capture = OBSERVE!.diagnostics.capture();
  return () => {
    const events = capture.stop().filter(e => e.code === "UNTRACKED_READ_AFTER_AWAIT");
    warn.mockRestore();
    error.mockRestore();
    return events;
  };
}

function mount<T>(fn: () => T | Promise<T>) {
  let memo!: SourceAccessor<T>;
  const dispose = createRoot(dispose => {
    memo = createMemo(fn as () => Promise<T>, { name: "result" });
    try {
      memo();
    } catch {}
    return dispose;
  });
  return { memo, dispose };
}

describe("UNTRACKED_READ_AFTER_AWAIT (dev)", () => {
  it("warns when a ready signal is first read after await, and the memo really goes stale", async () => {
    const stop = captureWarnings();
    const [filter, setFilter] = createSignal("a", { name: "filter" });
    const gate = deferred();
    let runs = 0;
    const { memo, dispose } = mount(async () => {
      runs++;
      await gate.promise;
      return `items:${filter()}`;
    });
    gate.resolve();
    await settle();
    expect(memo()).toBe("items:a");

    setFilter("b");
    await settle();
    // The silent-stale bug the warning exists for.
    expect(runs).toBe(1);
    expect(memo()).toBe("items:a");

    const events = stop();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ severity: "warn", nodeName: "filter", ownerName: "result" });
    dispose();
  });

  it("warns for a read inside an awaited helper", async () => {
    const stop = captureWarnings();
    const [page] = createSignal(1, { name: "page" });
    async function load() {
      await null;
      return page();
    }
    const { dispose } = mount(async () => {
      await null;
      return await load();
    });
    await settle();
    expect(stop().map(e => e.nodeName)).toEqual(["page"]);
    dispose();
  });

  it("misses a helper returned without await (known false negative)", async () => {
    const stop = captureWarnings();
    const [page] = createSignal(1, { name: "page" });
    async function load() {
      await null;
      return page();
    }
    const { dispose } = mount(async () => {
      await null;
      return load();
    });
    await settle();
    expect(stop()).toEqual([]);
    dispose();
  });

  it("stays quiet when the source was already read before the first await", async () => {
    const stop = captureWarnings();
    const [id, setId] = createSignal(1, { name: "id" });
    let runs = 0;
    const { dispose } = mount(async () => {
      runs++;
      const before = id();
      await null;
      return before + id();
    });
    await settle();
    setId(2);
    await settle();
    expect(runs).toBe(2);
    expect(stop()).toEqual([]);
    dispose();
  });

  it("stays quiet for an explicit untrack() after await", async () => {
    const stop = captureWarnings();
    const [flag] = createSignal(true, { name: "flag" });
    const { dispose } = mount(async () => {
      await null;
      return untrack(flag);
    });
    await settle();
    expect(stop()).toEqual([]);
    dispose();
  });

  it("stays quiet for reads in a superseded flight", async () => {
    const stop = captureWarnings();
    const [key, setKey] = createSignal(1, { name: "key" });
    const [other] = createSignal("x", { name: "other" });
    const first = deferred();
    const { dispose } = mount(async () => {
      if (key() === 1) {
        await first.promise;
        return other();
      }
      return "second";
    });
    setKey(2);
    flush();
    first.resolve();
    await settle();
    expect(stop()).toEqual([]);
    dispose();
  });

  it("stays quiet for async code outside computations while a flight is open", async () => {
    const stop = captureWarnings();
    const [count, setCount] = createSignal(0, { name: "count" });
    const gate = deferred();
    const { dispose } = mount(async () => {
      await gate.promise;
      return 1;
    });
    async function handler() {
      await null;
      return count();
    }
    const save = action(function* () {
      yield Promise.resolve();
      setCount(count() + 1);
    });
    await handler();
    await save();
    gate.resolve();
    await settle();
    expect(stop()).toEqual([]);
    dispose();
  });

  it("does not blame a later microtask on the continuation that ran before it", async () => {
    const stop = captureWarnings();
    const [a] = createSignal(1, { name: "a" });
    const [b] = createSignal(2, { name: "b" });
    let late = 0;
    const { dispose } = mount(async () => {
      await null;
      return untrack(a);
    });
    const { dispose: disposeOther } = mount(async () => {
      await null;
      return a();
    });
    Promise.resolve().then(() => (late = b()));
    await settle();
    expect(late).toBe(2);
    expect(stop().map(e => e.nodeName)).toEqual(["a"]);
    dispose();
    disposeOther();
  });

  it("misses a continuation queued before an unowned read in the same microtask window (known false negative)", async () => {
    const stop = captureWarnings();
    const [a] = createSignal(1, { name: "a" });
    const [b] = createSignal(2, { name: "b" });
    const { dispose } = mount(async () => {
      await null;
      return a();
    });
    b();
    await settle();
    expect(stop()).toEqual([]);
    dispose();
  });

  it("releases a flight that never settles once its computation is disposed", async () => {
    const baseline = asyncTailFlights;
    const { dispose } = mount(() => new Promise<number>(() => {}));
    expect(asyncTailFlights).toBe(baseline + 1);
    dispose();
    const { dispose: disposeNext } = mount(async () => 1);
    await settle();
    expect(asyncTailFlights).toBe(baseline);
    disposeNext();
  });

  it("warns once per computation and source", async () => {
    const stop = captureWarnings();
    const [a] = createSignal(1, { name: "a" });
    const { dispose } = mount(async () => {
      await null;
      a();
      await null;
      return a();
    });
    await settle();
    expect(stop()).toHaveLength(1);
    dispose();
  });

  describe("store reads", () => {
    it("warns when a store field is first read after await, and the memo really goes stale", async () => {
      const stop = captureWarnings();
      const [state, setState] = createStore({ filter: "a" });
      let runs = 0;
      const { memo, dispose } = mount(async () => {
        runs++;
        await null;
        return `items:${state.filter}`;
      });
      await settle();
      expect(memo()).toBe("items:a");
      setState(s => {
        s.filter = "b";
      });
      await settle();
      expect(runs).toBe(1);
      expect(memo()).toBe("items:a");
      const events = stop();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ nodeName: "filter", ownerName: "result" });
      dispose();
    });

    it("stays quiet when the field was read before the first await", async () => {
      const stop = captureWarnings();
      const [state, setState] = createStore({ id: 1 });
      let runs = 0;
      const { dispose } = mount(async () => {
        runs++;
        const before = state.id;
        await null;
        return before + state.id;
      });
      await settle();
      setState(s => {
        s.id = 2;
      });
      await settle();
      expect(runs).toBe(2);
      expect(stop()).toEqual([]);
      dispose();
    });

    it("warns only for the field that was not tracked", async () => {
      const stop = captureWarnings();
      const [state] = createStore({ a: 1, b: 2 });
      const { dispose } = mount(async () => {
        const a = state.a;
        await null;
        return a + state.a + state.b;
      });
      await settle();
      expect(stop().map(e => e.nodeName)).toEqual(["b"]);
      dispose();
    });

    it("stays quiet for untrack() after await", async () => {
      const stop = captureWarnings();
      const [state] = createStore({ flag: true });
      const { dispose } = mount(async () => {
        await null;
        return untrack(() => state.flag);
      });
      await settle();
      expect(stop()).toEqual([]);
      dispose();
    });

    it("warns for a derived store (projection) field read after await", async () => {
      const stop = captureWarnings();
      const [source] = createStore({ n: 1 });
      let dispose!: () => void;
      createRoot(d => {
        dispose = d;
        const [derived] = createStore(
          draft => {
            draft.doubled = source.n * 2;
          },
          { doubled: 0 }
        );
        const memo = createMemo(
          async () => {
            await null;
            return derived.doubled;
          },
          { name: "result" }
        );
        try {
          memo();
        } catch {}
      });
      await settle();
      expect(stop().map(e => e.nodeName)).toEqual(["doubled"]);
      dispose();
    });

    it("reports each untracked segment of a nested path", async () => {
      const stop = captureWarnings();
      const [state] = createStore({ user: { name: "Ada" } });
      const { dispose } = mount(async () => {
        await null;
        return state.user.name;
      });
      await settle();
      expect(stop().map(e => e.nodeName)).toEqual(["user", "name"]);
      dispose();
    });

    it("warns once for an array read after await, never for prototype methods", async () => {
      const stop = captureWarnings();
      const [state] = createStore({ items: [1, 2, 3, 4, 5] });
      const { dispose } = mount(async () => {
        const items = state.items;
        await null;
        return items.map(x => x * 2).length;
      });
      await settle();
      expect(stop().map(e => e.nodeName)).toEqual(["length"]);
      dispose();
    });

    it("stays quiet when a nested path was read before the first await", async () => {
      const stop = captureWarnings();
      const [state] = createStore({ user: { name: "Ada" } });
      const { dispose } = mount(async () => {
        const before = state.user.name;
        await null;
        return before + state.user.name;
      });
      await settle();
      expect(stop()).toEqual([]);
      dispose();
    });
  });
});
