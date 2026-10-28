import { bench, describe } from "vitest";
import {
  createRenderEffect, createRoot, createSignal, createStore, flush, mapArray, createMemo, reconcile
} from "../../dist/prod/index.js";

const N = 1000;
// server-ish record: 8 fields + nested author, 5 bindings per row
function payload(gen: number, changedEvery = 0) {
  const out = new Array(N);
  for (let i = 0; i < N; i++) {
    const ch = changedEvery && i % changedEvery === 0 ? gen : 0;
    out[i] = {
      id: i, title: `Item ${i} ${ch}`, score: i % 97 + ch, comments: i % 13,
      url: `https://x.y/${i}`, createdAt: 1700000000 + i, tags: ["a", "b"],
      author: { id: i % 50, name: `user${i % 50}`, avatar: `a${i % 50}.png` }
    };
  }
  return out;
}
let sink = 0;
const use = (v: any) => { sink += typeof v === "string" ? v.length : +v || 0; };

type Shape = { refetch: (p: any[]) => void; write: (i: number) => void; dispose: () => void };

function deep(): Shape {
  let api!: Shape;
  createRoot(d => {
    const [s, set] = createStore({ rows: payload(0) });
    const m = createMemo(mapArray(() => s.rows, row => {
      createRenderEffect(() => row.title, use);
      createRenderEffect(() => row.score, use);
      createRenderEffect(() => row.comments, use);
      createRenderEffect(() => row.url, use);
      createRenderEffect(() => row.author.name, use);
      return 1;
    }));
    createRenderEffect(() => m().length, use);
    api = {
      refetch: p => set(st => { reconcile(p, "id")(st.rows); }),
      write: i => set(st => { st.rows[i].score++; }),
      dispose: d
    };
  });
  flush();
  return api;
}

function signalKeyed(): Shape {
  let api!: Shape;
  createRoot(d => {
    const [rows, setRows] = createSignal(payload(0));
    const m = createMemo(mapArray(rows, (row: () => any) => {
      createRenderEffect(() => row().title, use);
      createRenderEffect(() => row().score, use);
      createRenderEffect(() => row().comments, use);
      createRenderEffect(() => row().url, use);
      createRenderEffect(() => row().author.name, use);
      return 1;
    }, { keyed: (r: any) => r.id }));
    createRenderEffect(() => m().length, use);
    api = {
      refetch: p => setRows(p),
      write: i => setRows(rs => rs.map((r, j) => (j === i ? { ...r, score: r.score + 1 } : r))),
      dispose: d
    };
  });
  flush();
  return api;
}

function shallowKeyed(): Shape {
  let api!: Shape;
  createRoot(d => {
    const [rows, set] = createStore(payload(0), { shallow: true });
    const m = createMemo(mapArray(() => rows, (row: () => any) => {
      createRenderEffect(() => row().title, use);
      createRenderEffect(() => row().score, use);
      createRenderEffect(() => row().comments, use);
      createRenderEffect(() => row().url, use);
      createRenderEffect(() => row().author.name, use);
      return 1;
    }, { keyed: (r: any) => r.id }));
    createRenderEffect(() => m().length, use);
    api = {
      refetch: p => set(reconcile(p, null)),
      write: i => set(s => { s[i] = { ...s[i], score: s[i].score + 1 }; }),
      dispose: d
    };
  });
  flush();
  return api;
}

const shapes = { deep, signalKeyed, shallowKeyed } as const;

describe("mount 1000 rows (ingest + 5 bindings/row)", () => {
  for (const [n, f] of Object.entries(shapes)) bench(n, () => { f().dispose(); });
});
let g = 1;
for (const [label, every] of [["refetch, nothing changed", 0], ["refetch, 10% rows changed", 10], ["refetch, all rows changed", 1]] as const) {
  describe(label, () => {
    for (const [n, f] of Object.entries(shapes)) {
      const s = f();
      bench(n, () => { s.refetch(payload(g++, every)); flush(); });
    }
  });
}
describe("client write: one field in one row", () => {
  for (const [n, f] of Object.entries(shapes)) {
    const s = f();
    bench(n, () => { s.write(500); flush(); });
  }
});
describe("client write: one field in every 10th row (100 writes, one flush)", () => {
  for (const [n, f] of Object.entries(shapes)) {
    const s = f();
    bench(n, () => { for (let i = 0; i < N; i += 10) s.write(i); flush(); });
  }
});
