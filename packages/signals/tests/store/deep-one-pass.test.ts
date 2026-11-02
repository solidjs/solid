// deep() tracks and snapshots a plain store in one pass: the result keeps
// snapshot()'s shape and identity, and every reachable record stays subscribed.
import { createEffect, createRoot, createStore, deep, flush, snapshot } from "../../src/index.js";

const HIDDEN = Symbol("hidden");

function setup(init: any) {
  let dispose!: () => void;
  let runs = 0;
  let last: any;
  const [store, setStore] = createRoot(d => {
    dispose = d;
    const pair = createStore<any>(init);
    createEffect(
      () => deep(pair[0]),
      value => {
        runs++;
        last = value;
      }
    );
    return pair;
  });
  flush();
  return { store, setStore, dispose, runs: () => runs, last: () => last };
}

it("matches snapshot() for unowned and owned records", () => {
  const shared = { n: 1 };
  const s = setup({ a: shared, b: shared, list: [{ x: 1 }, { x: 2 }] });
  try {
    const first = s.last();
    expect(first).toBe(snapshot(s.store));
    expect(first.a).toBe(first.b);
    s.setStore(d => {
      d.list[1].x = 3;
    });
    flush();
    const next = s.last();
    expect(next).toEqual({ a: { n: 1 }, b: { n: 1 }, list: [{ x: 1 }, { x: 3 }] });
    expect(next.a).toBe(shared);
    expect(next.a).toBe(next.b);
    expect(next.list[0]).toBe(first.list[0]);
    expect(next.list).not.toBe(first.list);
  } finally {
    s.dispose();
  }
});

it("keeps cycles and accessors as snapshot() does", () => {
  const root: any = { child: { v: 1 } };
  root.child.up = root;
  Object.defineProperty(root, "computed", { get: () => 42, enumerable: true });
  const s = setup(root);
  try {
    const out = s.last();
    expect(out.child.up).toBe(out);
    expect(Object.getOwnPropertyDescriptor(out, "computed")?.get).toBeTypeOf("function");
    s.setStore(d => {
      d.child.v = 2;
    });
    flush();
    expect(s.last().child.v).toBe(2);
  } finally {
    s.dispose();
  }
});

it("stays subscribed below a non-enumerable symbol key of an owned record", () => {
  const init: any = { title: "a" };
  Object.defineProperty(init, HIDDEN, { value: { count: 0 }, enumerable: false });
  const s = setup(init);
  try {
    s.setStore(d => {
      d.title = "b";
    });
    flush();
    const before = s.runs();
    s.setStore(d => {
      d[HIDDEN].count = 1;
    });
    flush();
    expect(s.runs()).toBe(before + 1);
  } finally {
    s.dispose();
  }
});

it("re-runs for writes to a record reached only through a shared subtree", () => {
  const leaf = { deep: { count: 0 } };
  const s = setup({ left: { leaf }, right: { leaf } });
  try {
    const before = s.runs();
    s.setStore(d => {
      d.right.leaf.deep.count = 1;
    });
    flush();
    expect(s.runs()).toBe(before + 1);
    expect(s.last().left.leaf.deep.count).toBe(1);
    expect(s.last().left.leaf).toBe(s.last().right.leaf);
  } finally {
    s.dispose();
  }
});
