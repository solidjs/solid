/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { test, expect } from "vitest";
import { For, Errored, Loading, action, createOptimisticStore, refresh, flush } from "solid-js";
import { render } from "../src/index.js";
const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};
for (const V of ["full", "noguess", "nofor"])
  test(`#4805 a refresh that rejects under an optimistic add shows the fetch's error (${V})`, async () => {
    const asks: { key: string; res: (v: any) => void; rej: (e: any) => void }[] = [];
    const ask = (key: string) => new Promise<any>((res, rej) => asks.push({ key, res, rej }));
    const pick = (key: string) =>
      asks.splice(
        asks.findIndex(a => a.key === key),
        1
      )[0];
    const c = document.body.appendChild(document.createElement("div"));
    const handed: string[] = [];
    let add!: (id: number, t: string) => any, again!: () => void;
    const dispose = render(() => {
      const [rows, setRows] = createOptimisticStore(
        () => ask("list"),
        [] as any[],
        { key: "id" } as any
      );
      add = action(function* (id: number, t: string) {
        if (V !== "noguess") setRows((rs: any[]) => [...rs, { id, t }]);
        yield ask("add");
        refresh(rows);
      });
      again = () => refresh(rows);
      return (
        <Errored
          fallback={(err: any) => {
            handed.push(String(err()));
            return <b>error: {err()?.message}</b>;
          }}
        >
          <Loading fallback={<i>loading</i>}>
            {V === "nofor" ? (
              <i>{rows.map((r: any) => `[${r.id}${r.t}]`).join("")}</i>
            ) : (
              <For each={rows}>
                {(r: any) => (
                  <i>
                    [{r.id}
                    {r.t}]
                  </i>
                )}
              </For>
            )}
          </Loading>
        </Errored>
      );
    }, c);
    await tick();
    pick("list").res([{ id: 1, t: "c" }]);
    await tick();
    add(2, "d");
    await tick();
    pick("add").res(0);
    await tick();
    pick("list").rej(new Error("declined"));
    await tick();
    const afterReject = c.textContent;
    again();
    await tick();
    pick("list").res([
      { id: 1, t: "c" },
      { id: 2, t: "d" }
    ]);
    await tick();
    again();
    await tick();
    pick("list").res([
      { id: 1, t: "c" },
      { id: 2, t: "d" }
    ]);
    await tick();
    expect(handed).toEqual(["Error: declined"]);
    expect(afterReject).toBe("error: declined");
    expect(c.textContent).toBe("[1c][2d]");
    dispose();
    c.remove();
  });
