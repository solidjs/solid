/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4998: a row For mounts after a held selection reads two lists through
// error boundaries. The latest re-ask of one list fails while an older ask
// of it and the other list's re-ask are still out. The row must stay held
// or show its values, never blanks (F-1).
import { test, expect } from "vitest";
import {
  For,
  Loading,
  Errored,
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

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

for (const latest of [true, false])
  test(`#4998 a row mounted after a held selection shows its values when the ${latest ? "latest" : "older"} re-ask of a list it reads fails`, async () => {
    const asks: { key: string; res: (v: any) => void; rej: (e: any) => void }[] = [];
    const ask = (key: string) => new Promise<any>((res, rej) => asks.push({ key, res, rej }));
    const take = (key: string) =>
      asks.splice(
        asks.findIndex(a => a.key === key),
        1
      )[0];
    const takeLatest = (key: string) => asks.splice(asks.map(a => a.key).lastIndexOf(key), 1)[0];
    const keys = () => asks.map(a => a.key).join(",");
    const c = document.body.appendChild(document.createElement("div"));
    let api: any;
    const caught = (f: () => any, alt: any) => {
      const acc = untrack(() =>
        (Solid as any).createErrorBoundary(
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
      const [selected, setSelected] = createSignal<number | null>(null);
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
        { key: "id" } as any
      );
      const sel = createMemo(() => (selected() == null ? [] : [{ id: selected() }]));
      const move = action(function* (id: number, j: number) {
        setDoing((rs: any[]) => {
          const r = rs.find(x => x.id === id);
          const o = rs.filter(x => x.id !== id);
          return [...o.slice(0, j), r, ...o.slice(j)];
        });
        yield ask(`move${j}`);
        refresh(todo);
        refresh(doing);
      });
      const select = action(function* (id: number) {
        setSelected(id);
      });
      api = { move, select };
      function Detail(props: { id: number }) {
        const ti = caught(() => todo.findIndex((r: any) => r.id === props.id), -1);
        const di = caught(() => doing.findIndex((r: any) => r.id === props.id), -1);
        const col = createMemo(() => (ti() >= 0 ? "todo" : di() >= 0 ? "doing" : ""));
        return (
          <b>
            #{props.id} in {col()}
          </b>
        );
      }
      const list = (rs: any[]) => (
        <Loading fallback="loading">
          <Errored fallback={() => "error"}>
            <For each={rs}>{(r: any) => <span>{r.id}</span>}</For>
          </Errored>
        </Loading>
      );
      return (
        <div>
          {list(todo)}|{list(doing)}|{sel().length === 0 ? "select a card" : ""}
          <For each={sel()}>{(s: any) => <Detail id={s.id} />}</For>
        </div>
      );
    }
    render(() => <App />, c);
    const screen = () => c.textContent!.replace(/\s+/g, " ").trim();
    await tick();
    take("todo").rej(new Error("declined"));
    await tick();
    take("doing").res([{ id: 3 }, { id: 4 }]);
    await tick();
    expect(screen()).toBe("error|34|select a card");
    api.move(4, 0);
    await tick();
    api.move(4, 1);
    await tick();
    api.select(4);
    await tick();
    // The row's first read of the errored list asks nothing (#5002), so the
    // selection has nothing to wait for and shows at once.
    expect(screen()).toBe("error|34|#4 in doing");
    expect(keys()).toBe("move0,move1");
    take("move1").res(true);
    await tick();
    (latest ? takeLatest : take)("todo").rej(new Error("declined"));
    await tick();
    expect(["error|34|select a card", "error|34|#4 in doing"]).toContain(screen());
    // everything answers: the detail shows where #4 is
    while (asks.some(a => a.key === "todo")) take("todo").rej(new Error("declined"));
    await tick();
    take("doing").res([{ id: 3 }, { id: 4 }]);
    await tick();
    take("move0").res(true);
    await tick();
    while (asks.some(a => a.key === "todo")) take("todo").rej(new Error("declined"));
    while (asks.some(a => a.key === "doing")) take("doing").res([{ id: 3 }, { id: 4 }]);
    await tick();
    expect(screen()).toBe("error|34|#4 in doing");
    void keys;
  });
