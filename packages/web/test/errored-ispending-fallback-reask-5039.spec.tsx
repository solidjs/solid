/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #5039: a failed re-ask staged under a hold reaches its Errored once nothing
// is in the air, also when the fallback reads isPending(). A disposed reader
// still marked pending (a row's Show the guess removed) is no display and
// holds nothing (F-3), so the hold lands (D-41) and its verdict lane with it.
import { test, expect } from "vitest";
import {
  For,
  Show,
  Errored,
  action,
  refresh,
  createSignal,
  createOptimisticStore,
  isPending,
  flush
} from "solid-js";
import { render } from "../src/index.js";
const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

for (const readPending of [true, false])
  test(`a failed re-ask shows in its error boundary (${readPending ? "fallback reads isPending" : "control: it doesn't"})`, async () => {
    const asks: { k: string; res: (v: any) => void; rej: (e: any) => void }[] = [];
    const ask = (k: string) => new Promise<any>((res, rej) => asks.push({ k, res, rej }));
    const take = (k: string) => {
      const i = asks.findIndex(a => a.k === k);
      if (i < 0) throw new Error(`no ask ${k} in ${asks.map(a => a.k)}`);
      return asks.splice(i, 1)[0];
    };
    const server: Record<string, any[]> = {
      a: [
        { id: 3, t: "R" },
        { id: 4, t: "D" }
      ],
      b: [{ id: 5, t: "K" }]
    };
    const answer = (k: string) => take(k).res(structuredClone(server[k]));
    let api: any;
    function App() {
      const C: Record<string, any> = {};
      for (const k of ["a", "b"]) {
        const [ans] = createSignal(async () => await ask(k), { loadingValue: null } as any);
        const [rows, setRows] = createOptimisticStore(
          () => ans() ?? [],
          [] as any[],
          { key: "id" } as any
        );
        C[k] = { ans, rows, setRows };
      }
      // a move guesses both lists, and once accepted re-asks both
      const move = action(function* (id: number, from: string, to: string, index: number) {
        try {
          const row = { ...C[from].rows.find((r: any) => r.id === id) };
          C.a.setRows((rs: any[]) => shift(rs, "a"));
          C.b.setRows((rs: any[]) => shift(rs, "b"));
          function shift(rs: any[], k: string) {
            let out = k === from ? rs.filter(r => r.id !== id) : rs;
            return k === to ? [...out.slice(0, index), row, ...out.slice(index)] : out;
          }
          yield ask("move" + id);
          refresh(C.a.ans);
          refresh(C.b.ans);
        } catch {}
      });
      api = { move };
      const List = (p: { k: string; retrying: boolean }) => (
        <Errored
          fallback={(e: any) =>
            readPending ? (
              <Show
                when={p.retrying}
                fallback={
                  <b>
                    {p.k} {e().message}
                  </b>
                }
              >
                {p.k} retrying
              </Show>
            ) : (
              <b>
                {p.k} {e().message}
              </b>
            )
          }
        >
          <Show when={C[p.k].ans() != null} fallback={<i>{p.k} loading</i>}>
            {p.k} ({C[p.k].rows.length}){" "}
            <For each={C[p.k].rows}>
              {(r: any) => (
                <span>
                  <Show when={r.id > 0}>{r.t}</Show>{" "}
                </span>
              )}
            </For>
          </Show>
        </Errored>
      );
      return (
        <section>
          <List k="a" retrying={isPending(() => C.a.ans())} />|
          <List k="b" retrying={isPending(() => C.b.ans())} />
        </section>
      );
    }
    const c = document.body.appendChild(document.createElement("div"));
    render(() => <App />, c);
    const screen = () => c.textContent!.replace(/\s+/g, " ").trim();
    await tick();
    answer("a");
    await tick();
    api.move(3, "a", "a", 1);
    await tick(); // reorder in a
    answer("b");
    await tick();
    server.a = [server.a[1], server.a[0]];
    take("move3").res(true);
    await tick(); // accepted: a and b re-asked
    api.move(5, "b", "a", 2);
    await tick(); // b's card into a
    server.b = [];
    server.a.push({ id: 5, t: "K" });
    take("move5").res(true);
    await tick();
    while (asks.some(a => a.k === "a")) {
      answer("a");
      await tick();
    }
    while (asks.some(a => a.k === "b")) {
      take("b").rej(new Error("declined"));
      await tick();
    } // b's re-asks fail
    expect(asks.map(a => a.k)).toEqual([]);
    expect(screen()).toBe("a (3) D R K |b declined"); // fallback reads isPending: "a (3) D R K |b (0)" — nothing in the air
  });
