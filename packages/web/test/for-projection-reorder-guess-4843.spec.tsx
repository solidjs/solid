/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4843: a `<For>` over a projection of a keyed optimistic list kept the old
// order after a reorder guess, and kept it after the refetch landed with the
// reversed rows, while the store and the projection read the new order. The
// signals version is packages/signals/tests/projection-reorder-guess-4843.test.ts.
import { test, expect } from "vitest";
import { For, action, createOptimisticStore, createProjection, flush, refresh } from "solid-js";
import { render } from "../src/index.js";

const settle = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

test("#4843 a <For> over a projection of an optimistic list follows a reorder guess", async () => {
  const asks: { key: string; res: (v: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
  const land = async (key: string, v: any) => {
    const i = asks.findIndex(a => a.key === key);
    asks.splice(i, 1)[0].res(v);
    await settle();
  };
  const [rows, setRows] = createOptimisticStore<{ id: number; d: boolean }[]>(
    () => ask("list"),
    [],
    { key: "id" } as any
  );
  const open = createProjection(() => rows.filter(x => !x.d), [] as { id: number; d: boolean }[]);
  const tog = action(function* (id: number, v: boolean) {
    const i = rows.findIndex(x => x.id === id);
    setRows(d => {
      d[i].d = v;
    });
    yield ask("tog");
  });
  const rev = action(function* () {
    setRows(rs => [...rs].reverse());
    yield ask("rev");
    refresh(rows);
  });
  const c = document.createElement("div");
  const dispose = render(() => <ul>{<For each={open}>{y => <li>{y.id}</li>}</For>}</ul>, c);
  const frames: string[] = [];
  const show = (l: string) => frames.push(`${l}: ${c.textContent}`);
  await settle();
  await land("list", [
    { id: 1, d: false },
    { id: 2, d: true }
  ]);
  show("loaded");
  tog(2, false);
  await settle();
  show("tog");
  rev();
  await settle();
  show("rev");
  await land("rev", 0);
  await land("tog", 0);
  show("saved");
  await land("list", [
    { id: 2, d: false },
    { id: 1, d: false }
  ]);
  show("refetched");
  dispose();
  expect(frames).toEqual(["loaded: 1", "tog: 12", "rev: 21", "saved: 21", "refetched: 21"]);
});
