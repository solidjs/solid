/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import { For, action, createSignal, createOptimisticStore, flush } from "solid-js";
import { render } from "../src/index.js";

// #4897: one keyed optimistic store over one answer source. An add guesses a
// placeholder at the end; a reorder of the rows above it is guessed and stays
// out. When the add's answer lands, the placeholder never shows beside the
// row the answer wrote. A reorder written as draft writes to rows 0 and 1 is
// its own guess: the add's end shows at once. One returned as a copy
// (`slice` reads the presence of index 2 and the length, which the add
// wrote) derives from the add's guess, and the two holds entangle (D-33,
// #4788, #4812): the screen keeps what it showed until the reorder settles.
// The signals twin is tests/optimistic-add-placeholder-beside-reorder-4897.

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

function setup(draftStyle: boolean) {
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
  const c = document.body.appendChild(document.createElement("div"));
  const [ans, setAns] = createSignal<any>(() => ask("list"), { loadingValue: null } as any);
  const [rows, setRows] = createOptimisticStore<Row[]>(
    (d: any) => {
      landDraft(d, ans() ?? []);
    },
    [],
    { key: "id" } as any
  );
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
        const out = rs.slice();
        [out[i - 1], out[i]] = [out[i], out[i - 1]];
        return out;
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
  const dispose = render(
    () => (
      <ul>
        <For each={rows}>{(r: any) => <li>{r.adding ? `(${r.title})` : r.id}</li>}</For>
      </ul>
    ),
    c
  );
  const state = () => [...c.querySelectorAll("li")].map(l => l.textContent).join(",");
  return { land, fail, rows, up, add, state, dispose, c };
}

describe("#4897 an ended add's placeholder while a reorder guess on other slots is out", () => {
  for (const draftStyle of [true, false])
    for (const ending of ["answered", "declined"] as const)
      test(`${ending}, reorder ${draftStyle ? "as draft writes" : "returned as a copy"}`, async () => {
        const t = setup(draftStyle);
        t.land("list", [
          { id: 1, title: "a" },
          { id: 2, title: "b" }
        ]);
        await tick();
        t.add(-1, "A", t.rows.length);
        await tick();
        expect(t.state()).toBe("1,2,(A)");
        t.up(2);
        await tick();
        expect(t.state()).toBe("2,1,(A)");
        if (ending === "answered") t.land("add", { id: 10, title: "A" });
        else t.fail("add");
        await tick();
        expect(t.state()).toBe(!draftStyle ? "2,1,(A)" : ending === "answered" ? "2,1,10" : "2,1");
        t.land("move", null);
        await tick();
        expect(t.state()).toBe(ending === "answered" ? "1,2,10" : "1,2");
        t.dispose();
        t.c.remove();
      });

  test("control: without the reorder the row replaces the placeholder", async () => {
    const t = setup(true);
    t.land("list", [
      { id: 1, title: "a" },
      { id: 2, title: "b" }
    ]);
    await tick();
    t.add(-1, "A", t.rows.length);
    await tick();
    t.land("add", { id: 10, title: "A" });
    await tick();
    expect(t.state()).toBe("1,2,10");
    t.dispose();
    t.c.remove();
  });
});
