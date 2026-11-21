/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #5095: after a list's re-ask fails, its Show re-runs and the old For row
// stays on screen as a zombie seated in another action's lane. A rename's
// guess on that row re-staged the memo beside it but not the zombie row,
// which kept the previous title (F-1). A zombie reading the slot is still on
// screen (D-9), so the guess re-stages it too.
import { test, expect } from "vitest";
import {
  For,
  Show,
  Errored,
  action,
  refresh,
  createSignal,
  createMemo,
  createOptimisticStore,
  flush
} from "solid-js";
import { render } from "../src/index.js";
const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

for (const V of ["base", "nofail"])
  test(`${V}: a rename guess shows in the row as in the detail, after the row's list failed a re-ask`, async () => {
    const asks: { k: string; res: (v: any) => void; rej: (e: any) => void }[] = [];
    const ask = (k: string) => new Promise<any>((res, rej) => asks.push({ k, res, rej }));
    const take = (k: string) => {
      const i = asks.findIndex(a => a.k === k);
      if (i < 0) throw new Error(`no ask ${k} in ${asks.map(a => a.k)}`);
      return asks.splice(i, 1)[0];
    };
    const server: Record<string, any[]> = {
      a: [
        { id: 1, t: "W" },
        { id: 2, t: "F" }
      ],
      b: [{ id: 4, t: "D" }],
      c: [{ id: 5, t: "K" }]
    };
    const answer = (k: string) => take(k).res(structuredClone(server[k]));
    let api: any;
    function App() {
      const L: Record<string, any> = {};
      for (const k of ["a", "b", "c"]) {
        const [ans] = createSignal(async () => await ask(k), { loadingValue: null } as any);
        const [rows, setRows] = createOptimisticStore(
          () => ans() ?? [],
          [] as any[],
          { key: "id" } as any
        );
        L[k] = { ans, rows, setRows };
      }
      // the detail finds #5: which list holds it, then the row in it
      const where = createMemo(
        () => ["a", "b", "c"].find(k => L[k].rows.some((r: any) => r.id === 5)) ?? ""
      );
      const sel = createMemo(() => (where() ? L[where()].rows.find((r: any) => r.id === 5) : null));
      const reorder = action(function* () {
        // swap a's two rows; accepted, every list is re-asked
        L.a.setRows((rs: any[]) => [rs[1], rs[0]]);
        yield ask("reorder");
        refresh(L.a.ans);
        refresh(L.b.ans);
        refresh(L.c.ans);
      });
      const move = action(function* () {
        // #5 from c to the end of b; accepted, every list is re-asked
        const row = { ...L.c.rows[0] };
        L.c.setRows((rs: any[]) => rs.filter(r => r.id !== 5));
        L.b.setRows((rs: any[]) => [...rs, row]);
        yield ask("move");
        refresh(L.a.ans);
        refresh(L.b.ans);
        refresh(L.c.ans);
      });
      const rename = action(function* (t: string) {
        L.b.setRows((rs: any[]) => {
          rs[rs.length - 1].t = t;
        });
        yield ask("rename");
        refresh(L.b.ans);
      });
      api = { reorder, move, rename };
      const col = (k: string) => (
        <Errored fallback={<b>{k} error</b>}>
          <Show when={L[k].ans() != null} fallback={<i>loading</i>}>
            <For each={L[k].rows}>
              {(r: any) => (
                <span>
                  #{r.id} {r.t}{" "}
                </span>
              )}
            </For>
          </Show>
        </Errored>
      );
      return (
        <section>
          {col("a")}|{col("b")}|{col("c")}|
          <Show when={sel()} fallback={<i>none</i>}>
            {s => (
              <>
                detail #{s().id} {s().t}
              </>
            )}
          </Show>
        </section>
      );
    }
    const c = document.body.appendChild(document.createElement("div"));
    render(() => <App />, c);
    const screen = () => c.textContent!.replace(/\s+/g, " ").trim();
    await tick();
    answer("a");
    answer("b");
    answer("c");
    await tick();
    api.reorder();
    await tick();
    api.move();
    await tick(); // #5 into b, the reorder still out
    server.a = [server.a[1], server.a[0]];
    take("reorder").res(true);
    await tick(); // accepted: a, b, c re-asked
    if (V === "nofail") answer("b");
    else take("b").rej(new Error("down"));
    await tick(); // b's re-ask fails; a's and c's are out
    server.b = [...server.b, { id: 5, t: "K" }];
    server.c = [];
    take("move").res(true);
    await tick(); // accepted: re-asked again
    api.rename("A");
    await tick(); // rename #5, last in b
    const s = screen();
    // base: the row shows "#5 K", the detail "#5 A". nofail (b's re-ask answered): both "A"
    expect(s.match(/#5 (\w) \|/)?.[1]).toBe(s.match(/detail #5 (\w)/)?.[1]);
  });
