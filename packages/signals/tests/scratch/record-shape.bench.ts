import { bench, describe } from "vitest";
import { createRenderEffect, createRoot, createStore, flush, mapArray, createMemo, reconcile } from "../../dist/prod/index.js";
const N = 1000;
function payload(gen: number, changedEvery = 0) {
  const out = new Array(N);
  for (let i = 0; i < N; i++) {
    const ch = changedEvery && i % changedEvery === 0 ? gen : 0;
    out[i] = { id: i, title: `Item ${i} ${ch}`, score: i % 97 + ch, comments: i % 13, url: `https://x.y/${i}`, createdAt: 1700000000 + i, tags: ["a", "b"], author: { id: i % 50, name: `user${i % 50}`, avatar: `a${i % 50}.png` } };
  }
  return out;
}
let sink = 0;
const use = (v: any) => { sink += typeof v === "string" ? v.length : +v || 0; };
function record() {
  let api: any;
  createRoot(d => {
    const [s, set] = createStore({ rows: payload(0) });
    const m = createMemo(mapArray(() => s.rows, (row: () => any) => {
      createRenderEffect(() => row().title, use);
      createRenderEffect(() => row().score, use);
      createRenderEffect(() => row().comments, use);
      createRenderEffect(() => row().url, use);
      createRenderEffect(() => row().author.name, use);
      return 1;
    }, { keyed: (r: any) => r.id }));
    createRenderEffect(() => m().length, use);
    api = { refetch: (p: any[]) => set(st => { st.rows = p; }), write: (i: number) => set(st => { st.rows[i].score++; }), dispose: d };
  });
  flush();
  return api;
}
describe("record store (spike)", () => {
  bench("mount 1000 rows", () => { record().dispose(); });
  let g = 1;
  const a = record(); bench("refetch, nothing changed", () => { a.refetch(payload(g++, 0)); flush(); });
  const b = record(); bench("refetch, 10% rows changed", () => { b.refetch(payload(g++, 10)); flush(); });
  const c = record(); bench("refetch, all rows changed", () => { c.refetch(payload(g++, 1)); flush(); });
  const e = record(); bench("client write: one field in one row", () => { e.write(500); flush(); });
  const f = record(); bench("client write: 100 rows, one flush", () => { for (let i = 0; i < N; i += 10) f.write(i); flush(); });
});
