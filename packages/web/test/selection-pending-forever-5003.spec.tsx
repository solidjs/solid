/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #5003: `where` reads each list through an error boundary it makes in
// each pass. A held pass keeps its previous tail, so the boundary the last
// pass replaced (disposed) stayed a dep, pending on To do's re-ask. When the
// live boundary settled, the settle walk saw that disposed dep as another
// path to the re-ask and left `where` pending; nothing ever settles a
// disposed node, so the selection never committed (F-2, F-3).
import { test, expect } from "vitest";
import {
  For,
  Loading,
  Show,
  action,
  createMemo,
  createSignal,
  createOptimisticStore,
  refresh,
  flush,
  untrack,
  isPending
} from "solid-js";
import * as Solid from "solid-js";
import { render } from "../src/index.js";
// Not a public export: what the compiler emits for `x catch alt`.
const createErrorBoundary = (Solid as any).createErrorBoundary;
const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

test("a selection made while writes are out commits once everything has landed", async () => {
  const asks: { key: string; res: (v: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
  // answer every open ask with this key
  const land = (key: string, v: any) => {
    for (let i = asks.length - 1; i >= 0; i--)
      if (asks[i].key === key) asks.splice(i, 1)[0].res(structuredClone(v));
  };
  const c = document.body.appendChild(document.createElement("div"));
  const TODO = [
    { id: 1, title: "Write spec", done: 0 },
    { id: 2, title: "Fix login", done: 1 }
  ];
  const DOING = [
    { id: 3, title: "Review PR", done: 2 },
    { id: 4, title: "Deploy", done: 0 }
  ];
  let api: any;
  // `x catch () => alt`: an error boundary over x
  const caught = (f: () => any, alt: any) => {
    const acc = untrack(() =>
      (createErrorBoundary as any)(
        () => f(),
        () => ({ fb: alt })
      )
    );
    return () => {
      const v = acc();
      return v && typeof v === "object" && "fb" in v ? v.fb : v;
    };
  };
  function App() {
    const [selected, setSelected] = createSignal(-1);
    const store = (k: string) =>
      createOptimisticStore(async () => await ask(k), [] as any[], { key: "id" } as any);
    const [todo, setTodo] = store("todo"),
      [doing, setDoing] = store("doing"),
      [done, setDone] = store("done");
    const cols: any = { todo: [todo, setTodo], doing: [doing, setDoing], done: [done, setDone] };
    const has = (rs: any[], id: number) => rs.some(r => r.id === id);
    // which list holds the selected card, its index there, and the card
    const where = createMemo(() =>
      selected() < 0
        ? ""
        : caught(() => has(todo, selected()), false)()
          ? "todo"
          : caught(() => has(doing, selected()), false)()
            ? "doing"
            : caught(() => has(done, selected()), false)()
              ? "done"
              : ""
    );
    const selIndex = createMemo(() =>
      where() === "" ? -1 : cols[where()][0].findIndex((r: any) => r.id === selected())
    );
    const selCard = createMemo(() => (where() === "" ? null : cols[where()][0][selIndex()]));
    const reaskAll = () => {
      refresh(todo);
      refresh(doing);
      refresh(done);
    };
    const select = action(function* (id: number) {
      setSelected(id);
    });
    const toggle = action(function* (col: string, i: number, n: number) {
      // a guess on a row field
      cols[col][1]((d: any) => {
        d[i].done = n;
      });
      yield ask("toggle");
      reaskAll();
    });
    const save = action(function* () {
      // no guess
      yield ask("save");
      reaskAll();
    });
    const move = action(function* (cd: any, from: string, to: string, j: number) {
      for (const k of [from, to])
        cols[k][1]((rs: any[]) => {
          const o = rs.filter(r => r.id !== cd.id);
          return k === to ? [...o.slice(0, j), cd, ...o.slice(j)] : o;
        });
      yield ask("move");
      reaskAll();
    });
    api = { select, toggle, save, move, todo, where, selIndex, selCard };
    const column = (rs: any[]) => (
      <Loading fallback="loading">
        <For each={rs}>{(r: any) => <span>#{r.id} </span>}</For>
      </Loading>
    );
    return (
      <div>
        {column(todo)}|{column(doing)}|
        <Show when={!(where() === "" || selCard() == null)} fallback="select a card">
          #{selected()} in {where()}
        </Show>
        {isPending(() => selected()) ? " (pending)" : ""}
      </div>
    );
  }
  render(() => <App />, c);
  const screen = () => c.textContent!.replace(/\s+/g, " ").trim();
  await tick();
  land("todo", TODO);
  await tick(); // Doing and Done are still on their first load
  api.select(2);
  await tick();
  api.toggle(api.where(), api.selIndex(), api.selCard().done + 1);
  await tick();
  land("toggle", true);
  await tick(); // accepted: re-asks all three
  land("doing", DOING);
  await tick();
  api.save();
  await tick();
  api.move(
    untrack(() => api.todo[0]),
    "todo",
    "doing",
    2
  );
  await tick(); // #1 to the end of Doing
  api.select(3);
  await tick(); // held
  land("save", true);
  await tick();
  api.select(4);
  await tick();
  land("move", true);
  await tick();
  land("done", []);
  await tick();
  land("doing", [...DOING, TODO[0]]);
  await tick();
  land("todo", [TODO[1]]);
  await tick();
  expect(asks.map(a => a.key)).toEqual([]); // nothing is out
  expect(screen()).toBe("#2 |#3 #4 #1 |#4 in doing"); // got "#2 |#3 #4 #1 |#2 in todo (pending)": `selected` stays pending
});
