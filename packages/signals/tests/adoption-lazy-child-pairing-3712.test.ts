import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  isPending,
  latest,
  untrack
} from "../src/index.js";
const tick = () => new Promise<void>(r => setTimeout(r, 0));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => (resolve = r));
  return { promise, resolve };
}
type Row = { id: string; version: number; tags: { name: string }[] };

function setup(adopt: Row[]) {
  const gate = deferred();
  const [server, setServer] = createSignal<Row[]>([
    { id: "a", version: 0, tags: [{ name: "t0" }] },
    { id: "b", version: 0, tags: [] }
  ]);
  let store!: Row[];
  let dispose!: () => void;
  let drag!: () => string | undefined;
  let setDrag!: (v: string) => void;
  const out: unknown[] = [];
  createRoot(d => {
    dispose = d;
    [store] = createStore<Row[]>(() => server(), []);
    [drag, setDrag] = createSignal<string>();
    createRenderEffect(
      createMemo(() => drag() && store[0].id),
      v => void out.push(v)
    );
  });
  flush();
  const save = action(function* () {
    setServer(adopt);
    yield gate.promise;
  });
  const p = save();
  flush();
  return { store, dispose, drag, setDrag, gate, p, out, setServer };
}

describe("#3712 edges", () => {
  it("one proxy for the row whichever reader asks first (handler vs memo) during the hold", async () => {
    const s = setup([
      { id: "a", version: 1, tags: [{ name: "t0" }] },
      { id: "b", version: 0, tags: [] }
    ]);
    const fromHandler = s.store[0]; // context-free: committed view
    s.setDrag("a");
    flush();
    expect(isPending(s.drag)).toBe(false);
    const fromMemo = untrack(() => s.store[0]);
    expect(fromMemo).toBe(fromHandler);
    expect(fromHandler.id).toBe("a");
    expect(fromHandler.version).toBe(0); // the handler sees the committed frame
    s.gate.resolve();
    await s.p;
    flush();
    expect(s.store[0]).toBe(fromHandler);
    expect(s.store[0].version).toBe(1);
    s.dispose();
  });

  it("a deeper unchanged leaf (row.tags[0].name) holds no one; a changed one holds", async () => {
    const s = setup([
      { id: "a", version: 0, tags: [{ name: "t0" }] },
      { id: "b", version: 1, tags: [] }
    ]);
    let name!: () => unknown;
    createRoot(() => {
      name = createMemo(() => s.drag() && s.store[0].tags[0].name);
      createRenderEffect(name, () => {});
    });
    s.setDrag("a");
    flush();
    expect(isPending(s.drag)).toBe(false);
    expect(name()).toBe("t0");
    s.gate.resolve();
    await s.p;
    flush();
    s.dispose();
  });

  it("a latest() reader of a lazily paired row reads the staged leaf and the row settles after the commit", async () => {
    const s = setup([
      { id: "a", version: 1, tags: [{ name: "t0" }] },
      { id: "b", version: 0, tags: [] }
    ]);
    let v!: () => unknown;
    createRoot(() => {
      v = createMemo(() => latest(() => s.store[0].version));
      createRenderEffect(v, () => {});
    });
    flush();
    expect(v()).toBe(1);
    s.gate.resolve();
    await s.p;
    flush();
    expect(v()).toBe(1);
    expect(s.store[0].version).toBe(1);
    // a later adoption still notifies the row's leaf
    s.setServer([
      { id: "a", version: 2, tags: [{ name: "t0" }] },
      { id: "b", version: 0, tags: [] }
    ]);
    flush();
    expect(v()).toBe(2);
    expect(s.store[0].version).toBe(2);
    s.dispose();
  });

  it("after the commit a plain reader of the paired row's changed leaf sees the new value", async () => {
    const s = setup([
      { id: "a", version: 1, tags: [{ name: "t0" }] },
      { id: "b", version: 0, tags: [] }
    ]);
    s.setDrag("a");
    flush(); // pairs the row
    let ver!: () => unknown;
    createRoot(() => {
      ver = createMemo(() => s.store[0].version);
      createRenderEffect(ver, () => {});
    });
    flush();
    // Born held (D-2): its plain read throws until the commit; latest sees the staging.
    expect(() => ver()).toThrow();
    expect(latest(ver)).toBe(1);
    s.gate.resolve();
    await s.p;
    flush();
    expect(ver()).toBe(1);
    expect(isPending(ver)).toBe(false);
    s.dispose();
  });

  it("an optimistic family adopting truth under a hold pairs its rows the same way", async () => {
    const gate = deferred();
    const [server, setServer] = createSignal([{ id: "a", version: 0 }]);
    let cards!: { id: string; version: number }[];
    let drag!: () => string | undefined;
    let setDrag!: (v: string) => void;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      [cards] = createOptimisticStore(() => server(), [] as { id: string; version: number }[]);
      [drag, setDrag] = createSignal<string>();
      createRenderEffect(
        createMemo(() => drag() && cards[0].id),
        () => {}
      );
    });
    flush();
    const p = action(function* () {
      setServer([{ id: "a", version: 1 }]);
      yield gate.promise;
    })();
    flush();
    await tick();
    setDrag("a");
    flush();
    const pending = isPending(drag);
    gate.resolve();
    await p;
    flush();
    expect(cards[0].version).toBe(1);
    dispose();
    expect(pending).toBe(false);
  });
});

describe("#3712 edges: the action throws", () => {
  it("a held adoption whose action throws: the paired row commits (held writes land) or reverts with the action — no stale staging", async () => {
    const [server, setServer] = createSignal([{ id: "a", version: 0 }]);
    let store!: { id: string; version: number }[];
    let dispose!: () => void;
    let drag!: () => string | undefined;
    let setDrag!: (v: string) => void;
    createRoot(d => {
      dispose = d;
      [store] = createStore<{ id: string; version: number }[]>(() => server(), []);
      [drag, setDrag] = createSignal<string>();
      createRenderEffect(
        createMemo(() => drag() && store[0].id),
        () => {}
      );
    });
    flush();
    const p = action(function* () {
      setServer([{ id: "a", version: 1 }]);
      yield Promise.resolve();
      throw new Error("fail");
    })();
    flush();
    setDrag("a");
    flush(); // pairs the row under the hold
    await p.catch(() => {});
    flush();
    // Held writes land with the action, thrown or not (as the parent's adoption does).
    expect(store[0].version).toBe(1);
    expect(isPending(() => store[0].version)).toBe(false);
    // whichever way the hold ends, a later adoption still reaches the row
    setServer([{ id: "a", version: 2 }]);
    flush();
    expect(store[0].version).toBe(2);
    dispose();
  });
});

describe("#3712 edges: more", () => {
  it("a re-adoption while still held reaches the lazily paired row", async () => {
    const s = setup([
      { id: "a", version: 1, tags: [{ name: "t0" }] },
      { id: "b", version: 0, tags: [] }
    ]);
    s.setDrag("a");
    flush();
    expect(isPending(s.drag)).toBe(false);
    let v!: () => unknown;
    createRoot(() => {
      v = createMemo(() => latest(() => s.store[0].version));
      createRenderEffect(v, () => {});
    });
    flush();
    expect(v()).toBe(1);
    // the server pushes again while the action is still open (the write joins the hold)
    s.setServer([
      { id: "a", version: 2, tags: [{ name: "t0" }] },
      { id: "b", version: 0, tags: [] }
    ]);
    flush();
    expect(v()).toBe(2);
    expect(s.store[0].version).toBe(0); // handler: committed frame
    s.gate.resolve();
    await s.p;
    flush();
    expect(s.store[0].version).toBe(2);
    expect(v()).toBe(2);
    s.dispose();
  });

  it("a mainline setter write to the paired row during the hold publishes mainline", async () => {
    const gate = deferred();
    const [server, setServer] = createSignal([{ id: "a", version: 0, note: "" }]);
    let store!: { id: string; version: number; note: string }[];
    let setStore!: any;
    let dispose!: () => void;
    let drag!: () => string | undefined;
    let setDrag!: (v: string) => void;
    createRoot(d => {
      dispose = d;
      [store, setStore] = createStore<{ id: string; version: number; note: string }[]>(
        () => server(),
        []
      );
      [drag, setDrag] = createSignal<string>();
      createRenderEffect(
        createMemo(() => drag() && store[0].id),
        () => {}
      );
    });
    flush();
    const p = action(function* () {
      setServer([{ id: "a", version: 1, note: "" }]);
      yield gate.promise;
    })();
    flush();
    setDrag("a");
    flush(); // pairs the row
    const [n, setN] = createSignal(0);
    let note!: () => unknown;
    createRoot(() => {
      note = createMemo(() => `${n()}:${store[0].note}`);
      createRenderEffect(note, () => {});
    });
    flush();
    setStore((s: any) => void (s[0].note = "edited"));
    flush();
    expect(untrack(() => store[0].note)).toBe("edited");
    expect(isPending(n)).toBe(false);
    expect(note()).toBe("0:edited");
    gate.resolve();
    await p;
    flush();
    expect(store[0].version).toBe(1);
    expect(store[0].note).toBe("edited");
    dispose();
  });
});

describe("#3712 edges: the same raws swapped under a hold stay distinct rows", () => {
  for (const key of [undefined, null] as const) {
    it(`an array reorder of the same raws, read during the hold (key: ${key})`, async () => {
      const gate = deferred();
      const A = { id: "a", v: 0 };
      const B = { id: "b", v: 0 };
      const [server, setServer] = createSignal([A, B]);
      let store!: { id: string; v: number }[];
      let dispose!: () => void;
      const [on, setOn] = createSignal(false);
      createRoot(d => {
        dispose = d;
        [store] = createStore(() => server(), [], key === undefined ? undefined : { key });
        createRenderEffect(
          createMemo(() => on() && store[0].id),
          () => {}
        );
      });
      flush();
      const p = action(function* () {
        setServer([B, A]);
        yield gate.promise;
      })();
      flush();
      setOn(true);
      flush();
      gate.resolve();
      await p;
      flush();
      expect([store[0].id, store[1].id]).toEqual(["b", "a"]);
      expect(store[0]).not.toBe(store[1]);
      dispose();
    });
  }

  it("a record swap of the same raws, read during the hold", async () => {
    const gate = deferred();
    const A = { name: "a" };
    const B = { name: "b" };
    const [server, setServer] = createSignal<Record<string, { name: string }>>({ x: A, y: B });
    let store!: Record<string, { name: string }>;
    let dispose!: () => void;
    const [on, setOn] = createSignal(false);
    createRoot(d => {
      dispose = d;
      [store] = createStore(() => server(), {});
      createRenderEffect(
        createMemo(() => on() && store.x.name),
        () => {}
      );
    });
    flush();
    const p = action(function* () {
      setServer({ x: B, y: A });
      yield gate.promise;
    })();
    flush();
    setOn(true);
    flush();
    gate.resolve();
    await p;
    flush();
    expect([store.x.name, store.y.name]).toEqual(["b", "a"]);
    dispose();
  });
});
