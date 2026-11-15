// #4887, #4888: a `refresh()` of an answer that another action's write is
// held on (an accepted add, held with a second add both guessed as one
// change) re-asks the same question (D-34 ¶3). It was classed as a new
// question (#4336's clause is for a held derivation, not a user write), so
// a reader waiting on that re-ask stayed with the write's hold, and a guess
// a later action wrote into its lane never reached it (F-11). The DOM
// versions are packages/web/test/optimistic-column-guess-held-4887.spec.tsx
// and optimistic-guess-under-error-boundary-4888.spec.tsx.
import { test, expect } from "vitest";
import {
  action,
  createMemo,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  refresh
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};
type Row = { id: number; title: string; col: string; pos: number };
// Keyed landing: rows matched by key, leaves merged.
function landDraft(draft: any[], v: any[]) {
  const had = new Map<unknown, any>();
  for (const row of draft) had.set(row.id, row);
  v.forEach((x, i) => {
    const row = had.get(x.id);
    if (row) {
      for (const k of Object.keys(x)) if (row[k] !== x[k]) row[k] = x[k];
      if (draft[i] !== row) draft[i] = row;
    } else draft[i] = x;
  });
  draft.length = v.length;
}

test("#4887 a col guess reaches a column memo waiting on a re-ask of an answer with a held write", async () => {
  const fl: Record<string, ((v: any) => void)[]> = {};
  const ask = (k: string) => new Promise<any>(r => (fl[k] ??= []).push(r));
  const land = (k: string, v: any) => {
    const rs = fl[k] ?? [];
    if (!rs.length) throw new Error("no ask " + k);
    fl[k] = [];
    rs.forEach(r => r(structuredClone(v)));
  };
  const out: Record<string, string> = {};
  let board: any, setBoard: any, setAdding: any, todoAns: any, doingAns: any, setTodoAns: any;
  createRoot(() => {
    [todoAns, setTodoAns] = createSignal<any>(() => ask("todo"), { loadingValue: null } as any);
    [doingAns] = createSignal<any>(() => ask("doing"), { loadingValue: null } as any);
    const [doneAns] = createSignal<any>(() => ask("done"), { loadingValue: null } as any);
    const rowsOf = (cs: any[] | null, col: string) =>
      (cs ?? []).map((x, i) => ({ ...x, col, pos: i }));
    [board, setBoard] = createOptimisticStore<Row[]>(
      (d: any) => {
        landDraft(d, [
          ...rowsOf(todoAns(), "todo"),
          ...rowsOf(doingAns(), "doing"),
          ...rowsOf(doneAns(), "done")
        ]);
      },
      [],
      { key: "id" } as any
    );
    let adding: any;
    [adding, setAdding] = createOptimisticStore<Row[]>(
      (d: any) => {
        landDraft(d, []);
      },
      [],
      { key: "id" } as any
    );
    const inCol = (col: string) =>
      board.filter((r: Row) => r.col === col).sort((x: Row, y: Row) => x.pos - y.pos);
    const columns = {
      todo: createMemo(() => [...inCol("todo"), ...adding]),
      doing: createMemo(() => inCol("doing")),
      done: createMemo(() => inCol("done"))
    };
    for (const [k, m] of Object.entries(columns))
      createRenderEffect(
        () =>
          m()
            .map((r: Row) => r.id)
            .join(","),
        v => {
          out[k] = v;
        }
      );
  });
  const state = () => `${out.todo} | ${out.doing} | ${out.done}`;
  const reask = action(function* () {
    refresh(todoAns);
    refresh(doingAns);
  });
  const move = action(function* (i: number, id: number, col: string, pos: number) {
    setBoard((d: any) => {
      d[i].col = col;
    });
    setBoard((d: any) => {
      d[i].pos = pos;
    });
    yield ask(`move:${id},${col}`);
    yield reask();
  });
  const add = action(function* (key: number, title: string) {
    setAdding((d: any) => [...d, { id: key, title, col: "todo", pos: 0 }]);
    const r: any = yield ask(`add:${title}`);
    setTodoAns((cs: any[]) => [...cs, { id: r.id, title: r.title }]);
  });
  const at = (id: number) => board.findIndex((r: Row) => r.id === id);

  land("todo", [
    { id: 1, title: "a" },
    { id: 2, title: "b" }
  ]);
  land("doing", [
    { id: 3, title: "c" },
    { id: 4, title: "d" }
  ]);
  land("done", [{ id: 5, title: "e" }]);
  await tick();
  expect(state()).toBe("1,2 | 3,4 | 5");
  add(-1, "A");
  await tick();
  add(-2, "B");
  await tick();
  // A's write into To do's answer is held with B (one change).
  land("add:A", { id: 10, title: "A" });
  await tick();
  move(at(3), 3, "doing", 2);
  await tick();
  expect(state()).toBe("1,2,-1,-2 | 4,3 | 5");
  // Accepted: To do and Doing are re-asked; To do's re-ask is over A's held write.
  land("move:3,doing", {});
  await tick();
  move(at(3), 3, "done", 2);
  await tick();
  expect(state()).toBe("1,2,-1,-2 | 4 | 5,3");
});
