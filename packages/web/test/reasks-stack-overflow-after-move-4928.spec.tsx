/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4928 (fuzz seed 71, board app): three keyed optimistic stores, one per
// column. Moves guess every column with the row moved by reference, and on
// acceptance re-ask the columns involved; a rename guesses a row path. When
// the last move's answer lands, `reasks()` must not recurse forever.
import { expect, test } from "vitest";
import { For, action, createSignal, createOptimisticStore, flush, refresh, latest } from "solid-js";
import { render } from "../src/index.js";
const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};
type Row = { id: number; title: string; adding?: boolean };
type Col = "todo" | "doing" | "done";
const COLS: Col[] = ["todo", "doing", "done"];
const TRAIL =
  "land fetchCards:done ; land fetchCards:doing ; right #3 ; down #5 ; up #5 ; right #4 ; left #4 ; land moveCard:3,done,1 ; select #4 ; rename Bravo ; land fetchCards:done ; land fetchCards:doing ; land moveCard:5,done,0";
test("#4928 no stack overflow in reasks after a move lands", async () => {
  const srv: Record<Col, Row[]> = {
    todo: [
      { id: 1, title: "Write spec" },
      { id: 2, title: "Fix login" }
    ],
    doing: [
      { id: 3, title: "Review PR" },
      { id: 4, title: "Deploy" }
    ],
    done: [{ id: 5, title: "Kickoff" }]
  };
  const fl: Record<string, [(v: any) => void, (e: any) => void][]> = {};
  const ask = (k: string) => new Promise<any>((r, j) => (fl[k] ??= []).push([r, j]));
  const where = (id: number) => COLS.find(c => srv[c].some(x => x.id === id));
  const answer = (k: string): any => {
    const [name, rest] = [k.slice(0, k.indexOf(":")), k.slice(k.indexOf(":") + 1)];
    const a = rest.split(",");
    if (name === "fetchCards") return srv[a[0] as Col].map(x => ({ ...x }));
    if (name === "moveCard") {
      const id = +a[0];
      const w = where(id)!;
      const i = srv[w].findIndex(x => x.id === id);
      const [x] = srv[w].splice(i, 1);
      const to = srv[a[1] as Col];
      to.splice(Math.min(+a[2], to.length), 0, x);
      return {};
    }
    if (name === "renameCard") {
      const id = +a[0];
      const w = where(id)!;
      const x = srv[w].find(x => x.id === id)!;
      x.title = a.slice(1).join(",");
      return { id, title: x.title };
    }
    return null;
  };
  const land = (k: string) => {
    const rs = fl[k] ?? [];
    fl[k] = [];
    let v: any;
    for (const _ of rs) v = answer(k);
    rs.forEach(([r]) => r(structuredClone(v)));
  };
  const errors: unknown[] = [];
  const onError = (e: ErrorEvent) => errors.push(e.error);
  window.addEventListener("error", onError);

  const c = document.body.appendChild(document.createElement("div"));
  const sig = (col: Col) =>
    createSignal<any>(() => ask("fetchCards:" + col), { loadingValue: null } as any);
  const [todoAns] = sig("todo"),
    [doingAns] = sig("doing"),
    [doneAns] = sig("done");
  const anss = { todo: todoAns, doing: doingAns, done: doneAns };
  const seen = (col: Col) => () => {
    try {
      return anss[col]();
    } catch {
      return null;
    }
  };
  const S = { todo: seen("todo"), doing: seen("doing"), done: seen("done") };
  const mk = (col: Col) =>
    createOptimisticStore<Row[]>(
      () => (S[col]() ?? []).map((x: any) => ({ id: x.id, title: x.title, adding: false })),
      [],
      { key: "id" } as any
    );
  const [todo, setTodo] = mk("todo"),
    [doing, setDoing] = mk("doing"),
    [done, setDone] = mk("done");
  const stores = { todo, doing, done },
    sets = { todo: setTodo, doing: setDoing, done: setDone };
  const has = (cs: any[] | null, id: number) => cs != null && cs.some(x => x.id === id);
  const home = (id: number): Col =>
    has(S.todo(), id) ? "todo" : has(S.doing(), id) ? "doing" : "done";
  const shownIn = (id: number): Col | "" =>
    COLS.find(col => stores[col].some(r => r.id === id)) ?? "";
  const reask = (cols: Col[]) => {
    for (const col of new Set(cols)) refresh(anss[col]);
  };
  type Move = { id: number; from: Col; to: Col; index: number; row: Row };
  const without = (rs: Row[], id: number) => rs.filter(r => r.id !== id);
  const shifted = (rs: Row[], col: Col, m: Move) =>
    col === m.to
      ? (r2 => [...r2.slice(0, m.index), m.row, ...r2.slice(m.index)])(
          col === m.from ? without(rs, m.id) : rs
        )
      : col === m.from
        ? without(rs, m.id)
        : rs;
  const move = action(function* (m: Move, from: Col) {
    for (const col of COLS) sets[col]((rs: Row[]) => shifted(rs, col, m));
    try {
      yield ask(`moveCard:${m.id},${m.to},${m.index}`);
    } catch {
      return;
    }
    reask([from, m.from, m.to, ...COLS.filter(col => has(latest(S[col]), m.id))]);
  });
  const rename = action(function* (i: number, id: number, t: string, col: Col, shown: Col) {
    sets[shown]((d: any) => {
      d[i].title = t;
    });
    try {
      yield ask(`renameCard:${id},${t}`);
    } catch {
      return;
    }
    reask([col, shown]);
  });
  let selected: number | null = null;
  const clickMove = (id: number, to: Col | "", by: number) => {
    const sh = shownIn(id);
    if (!sh) return;
    const dest = to || sh;
    const rs = stores[sh];
    const index = to ? stores[to].length : rs.findIndex(r => r.id === id) + by;
    move({ id, from: sh, to: dest, index, row: rs.find(r => r.id === id)! }, home(id));
  };
  const LR: Record<Col, [Col | "", Col | ""]> = {
    todo: ["", "doing"],
    doing: ["todo", "done"],
    done: ["doing", ""]
  };
  const col = (rows: Row[]) => (
    <ul>
      <For each={rows}>{(r: any) => <li>{`#${r.id} ${r.title}`}</li>}</For>
    </ul>
  );
  const dispose = render(
    () => (
      <div>
        {col(todo)}
        {col(doing)}
        {col(done)}
      </div>
    ),
    c
  );
  const state = () =>
    [...c.querySelectorAll("ul")]
      .map(u => [...u.querySelectorAll("li")].map(l => l.textContent).join(","))
      .join(" | ");
  try {
    for (const st of TRAIL.split(";").map(s => s.trim())) {
      const [verb, ...rest] = st.split(" ");
      const arg = rest.join(" ");
      if (verb === "land") land(arg);
      else if (verb === "select") selected = +arg.slice(1);
      else if (verb === "left" || verb === "right") {
        const id = +arg.slice(1);
        const sh = shownIn(id);
        if (sh) {
          const to = LR[sh][verb === "left" ? 0 : 1];
          if (to) clickMove(id, to, 0);
        }
      } else if (verb === "up" || verb === "down")
        clickMove(+arg.slice(1), "", verb === "up" ? -1 : 1);
      else if (verb === "rename") {
        const id = selected!;
        const sh = shownIn(id);
        if (sh)
          rename(
            stores[sh].findIndex(r => r.id === id),
            id,
            arg,
            home(id),
            sh
          );
      }
      await tick();
    }
    expect(errors).toEqual([]);
    // Still out: move #5 down, both #4 moves and the rename. The last guess
    // on Done (#4 moved back) arranged it as [5, 3]; To do never answered.
    expect(state()).toBe(" | #4 Bravo | #5 Kickoff,#3 Review PR");
  } finally {
    window.removeEventListener("error", onError);
    dispose();
    c.remove();
  }
});
