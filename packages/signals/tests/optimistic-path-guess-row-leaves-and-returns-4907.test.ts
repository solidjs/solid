// #4907 (board app): a keyed optimistic store whose derive returns its
// answer. A path guess on a row (`d[i].done += 1`) is out; the answer is
// re-asked and comes back without the row, then again with it. The row must
// keep showing the guess while its action is still out (F-11). The same
// derive writing its draft (keyed merge, then `length`) already kept it.
// The DOM version is packages/web/test/optimistic-path-guess-row-leaves-and-returns-4907.spec.tsx.
import { test, expect } from "vitest";
import {
  action,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  mapArray,
  refresh
} from "../src/index.js";

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
  test(`#4907 a row's path guess stays while its row leaves the answer and comes back (derive ${mode})`, async () => {
    const fl: Record<string, ((v: any) => void)[]> = {};
    const ask = (k: string) => new Promise<any>(r => (fl[k] ??= []).push(r));
    const land = (k: string, v: any) => {
      const rs = fl[k] ?? [];
      if (!rs.length) throw new Error("no ask " + k);
      fl[k] = [];
      rs.forEach(r => r(structuredClone(v)));
    };
    let out = "";
    let rows: any, setRows: any, ans: any;
    createRoot(() => {
      [ans] = createSignal<any>(() => ask("list"), { loadingValue: null } as any);
      [rows, setRows] = createOptimisticStore<Row[]>(
        (mode === "returns its answer"
          ? () => ans() ?? []
          : (d: any) => {
              landDraft(d, ans() ?? []);
            }) as any,
        [],
        { key: "id" } as any
      );
      const each = mapArray(
        () => rows,
        (r: any) => () => `${r.id}:${r.done}`
      );
      createRenderEffect(
        () =>
          each()
            .map(f => f())
            .join(","),
        v => {
          out = v;
        }
      );
    });
    const toggle = action(function* (i: number) {
      setRows((d: any) => {
        d[i].done += 1;
      });
      yield ask("toggle");
    });
    land("list", [
      { id: 1, done: 0 },
      { id: 3, done: 2 }
    ]);
    await tick();
    toggle(1);
    await tick();
    expect(out).toBe("1:0,3:3");
    refresh(ans);
    await tick();
    land("list", []);
    await tick();
    expect(out).toBe("");
    refresh(ans);
    await tick();
    land("list", [
      { id: 1, done: 0 },
      { id: 3, done: 2 }
    ]);
    await tick();
    expect(out).toBe("1:0,3:3");
    land("toggle", {});
    await tick();
    expect(out).toBe("1:0,3:2");
  });
