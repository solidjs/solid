// #4845: a projection or derived store whose derive writes another store's
// proxy into its draft (`d.cur = rows.list.find(...)`) kept a detached copy.
// The set trap unwrapped the proxy to its raw, and the source store's next
// write copied that raw, so the two stores held different objects. The
// return form chains to the proxy (§7b read-through) and stayed live. Now a
// proxy of another store, not one the write is drafting, is kept and the key
// chains to it like the return form (CS-R3 ingest, CS-R5 upstream writes
// propagate). Writes through the ingesting store stay in it (CS-R4).
import { test, expect } from "vitest";
import {
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  snapshot
} from "../src/index.js";

const rowsStore = () =>
  createStore({
    list: [
      { id: 1, t: "a" },
      { id: 2, t: "b" }
    ]
  });

test("#4845 a projection's draft write of another store's row stays live", () => {
  const [rows, setRows] = rowsStore();
  const [sel, setSel] = createSignal(2);
  let p!: { cur: { id: number; t: string } | null };
  const shown: (string | undefined)[] = [];
  createRoot(() => {
    p = createProjection<{ cur: { id: number; t: string } | null }>(
      d => {
        d.cur = rows.list.find(x => x.id === sel()) ?? null;
      },
      { cur: null }
    );
    createRenderEffect(
      () => p.cur?.t,
      v => void shown.push(v)
    );
  });
  flush();
  setRows(s => {
    s.list[1].t = "z";
  });
  flush();
  expect(p.cur!.t).toBe("z");
  setSel(1);
  flush();
  setRows(s => {
    s.list[0].t = "y";
  });
  flush();
  expect(shown).toEqual(["b", "z", "a", "y"]);
});

test("#4845 a derived store's draft write of another store's list stays live", () => {
  const [rows, setRows] = rowsStore();
  let s2!: { list?: { id: number; t: string }[] };
  const shown: (string | undefined)[] = [];
  createRoot(() => {
    [s2] = createStore<{ list?: { id: number; t: string }[] }>(d => {
      d.list = rows.list;
    }, {});
    createRenderEffect(
      () => s2.list?.[1].t,
      v => void shown.push(v)
    );
  });
  flush();
  setRows(s => {
    s.list[1].t = "z";
  });
  flush();
  setRows(s => {
    s.list.push({ id: 3, t: "c" });
  });
  flush();
  expect(s2.list!.map(r => r.t)).toEqual(["a", "z", "c"]);
  expect(shown).toEqual(["b", "z"]);
});

test("#4845 a derived store's setter writing through the chained row stays in that store", () => {
  const [rows, setRows] = rowsStore();
  let s2!: { cur?: { id: number; t: string } };
  let set2!: (fn: (d: { cur?: { id: number; t: string } }) => void) => void;
  createRoot(() => {
    [s2, set2] = createStore<{ cur?: { id: number; t: string } }>(d => {
      d.cur = rows.list[1];
    }, {});
  });
  flush();
  setRows(s => {
    s.list[1].t = "z";
  });
  flush();
  expect(s2.cur!.t).toBe("z");
  set2(d => {
    d.cur!.t = "local";
  });
  flush();
  expect(s2.cur!.t).toBe("local");
  expect(rows.list[1].t).toBe("z");
  expect(snapshot(rows).list[1]).toEqual({ id: 2, t: "z" });
});
