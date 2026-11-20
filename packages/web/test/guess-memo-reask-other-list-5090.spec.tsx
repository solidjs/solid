/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #5090: a For row and a detail over the same optimistic store show a fresh
 * guess together while another list the detail reads is being re-asked
 * (F-1, F-11, D-34). The signals version is
 * packages/signals/tests/guess-memo-reask-other-list-5090.test.ts.
 */
import { test, expect } from "vitest";
import {
  For,
  Show,
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

for (const V of ["base", "no-a-reask", "skip-a"])
  test(`${V}: a rename guessed while a move's re-asks are out shows in the row and in the detail`, async () => {
    const asks: { k: string; res: (v: any) => void }[] = [];
    const ask = (k: string) => new Promise<any>(res => asks.push({ k, res }));
    const take = (k: string) => {
      const i = asks.findIndex(a => a.k === k);
      if (i < 0) throw new Error(`no ask ${k} in ${asks.map(a => a.k)}`);
      return asks.splice(i, 1)[0];
    };
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
      // the detail finds its row: which list holds #5, then the row in it
      const where = createMemo(
        () =>
          (V === "skip-a" ? ["b", "c"] : ["a", "b", "c"]).find(k =>
            L[k].rows.some((r: any) => r.id === 5)
          ) ?? ""
      );
      const sel = createMemo(() => (where() ? L[where()].rows.find((r: any) => r.id === 5) : null));
      const move = action(function* () {
        // #5 from c to the end of b; accepted, every list is re-asked
        const row = { ...L.c.rows[0] };
        L.c.setRows((rs: any[]) => rs.filter(r => r.id !== 5));
        L.b.setRows((rs: any[]) => [...rs, row]);
        yield ask("move");
        if (V !== "no-a-reask") refresh(L.a.ans);
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
      api = { move, rename };
      return (
        <section>
          <For each={L.b.rows}>
            {(r: any) => (
              <span>
                #{r.id} {r.t}{" "}
              </span>
            )}
          </For>
          |
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
    take("a").res([{ id: 1, t: "W" }]);
    take("b").res([{ id: 4, t: "D" }]);
    take("c").res([{ id: 5, t: "K" }]);
    await tick();
    api.move();
    await tick();
    take("move").res(true);
    await tick(); // accepted: the re-asks are out
    api.rename("A");
    await tick(); // rename #5, now last in b
    const s = screen();
    // base: the row shows "#5 A", the detail "#5 K". no-a-reask (a isn't re-asked) and skip-a (the detail doesn't look in a): both "A"
    expect(s.match(/detail #5 (\w)/)?.[1]).toBe(s.match(/#5 (\w) \|/)?.[1]);
  });
