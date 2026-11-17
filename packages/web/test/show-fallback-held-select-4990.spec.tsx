/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { test, expect } from "vitest";
import {
  For,
  Loading,
  Errored,
  Show,
  action,
  createMemo,
  createSignal,
  createOptimisticStore,
  refresh,
  flush,
  untrack
} from "solid-js";
import * as Solid from "solid-js";
import { render } from "../src/index.js";

// Not in the public types: the boundary `x catch () => alt` compiles to.
const createErrorBoundary = (Solid as any).createErrorBoundary;

// #4990: a Show's fallback reads what its condition read. A held select,
// a list's first load failing, and an unread error boundary over a memo of
// the condition must not mount the fallback over the values from before
// the select.
const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};
for (const extra of [false, true])
  test(`a Show's fallback reads what its condition read (an unread boundary over a memo of the condition: ${extra})`, async () => {
    const asks: { key: string; res: (v: any) => void; rej: (e: any) => void }[] = [];
    const ask = (key: string) => new Promise<any>((res, rej) => asks.push({ key, res, rej }));
    const take = (key: string) =>
      asks.splice(
        asks.findIndex(a => a.key === key),
        1
      )[0];
    const c = document.body.appendChild(document.createElement("div"));
    let api: any;
    function App() {
      const [selected, setSelected] = createSignal(-1);
      const [todo] = createOptimisticStore(
        async () => await ask("todo"),
        [] as any[],
        {
          key: "id"
        } as any
      );
      const [doing, setDoing] = createOptimisticStore(
        async () => await ask("doing"),
        [] as any[],
        {
          key: "id"
        } as any
      );
      const caught = (f: () => any, alt: any) => {
        const acc = untrack(() =>
          createErrorBoundary(
            () => f(),
            () => ({ fb: alt })
          )
        );
        return () => {
          const v = acc();
          return v && typeof v === "object" && "fb" in v ? v.fb : v;
        };
      };
      const has = (rs: any[], id: number) => rs.some(r => r.id === id);
      const where = createMemo(() =>
        selected() < 0
          ? ""
          : caught(() => has(todo, selected()), false)()
            ? "todo"
            : caught(() => has(doing, selected()), false)()
              ? "doing"
              : ""
      );
      if (extra)
        caught(
          createMemo(() => (where(), -1)),
          -1
        );
      const move = action(function* (c: any, j: number) {
        setDoing((rs: any[]) => {
          const r = rs.find(x => x.id === c.id);
          const o = rs.filter(x => x.id !== c.id);
          return [...o.slice(0, j), r, ...o.slice(j)];
        });
        yield ask(`move${j}`);
        refresh(todo);
      });
      const select = action(function* (id: number) {
        setSelected(id);
      });
      api = { doing, move, select };
      const col = (rs: any[]) => (
        <Loading fallback="loading">
          <Errored fallback={() => "error"}>
            <For each={rs}>{(r: any) => <span>{r.id}</span>}</For>
          </Errored>
        </Loading>
      );
      return (
        <div>
          {col(todo)}|{col(doing)}|
          <Show
            when={where() === ""}
            fallback={
              <b>
                #{selected()} in {where()}
              </b>
            }
          >
            select a card
          </Show>
        </div>
      );
    }
    render(() => <App />, c);
    const screen = () => c.textContent!.replace(/\s+/g, " ").trim();
    await tick();
    take("doing").res([{ id: 3 }, { id: 4 }]);
    await tick();
    api.move(api.doing[1], 0);
    await tick();
    api.move(api.doing[0], 1);
    await tick();
    api.select(4);
    await tick();
    expect(screen()).toBe("loading|34|select a card");
    take("move1").res(true);
    await tick();
    while (asks.some(a => a.key === "todo")) take("todo").rej(new Error("declined"));
    await tick();
    expect(["loading|34|select a card", "error|34|#4 in doing"]).toContain(screen());
    take("move0").res(true);
    await tick();
    while (asks.some(a => a.key === "todo")) take("todo").rej(new Error("declined"));
    await tick();
    expect(screen()).toBe("error|34|#4 in doing");
    c.remove();
  });
