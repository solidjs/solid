// #4902 (fuzz seed 41, board app): a toggle guesses a row's count with a path
// write (`todo[0].done += 1`). A move then passes that row as it is (the store
// row, not a copy) into another optimistic store's guess. Once the move is
// accepted and both re-asks land, the row must keep the toggle's guess while
// the toggle is still out (F-11: a guess stays until its own action ends).
// The DOM version is packages/web/test/optimistic-path-guess-moved-row-4902.spec.tsx.
import { test, expect } from "vitest";
import {
  action,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  mapArray,
  refresh
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};
type Row = { id: number; done: number; total: number };
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

for (const copy of [false, true])
  test(`#4902 a path guess on a row moved into another store ${copy ? "(as a copy)" : "(the row itself)"} stays while its action is out`, async () => {
    const fl: Record<string, ((v: any) => void)[]> = {};
    const ask = (k: string) => new Promise<any>(r => (fl[k] ??= []).push(r));
    const land = (k: string, v: any) => {
      const rs = fl[k] ?? [];
      if (!rs.length) throw new Error("no ask " + k);
      fl[k] = [];
      rs.forEach(r => r(structuredClone(v)));
    };
    const out: Record<string, string> = {};
    let todo: any, setTodo: any, done: any, setDone: any, todoAns: any, doneAns: any;
    createRoot(() => {
      [todoAns] = createSignal<any>(() => ask("todo"), { loadingValue: null } as any);
      [doneAns] = createSignal<any>(() => ask("done"), { loadingValue: null } as any);
      [todo, setTodo] = createOptimisticStore<Row[]>(
        (d: any) => {
          landDraft(d, todoAns() ?? []);
        },
        [],
        { key: "id" } as any
      );
      [done, setDone] = createOptimisticStore<Row[]>(
        (d: any) => {
          landDraft(d, doneAns() ?? []);
        },
        [],
        { key: "id" } as any
      );
      // As `<For>` renders it: one mapped row, each read on its own.
      for (const [k, s] of [
        ["todo", () => todo],
        ["done", () => done]
      ] as const) {
        const rows = mapArray(s, (r: any) => () => `${r.id}:${r.done}/${r.total}`);
        createRenderEffect(
          () =>
            rows()
              .map(f => f())
              .join(","),
          v => {
            out[k] = v;
          }
        );
      }
    });
    const state = () => `${out.todo} | ${out.done}`;
    const toggle = action(function* (i: number) {
      setTodo((d: any) => {
        d[i].done += 1;
      });
      yield ask("toggle");
    });
    const move = action(function* (id: number) {
      const row = todo.find((r: Row) => r.id === id)!;
      setTodo((rs: Row[]) => rs.filter(r => r.id !== id));
      setDone((rs: Row[]) => [...rs, copy ? { ...row } : row]);
      yield ask("move");
      refresh(todoAns);
      refresh(doneAns);
    });

    land("todo", [{ id: 1, done: 0, total: 2 }]);
    land("done", [{ id: 5, done: 3, total: 3 }]);
    await tick();
    toggle(0);
    await tick();
    expect(state()).toBe("1:1/2 | 5:3/3");
    move(1);
    await tick();
    expect(state()).toBe(" | 5:3/3,1:1/2");
    land("move", {});
    await tick();
    land("todo", []);
    await tick();
    expect(state()).toBe(" | 5:3/3,1:1/2");
    land("done", [
      { id: 5, done: 3, total: 3 },
      { id: 1, done: 0, total: 2 }
    ]);
    await tick();
    expect(state()).toBe(" | 5:3/3,1:1/2");
    land("toggle", {});
    await tick();
    expect(state()).toBe(" | 5:3/3,1:0/2");
  });
