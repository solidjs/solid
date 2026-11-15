/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4889: a memo finding the selected row of a keyed optimistic store, its
// row's title rendered beside a column of the same store. A placeholder row
// guess seats the memo in the add's lane; an accepted move then re-asks
// both answers, so the memo is pending on those re-asks only. A rename's
// guess on the row must show in the heading as in the column (F-11): the
// heading's pass read the memo as a flight that never showed and waited.
import { test, expect } from "vitest";
import {
  For,
  action,
  createMemo,
  createSignal,
  createOptimisticStore,
  flush,
  refresh
} from "solid-js";
import { render } from "../src/index.js";
const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};
type Row = { id: number; title: string; col: string };
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
test("#4889 a memo's row shows a path guess while a row guess and an accepted move's re-asks are out", async () => {
  const fl: Record<string, ((v: any) => void)[]> = {};
  const ask = (k: string) => new Promise<any>(r => (fl[k] ??= []).push(r));
  const land = (k: string, v: any) => {
    const rs = fl[k] ?? [];
    if (!rs.length) throw new Error("no ask " + k);
    fl[k] = [];
    rs.forEach(r => r(structuredClone(v)));
  };
  const c = document.body.appendChild(document.createElement("div"));
  const [a] = createSignal<any>(() => ask("a"), { loadingValue: null } as any);
  const [b] = createSignal<any>(() => ask("b"), { loadingValue: null } as any);
  const rowsOf = (xs: any[] | null, col: string) => (xs ?? []).map(x => ({ ...x, col }));
  const [board, setBoard] = createOptimisticStore<Row[]>(
    (d: any) => {
      landDraft(d, [...rowsOf(a(), "a"), ...rowsOf(b(), "b")]);
    },
    [],
    { key: "id" } as any
  );
  const [selected, setSelected] = createSignal<number | null>(null);
  const sel = createMemo(() =>
    selected() == null ? null : (board.find(r => r.id === selected()) ?? null)
  );
  const colA = createMemo(() => board.filter(r => r.col === "a"));
  const colB = createMemo(() => board.filter(r => r.col === "b"));
  const move = action(function* (i: number, col: string) {
    setBoard((d: any) => {
      d[i].col = col;
    });
    yield ask("move");
    refresh(a);
    refresh(b);
  });
  const add = action(function* (at: number) {
    setBoard((d: any) => {
      d[at] = { id: -1, title: "new", col: "a" };
    });
    yield ask("add");
  });
  const rename = action(function* (i: number, t: string) {
    setBoard((d: any) => {
      d[i].title = t;
    });
    yield ask("rename");
  });
  render(
    () => (
      <div>
        <p>
          <For each={colA()}>
            {(r: any) => (
              <i>
                {r.id}:{r.title}{" "}
              </i>
            )}
          </For>
          |
          <For each={colB()}>
            {(r: any) => (
              <i>
                {r.id}:{r.title}{" "}
              </i>
            )}
          </For>
        </p>
        <h2>{sel()?.title}</h2>
      </div>
    ),
    c
  );
  const state = () =>
    `${c.querySelector("p")!.textContent} || ${c.querySelector("h2")!.textContent}`;
  land("a", [{ id: 1, title: "one" }]);
  land("b", [{ id: 5, title: "five" }]);
  await tick();
  setSelected(5);
  await tick();
  expect(state()).toBe("1:one |5:five  || five");
  move(0, "b");
  await tick();
  add(board.length);
  await tick();
  land("move", {});
  await tick();
  rename(
    board.findIndex(r => r.id === 5),
    "FIVE"
  );
  await tick();
  expect(state()).toBe("-1:new |1:one 5:FIVE  || FIVE");
});
