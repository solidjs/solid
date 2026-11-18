/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { test, expect } from "vitest";
import {
  For,
  Loading,
  action,
  refresh,
  createSignal,
  createMemo,
  createOptimisticStore,
  flush,
  untrack
} from "solid-js";
import * as Solid from "solid-js";
import { render } from "../src/index.js";
const createErrorBoundary = (Solid as any).createErrorBoundary;

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

for (const kind of ["createMemo", "createErrorBoundary"])
  test(`a ${kind} over two memos doesn't hold a selection on another list's refresh`, async () => {
    const asks: { key: string; res: (v: any) => void }[] = [];
    const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
    const take = (key: string) =>
      asks.splice(
        asks.findIndex(a => a.key === key),
        1
      )[0];
    const c = document.body.appendChild(document.createElement("div"));
    let api: any;
    function App() {
      const [selected, setSelected] = createSignal(2);
      const [todo, setTodo] = createOptimisticStore(
        async () => await ask("todo"),
        [] as any[],
        { key: "id" } as any
      );
      const [doing] = createOptimisticStore(
        async () => await ask("doing"),
        [] as any[],
        { key: "id" } as any
      );
      const [items] = createOptimisticStore(
        async () => await ask(`items${selected()}`),
        [] as any[],
        { key: "id" } as any
      );
      const reorder = action(function* () {
        setTodo((rs: any[]) => [...rs].reverse());
        yield ask("reorder");
        refresh(todo);
      });
      const inTodo = createMemo(() => todo.some((r: any) => r.id === selected()));
      const inDoing = createMemo(() => !inTodo() && doing.some((r: any) => r.id === selected()));
      const f = () => (!inTodo() && !inDoing() ? 1 : undefined);
      if (kind === "createMemo") createMemo(f);
      else untrack(() => createErrorBoundary(f, () => 0)); // never read
      api = { reorder, select: setSelected };
      return (
        <div>
          <For each={todo}>{(r: any) => <u>{r.id}</u>}</For>|
          <h2>
            #{selected()} {inTodo() ? "in To do" : inDoing() ? "in Doing" : ""}
          </h2>
          <Loading on={selected()} fallback="loading">
            <For each={items}>{(it: any) => <i>{it.t}</i>}</For>
          </Loading>
        </div>
      );
    }
    render(() => <App />, c);
    const screen = () => c.textContent!.replace(/\s+/g, " ").replace(/^.*\|/, "").trim();
    await tick();
    take("todo").res([{ id: 2 }, { id: 1 }]);
    take("doing").res([{ id: 4 }]);
    take("items2").res([{ id: 21, t: "a" }]);
    await tick();
    expect(screen()).toBe("#2 in To doa");
    api.reorder();
    await tick();
    take("reorder").res({});
    await tick(); // the reorder is answered; To do is asked again
    api.select(4);
    await tick(); // #4 is in Doing; its items are asked
    expect(screen()).toBe("#4 in Doingloading"); // createErrorBoundary: "#2 in To doa", until To do's refresh lands
  });
