/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { test, expect } from "vitest";
import { For, Loading, action, createOptimisticStore, refresh, flush } from "solid-js";
import { render } from "../src/index.js";

// #4988: four unanswered guesses on row 0 of a keyed optimistic store. A guess
// on another field between two guesses on one field must not drop one of them.
const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};
for (const between of [false, true])
  test(`a third guess on a field keeps the two before it (${between ? "a guess on another field between" : "nothing between"})`, async () => {
    const asks: string[] = [];
    const ask = (key: string) =>
      new Promise<any>(res => {
        asks.push(key);
        if (key === "rows") res([{ id: 1, title: "Write spec", done: 0 }]);
      });
    const c = document.body.appendChild(document.createElement("div"));
    const [rows, setRows] = createOptimisticStore(
      async () => await ask("rows"),
      [] as any[],
      {
        key: "id"
      } as any
    );
    const write = action(function* (name: string, f: (d: any) => void) {
      setRows(f);
      yield ask(name); // never answers in this test
      refresh(rows);
    });
    const dispose = render(
      () => (
        <Loading fallback="…">
          <For each={rows}>
            {(r: any) => (
              <span>
                {r.title} {r.done}
              </span>
            )}
          </For>
        </Loading>
      ),
      c
    );
    const screen = () => c.textContent!.replace(/\s+/g, " ").trim();
    await tick();
    write("toggle a", d => {
      d[0].done = d[0].done + 1;
    });
    await tick();
    if (between) {
      write("rename", d => {
        d[0].title = "Alpha";
      });
      await tick();
    }
    write("toggle b", d => {
      d[0].done = d[0].done + 1;
    });
    await tick();
    const title = between ? "Alpha" : "Write spec";
    expect(screen()).toBe(`${title} 2`);
    write("untoggle b", d => {
      d[0].done = d[0].done - 1;
    });
    await tick();
    expect(screen()).toBe(`${title} 1`);
    dispose();
    c.remove();
  });
