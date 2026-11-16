/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4907: a keyed optimistic store whose derive returns its answer. A path
// guess on a row (`d[i].done += 1`) is out; the answer is re-asked and comes
// back without the row, then again with it. The row keeps the guess while
// its action is still out (F-11), as it does when the derive writes its
// draft (keyed merge, then `length`).
import { test, expect } from "vitest";
import { For, action, createSignal, createOptimisticStore, flush, refresh } from "solid-js";
import { render } from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};
type Row = { id: number; done: number };
function landDraft(draft: any[], v: any[]) {
  const had = new Map<unknown, any>();
  for (const row of draft) had.set(row.id, row);
  v.forEach((x, i) => {
    const row = had.get(x.id);
    if (row) {
      for (const k of Object.keys(x)) if (row[k] !== x[k]) row[k] = x[k];
      if (draft[i] !== row) draft[i] = row;
    } else draft[i] = x;
  });
  draft.length = v.length;
}

for (const mode of ["returns its answer", "writes its draft"] as const)
  test(`a row's path guess stays while its row leaves the answer and comes back (derive ${mode})`, async () => {
    const fl: Record<string, ((v: any) => void)[]> = {};
    const ask = (k: string) => new Promise<any>(r => (fl[k] ??= []).push(r));
    const land = (k: string, v: any) => {
      const rs = fl[k] ?? [];
      if (!rs.length) throw new Error("no ask " + k);
      fl[k] = [];
      rs.forEach(r => r(structuredClone(v)));
    };
    const c = document.body.appendChild(document.createElement("div"));
    const [ans] = createSignal<any>(() => ask("list"), { loadingValue: null } as any);
    const [rows, setRows] = createOptimisticStore<Row[]>(
      (mode === "returns its answer"
        ? () => ans() ?? []
        : (d: any) => {
            landDraft(d, ans() ?? []);
          }) as any,
      [],
      { key: "id" } as any
    );
    const toggle = action(function* (i: number) {
      setRows((d: any) => {
        d[i].done += 1;
      });
      yield ask("toggle");
    });
    const dispose = render(
      () => (
        <ul>
          <For each={rows}>
            {(r: any) => (
              <li>
                {r.id}:{r.done}
              </li>
            )}
          </For>
        </ul>
      ),
      c
    );
    const state = () => [...c.querySelectorAll("li")].map(l => l.textContent).join(",");
    const rowsOf = (...v: [number, number][]) => v.map(([id, done]) => ({ id, done }));

    land("list", rowsOf([1, 0], [3, 2]));
    await tick();
    toggle(1);
    await tick();
    expect(state()).toBe("1:0,3:3");
    refresh(ans);
    await tick();
    land("list", []);
    await tick();
    expect(state()).toBe("");
    refresh(ans);
    await tick();
    land("list", rowsOf([1, 0], [3, 2]));
    await tick();
    expect(state()).toBe("1:0,3:3");
    land("toggle", {});
    await tick();
    expect(state()).toBe("1:0,3:2");
    dispose();
    c.remove();
  });
