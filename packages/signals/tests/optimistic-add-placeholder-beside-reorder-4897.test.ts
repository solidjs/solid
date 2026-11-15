/**
 * #4897 — one keyed optimistic store over one answer source. An add guesses a
 * placeholder at the end; a reorder of the two rows above it is guessed and
 * stays out.
 *
 * - The add's answer lands: the reorder's re-base over that truth kept the
 *   placeholder it carried from the add beside the new row ("2,1,(A),10").
 *   The add's own landing judges the rows the reorder carried from it.
 * - The add is declined while the reorder (draft writes) is out: its length
 *   reverts, and the reorder's carrier, which only borrowed the length
 *   (#4784), no longer served the list's readers, so a `mapArray` never saw
 *   the reorder end ("2,1" after it settled).
 * - A reorder returned as a copy (`slice` reads the presence of index 2 and
 *   the length the add wrote) derives from the add's guess, and the two holds
 *   entangle (D-33, #4788, #4812): neither ends while the other is out.
 *
 * The DOM version is packages/web/test/optimistic-add-placeholder-beside-reorder-4897.spec.tsx.
 */
import { describe, expect, test } from "vitest";
import {
  action,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  mapArray
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};
type Row = { id: number; title: string; adding?: boolean };
// keyed landing: rows matched by key, leaves merged
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
function setup(draftStyle: boolean, reader: "join" | "mapArray") {
  const fl: Record<string, ((v: any) => void)[]> = {};
  const fj: Record<string, ((e: any) => void)[]> = {};
  const ask = (k: string) =>
    new Promise<any>((r, j) => {
      (fl[k] ??= []).push(r);
      (fj[k] ??= []).push(j);
    });
  const land = (k: string, v: any) => {
    const rs = fl[k] ?? [];
    if (!rs.length) throw new Error("no ask " + k);
    fl[k] = [];
    fj[k] = [];
    rs.forEach(r => r(structuredClone(v)));
  };
  const fail = (k: string) => {
    const js = fj[k] ?? [];
    if (!js.length) throw new Error("no ask " + k);
    fl[k] = [];
    fj[k] = [];
    js.forEach(j => j(new Error("no")));
  };
  const out = { join: "" };
  let rows!: Row[];
  let setRows!: any;
  let setAns!: any;
  createRoot(() => {
    const [ans, sa] = createSignal<any>(() => ask("list"), { loadingValue: null } as any);
    setAns = sa;
    [rows, setRows] = createOptimisticStore<Row[]>(
      (d: any) => {
        landDraft(d, ans() ?? []);
      },
      [],
      { key: "id" } as any
    );
    const label = (r: any) => (r.adding ? `(${r.title})` : String(r.id));
    if (reader === "join")
      createRenderEffect(
        () => rows.map(label).join(","),
        v => void (out.join = v)
      );
    else {
      const m = mapArray(
        () => rows,
        r => () => label(r)
      );
      createRenderEffect(
        () =>
          m()
            .map(f => f())
            .join(","),
        v => void (out.join = v)
      );
    }
  });
  flush();
  const up = action(function* (id: number) {
    if (draftStyle)
      setRows((d: any) => {
        const a = d[0],
          b = d[1];
        d[0] = b;
        d[1] = a;
      });
    else
      setRows((rs: Row[]) => {
        const i = rs.findIndex(r => r.id === id);
        const o = rs.slice();
        [o[i - 1], o[i]] = [o[i], o[i - 1]];
        return o;
      });
    yield ask("move");
  });
  const add = action(function* (key: number, title: string, at: number) {
    setRows((d: any) => {
      d[at] = { id: key, title, adding: true };
    });
    try {
      const r: any = yield ask("add");
      setAns((cs: any[]) => [...cs, { id: r.id, title: r.title }]);
    } catch {}
  });
  const state = () => out.join;
  return { land, fail, rows: () => rows, up, add, state };
}

describe("#4897 an ended add's placeholder while a reorder guess on other slots is out", () => {
  for (const reader of ["join", "mapArray"] as const)
    for (const draftStyle of [true, false])
      for (const ending of ["answered", "declined"] as const)
        test(`${reader}: ${ending}, reorder ${draftStyle ? "as draft writes" : "returned as a copy"}`, async () => {
          const t = setup(draftStyle, reader);
          t.land("list", [
            { id: 1, title: "a" },
            { id: 2, title: "b" }
          ]);
          await tick();
          expect(t.state()).toBe("1,2");
          t.add(-1, "A", t.rows().length);
          await tick();
          expect(t.state()).toBe("1,2,(A)");
          t.up(2);
          await tick();
          expect(t.state()).toBe("2,1,(A)");
          if (ending === "answered") t.land("add", { id: 10, title: "A" });
          else t.fail("add");
          await tick();
          expect(t.state()).toBe(
            !draftStyle ? "2,1,(A)" : ending === "answered" ? "2,1,10" : "2,1"
          );
          t.land("move", null);
          await tick();
          expect(t.state()).toBe(ending === "answered" ? "1,2,10" : "1,2");
        });
});
