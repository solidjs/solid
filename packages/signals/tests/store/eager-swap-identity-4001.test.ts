/**
 * #4001 — an eager (unheld, or proxied-before-the-hold) adoption that
 * receives the same raws swapped or reordered keeps each raw its own row:
 * `descend` must not pair slot x's row with the raw that moved in from slot
 * y, or the two rows alias after the commit.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  reconcile
} from "../../src/index.js";

type Row = { name: string };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => (resolve = r));
  return { promise, resolve };
}

function recordStore(read: (s: Record<string, Row>) => unknown) {
  const A = { name: "a" };
  const B = { name: "b" };
  const C = { name: "c" };
  const [server, setServer] = createSignal<Record<string, Row>>({ x: A, y: B, z: C });
  let store!: Record<string, Row>;
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    [store] = createStore(() => server(), {});
    createRenderEffect(
      createMemo(() => read(store)),
      () => {}
    );
  });
  flush();
  return { A, B, C, store, setServer, dispose };
}

function arrayStore(read: (s: Row[]) => unknown) {
  const A = { name: "a" };
  const B = { name: "b" };
  const C = { name: "c" };
  const [server, setServer] = createSignal<Row[]>([A, B, C]);
  let store!: Row[];
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    [store] = createStore(() => server(), [], { key: null });
    createRenderEffect(
      createMemo(() => read(store)),
      () => {}
    );
  });
  flush();
  return { A, B, C, store, setServer, dispose };
}

const recordReads: [string, (s: Record<string, Row>) => unknown][] = [
  ["both rows proxied", s => s.x.name + s.y.name],
  ["only the first slot proxied", s => s.x.name],
  ["only the second slot proxied", s => s.y.name]
];
const arrayReads: [string, (s: Row[]) => unknown][] = [
  ["both rows proxied", s => s[0].name + s[1].name],
  ["only the first slot proxied", s => s[0].name],
  ["only the second slot proxied", s => s[1].name]
];

describe("#4001 eager adoption of swapped raws", () => {
  for (const [label, read] of recordReads) {
    it(`a record swap keeps the rows distinct (${label})`, () => {
      const { A, B, C, store, setServer, dispose } = recordStore(read);
      const px = store.x;
      const py = store.y;
      setServer({ x: B, y: A, z: C });
      flush();
      expect([store.x.name, store.y.name, store.z.name]).toEqual(["b", "a", "c"]);
      expect(store.x).not.toBe(store.y);
      if (label === "both rows proxied") {
        expect(store.x).toBe(py);
        expect(store.y).toBe(px);
      }
      dispose();
    });
  }

  for (const [label, read] of arrayReads) {
    it(`an unkeyed array reorder keeps the rows distinct (${label})`, () => {
      const { A, B, C, store, setServer, dispose } = arrayStore(read);
      const p0 = store[0];
      const p1 = store[1];
      setServer([B, A, C]);
      flush();
      expect(store.map(r => r.name)).toEqual(["b", "a", "c"]);
      expect(store[0]).not.toBe(store[1]);
      if (label === "both rows proxied") {
        expect(store[0]).toBe(p1);
        expect(store[1]).toBe(p0);
      }
      dispose();
    });
  }

  it("a three-way rotation keeps every row distinct (only the first slot proxied)", () => {
    const { A, B, C, store, setServer, dispose } = recordStore(s => s.x.name);
    setServer({ x: B, y: C, z: A });
    flush();
    expect([store.x.name, store.y.name, store.z.name]).toEqual(["b", "c", "a"]);
    expect(new Set([store.x, store.y, store.z]).size).toBe(3);
    dispose();
  });

  it("an unkeyed array rotation keeps every row distinct (all proxied)", () => {
    const { A, B, C, store, setServer, dispose } = arrayStore(s => s.map(r => r.name).join());
    setServer([C, A, B]);
    flush();
    expect(store.map(r => r.name)).toEqual(["c", "a", "b"]);
    expect(new Set([store[0], store[1], store[2]]).size).toBe(3);
    dispose();
  });

  it("an immutable update keeps the row at its slot", () => {
    const { B, C, store, setServer, dispose } = recordStore(s => s.x.name);
    const px = store.x;
    setServer({ x: { name: "a2" }, y: B, z: C });
    flush();
    expect(store.x).toBe(px);
    expect(store.x.name).toBe("a2");
    dispose();
  });

  it("a swap after an earlier swap still keeps the rows distinct", () => {
    const { A, B, C, store, setServer, dispose } = recordStore(s => s.x.name + s.y.name);
    setServer({ x: B, y: A, z: C });
    flush();
    setServer({ x: A, y: B, z: C });
    flush();
    expect([store.x.name, store.y.name]).toEqual(["a", "b"]);
    expect(store.x).not.toBe(store.y);
    dispose();
  });

  it("a record swap adopted under a hold, rows proxied before it", async () => {
    const gate = deferred();
    const { A, B, C, store, setServer, dispose } = recordStore(s => s.x.name + s.y.name);
    const p = action(function* () {
      setServer({ x: B, y: A, z: C });
      yield gate.promise;
    })();
    flush();
    gate.resolve();
    await p;
    flush();
    expect([store.x.name, store.y.name]).toEqual(["b", "a"]);
    expect(store.x).not.toBe(store.y);
    dispose();
  });

  it("an unkeyed array reorder adopted under a hold, rows proxied before it", async () => {
    const gate = deferred();
    const { A, B, C, store, setServer, dispose } = arrayStore(s => s[0].name + s[1].name);
    const p = action(function* () {
      setServer([B, A, C]);
      yield gate.promise;
    })();
    flush();
    gate.resolve();
    await p;
    flush();
    expect(store.map(r => r.name)).toEqual(["b", "a", "c"]);
    expect(store[0]).not.toBe(store[1]);
    dispose();
  });

  it("an unkeyed array shift keeps every row distinct (all proxied)", () => {
    const { B, C, store, setServer, dispose } = arrayStore(s => s.map(r => r.name).join());
    const p1 = store[1];
    const p2 = store[2];
    setServer([B, C, { name: "d" }]);
    flush();
    expect(store.map(r => r.name)).toEqual(["b", "c", "d"]);
    expect(new Set([store[0], store[1], store[2]]).size).toBe(3);
    // B and C were rows already: each keeps its own.
    expect(store[0]).toBe(p1);
    expect(store[1]).toBe(p2);
    dispose();
  });

  it("an unkeyed array shift keeps every row distinct (only the first slot proxied)", () => {
    const { B, C, store, setServer, dispose } = arrayStore(s => s[0].name);
    setServer([B, C, { name: "d" }]);
    flush();
    expect(store.map(r => r.name)).toEqual(["b", "c", "d"]);
    expect(new Set([store[0], store[1], store[2]]).size).toBe(3);
    dispose();
  });

  it("a raw that moves to an earlier slot is not paired again at the slot it left", () => {
    const { B, store, setServer, dispose } = recordStore(s => s.x.name);
    setServer({ x: B, y: { name: "c2" }, z: { name: "z2" } });
    flush();
    expect([store.x.name, store.y.name, store.z.name]).toEqual(["b", "c2", "z2"]);
    expect(store.x).not.toBe(store.y);
    dispose();
  });

  it("a raw re-sent at the slot it left last time keeps the row there", () => {
    const { A, B, C, store, setServer, dispose } = recordStore(s => s.x.name);
    const px = store.x;
    setServer({ x: { name: "a2" }, y: B, z: C });
    flush();
    setServer({ x: A, y: B, z: C });
    flush();
    expect(store.x).toBe(px);
    expect(store.x.name).toBe("a");
    dispose();
  });

  it("a keyed family's keyless rows reorder without aliasing", () => {
    const A = { name: "a" };
    const B = { name: "b" };
    const [server, setServer] = createSignal<Row[]>([A, B]);
    let store!: Row[];
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      [store] = createStore(() => server(), []);
      createRenderEffect(
        createMemo(() => store[0].name + store[1].name),
        () => {}
      );
    });
    flush();
    setServer([B, A]);
    flush();
    expect(store.map(r => r.name)).toEqual(["b", "a"]);
    expect(store[0]).not.toBe(store[1]);
    dispose();
  });

  it("a plain store's unkeyed reconcile of swapped raws", () => {
    const A = { name: "a" };
    const B = { name: "b" };
    const [store, setStore] = createStore<{ x: Row; y: Row }>({ x: A, y: B });
    const seen: string[] = [];
    const dispose = createRoot(d => {
      createRenderEffect(
        () => store.x.name + store.y.name,
        v => void seen.push(v)
      );
      return d;
    });
    flush();
    setStore(reconcile({ x: B, y: A }, null));
    flush();
    expect([store.x.name, store.y.name]).toEqual(["b", "a"]);
    expect(store.x).not.toBe(store.y);
    expect(seen).toEqual(["ab", "ba"]);
    dispose();
  });

  it("a plain store's unkeyed reconcile, one row proxied, tells the slot that moved", () => {
    const A = { name: "a" };
    const B = { name: "b" };
    const [store, setStore] = createStore<Row[]>([A, B]);
    const seen: string[] = [];
    const dispose = createRoot(d => {
      createRenderEffect(
        () => store[0].name,
        v => void seen.push(v)
      );
      return d;
    });
    flush();
    setStore(reconcile([B, A], null));
    flush();
    expect(store.map(r => r.name)).toEqual(["b", "a"]);
    expect(store[0]).not.toBe(store[1]);
    expect(seen).toEqual(["a", "b"]);
    dispose();
  });
});
