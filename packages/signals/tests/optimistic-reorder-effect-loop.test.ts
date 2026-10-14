// #4014: an optimistic leaf write whose landing re-sorts the rows so the
// written row comes back at an EARLIER index; an effect reading every row's
// field spun flush ("Potential Infinite Loop Detected"; prod: hang).
import {
  action,
  createEffect,
  createMemo,
  createOptimisticStore,
  createRoot,
  flush,
  until
} from "../src/index.js";

type Row = { id: string; pos: string };
type Snap = { rows: Row[]; applied: string[] };
const byPos = (a: Row, b: Row) => (a.pos < b.pos ? -1 : a.pos > b.pos ? 1 : 0);

async function scenario(rows0: Row[], id: string, pos: string, o = { sort: true, memo: false }) {
  let publish!: (v: Snap) => void;
  async function* source() {
    yield { rows: rows0.map(r => ({ ...r })), applied: [] } as Snap;
    while (true) yield await new Promise<Snap>(res => (publish = res));
  }
  let store!: Snap, set!: (fn: (s: Snap) => void) => void;
  let dispose!: () => void;
  let runs = 0;
  createRoot(d => {
    dispose = d;
    [store, set] = createOptimisticStore<Snap>(source, { rows: [], applied: [] });
    const m = o.memo ? createMemo(() => store.rows.map(r => r.pos).join()) : null;
    createEffect(
      () => {
        runs++;
        if (m) m();
        else for (const row of store.rows) row.pos;
      },
      () => {}
    );
  });
  flush();
  await new Promise(r => setTimeout(r, 0));
  flush();
  const done = action(function* () {
    set(s => void (s.rows.find(r => r.id === id)!.pos = pos));
    yield until(() => store.applied.includes("m1")); // hold for the echo
  })();
  flush();
  await new Promise(r => setTimeout(r, 0));
  flush();
  const before = runs;
  const answer = rows0.map(r => (r.id === id ? { id, pos } : { ...r }));
  if (o.sort) answer.sort(byPos);
  publish({ rows: answer, applied: ["m1"] });
  await new Promise(r => setTimeout(r, 0)); // the landing's own flush
  flush();
  await done;
  flush();
  const out = { runs: runs - before, rows: store.rows.map(r => `${r.id}@${r.pos}`) };
  dispose();
  return out;
}

const TWO = [
  { id: "r1", pos: "F" },
  { id: "r2", pos: "K" }
];
const FOUR = [...TWO, { id: "r3", pos: "V" }, { id: "r4", pos: "k" }];

it.each([
  ["two rows r2 1->0", TWO, "r2", "A"],
  ["r4 3->0", FOUR, "r4", "A"],
  ["r4 3->2", FOUR, "r4", "L"],
  ["r3 2->1", FOUR, "r3", "G"],
  ["control r1 0->3", FOUR, "r1", "Z"],
  ["control r3 same index", FOUR, "r3", "W"]
] as const)("%s settles", async (_, rows, id, pos) => {
  const r = await scenario([...rows], id, pos);
  expect(r.runs).toBeLessThan(10);
  expect(r.rows).toEqual(
    rows
      .map(x => (x.id === id ? { id, pos } : x))
      .sort(byPos)
      .map(x => `${x.id}@${x.pos}`)
  );
});
it("control: no re-sort", async () => {
  expect((await scenario(TWO, "r2", "A", { sort: false, memo: false })).runs).toBeLessThan(10);
});
it("control: through a memo", async () => {
  expect((await scenario(TWO, "r2", "A", { sort: true, memo: true })).runs).toBeLessThan(10);
});
