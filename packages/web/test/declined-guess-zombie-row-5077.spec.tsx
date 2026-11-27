/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #5077 (board-app timing fuzzer): after a failed re-ask, a `For` row and a
// memo over the same optimistic store disagreed about a declined rename.
//
// The failed re-ask makes the `Show` around the list re-run under the moves'
// hold: the old `For` stays on screen as a zombie until that hold commits.
// The rename navigates to its row (`rs[i]`) and writes only `t`, so it
// derives from no other guess and its slot is not held: it is its own hold
// (D-33). Declined, it waits for its truth; when that lands, its correction
// commits (D-34). The zombie row is still on screen (D-9), so it shows the
// correction too. Before the fix, the park of the moves' hold cancelled the
// zombie's pass and the rename's landing never re-ran it: the row kept the
// declined `A` while the memo showed `D`.
//
// `nofail`: the re-ask answers instead and no zombie is left; only agreement
// is pinned there. `bare`: no `Show`, no zombie: both show `D`.
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

const cases = [
  ["base", "D"],
  ["nofail", null],
  ["bare", "D"]
] as const;

for (const [V, want] of cases)
  test(`#5077 ${V}: a For row and a memo agree on a declined rename after a failed re-ask`, async () => {
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
      b: [
        { id: 3, t: "R" },
        { id: 4, t: "D" }
      ]
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
          {
            key: "id"
          } as any
        );
        C[k] = { ans, rows, setRows };
      }
      const [selected, setSelected] = createSignal<number | null>(null);
      const sel = createMemo(() => C.b.rows.find((r: any) => r.id === selected()) ?? null);
      const move = action(function* (k: string, id: number) {
        try {
          const row = { ...C[k].rows.find((r: any) => r.id === id) };
          C[k].setRows((rs: any[]) => [...rs.filter(r => r.id !== id), row]);
          yield ask("move" + id);
          refresh(C.a.ans);
          refresh(C.b.ans);
        } catch {}
      });
      const rename = action(function* (i: number, t: string) {
        try {
          C.b.setRows((rs: any[]) => {
            rs[i].t = t;
          });
          yield ask("rename");
          refresh(C.b.ans);
        } catch {}
      });
      api = { move, rename, setSelected };
      // Made inside the Show, so the Show's re-run leaves it as a zombie.
      const list = () => (
        <For each={C.b.rows}>
          {(r: any) => (
            <span>
              #{r.id} {r.t}{" "}
            </span>
          )}
        </For>
      );
      return (
        <section>
          <Errored fallback={(e: any) => <b>{e().message}</b>}>
            {V === "bare" ? (
              list()
            ) : (
              <Show when={C.b.ans() != null} fallback={<i>loading</i>}>
                {list()}
              </Show>
            )}
          </Errored>
          |
          <Errored fallback={<i>none</i>}>
            <Show when={sel()} fallback={<i>none</i>}>
              {s => (
                <>
                  detail #{s().id} {s().t}
                </>
              )}
            </Show>
          </Errored>
        </section>
      );
    }
    const c = document.body.appendChild(document.createElement("div"));
    const dispose = render(() => <App />, c);
    const screen = () => c.textContent!.replace(/\s+/g, " ").trim();
    await tick();
    answer("a");
    await tick();
    // 1. A move guesses on `a`; accepted, it refreshes both lists.
    api.move("a", 1);
    await tick();
    answer("b");
    await tick();
    // 2. While it is out, a second move guesses on `b`.
    api.move("b", 3);
    await tick();
    // 3. The first move is accepted; `b`'s re-ask fails (`a`'s is still out).
    server.a = [server.a[1], server.a[0]];
    take("move1").res(true);
    await tick();
    api.setSelected(4);
    await tick();
    if (V === "nofail") answer("b");
    else take("b").rej(new Error("down"));
    await tick();
    // 4. The second move is accepted and re-asks both lists.
    server.b = [server.b[1], server.b[0]];
    take("move3").res(true);
    await tick();
    // 5. A rename guesses on `b[0]` and is declined.
    api.rename(0, "A");
    await tick();
    take("rename").rej(new Error("declined"));
    await tick();
    // 6. `b`'s re-ask lands; `a`'s two re-asks are still out.
    answer("b");
    await tick();
    const s = screen();
    const row = s.match(/#4 (\w) #3/)?.[1];
    expect(s.match(/detail #4 (\w)/)?.[1]).toBe(row);
    if (want) expect(row).toBe(want);
    dispose();
    c.remove();
  });
