/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4737: a keyed `createOptimisticStore` with a sync derive over an async
// memo. One action guesses, lands, and refreshes; the refresh rejects.
// A field guess lets `<Errored>` show the failure. The same change written
// as a setter return (`return d.map(...)`, one write on row 1 per #4724)
// must read the same: the failure reaches `<Errored>`.
import { expect, test } from "vitest";
import {
  Loading,
  Errored,
  For,
  action,
  createOptimisticStore,
  createMemo,
  createSignal,
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

for (const form of ["field", "return"] as const)
  test(`#4737 a failed refresh after a ${form} guess shows its error`, async () => {
    const asks: { key: string; res: (v: any) => void; rej: (e: any) => void }[] = [];
    const ask = (key: string) => new Promise<any>((res, rej) => asks.push({ key, res, rej }));
    const pick = (key: string) => asks.splice(
      asks.findIndex(a => a.key === key),
      1
    )[0];
    const container = document.body.appendChild(document.createElement("div"));
    let assign!: (id: number) => any;
    const server = [
      { id: 1, a: "-" },
      { id: 3, a: "-" }
    ];
    const dispose = render(() => {
      const [filter] = createSignal("open");
      const list = createMemo(() => (filter(), ask("fetch")));
      const [rows, set] = createOptimisticStore(
        (d: any[]) => {
          const r = (list() as any[]).map(x => ({ ...x }));
          d.length = r.length;
          r.forEach((x, i) => {
            d[i] = x;
          });
        },
        [] as any[],
        { key: "id" }
      );
      assign = action(function* (id: number) {
        set((d: any) => {
          if (form === "return") {
            return d.map((r: any) => (r.id === id ? { ...r, a: "guest" } : r));
          }
          d.find((x: any) => x.id === id).a = "guest";
        });
        yield ask(`assign:${id}`);
        refresh(list);
        refresh(rows);
      });
      return (
        <Loading on={filter()} fallback={<i>loading</i>}>
          <Errored fallback={(e: any) => <b>list error: {e().message}</b>}>
            <For each={rows}>
              {(r: any) => (
                <i>
                  [#{r.id} {r.a}]
                </i>
              )}
            </For>
          </Errored>
        </Loading>
      );
    }, container);
    await tick();
    pick("fetch").res(server.map(x => ({ ...x })));
    await tick();
    expect(container.textContent).toBe("[#1 -][#3 -]");
    assign(1);
    await tick();
    expect(container.textContent).toBe("[#1 guest][#3 -]");
    server[0].a = "guest";
    pick("assign:1").res({});
    await tick();
    expect(container.textContent).toBe("[#1 guest][#3 -]");
    pick("fetch").rej(new Error("down"));
    await tick();
    expect(container.textContent).toBe("list error: down");
    dispose();
    container.remove();
  });
