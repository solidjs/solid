// #4843: `mapArray` over a `createProjection` of a keyed optimistic list
// kept the old order from a reverse guess on, and after the refetch landed
// with the reversed rows. The projection's derive re-ran in the guess's lane
// and staged the new arrangement as the lane's derivation (#4478:
// `holdWithDerive` lists the container in the lane). The structural
// notification then took the container for a guess carrier and wrote the
// staging onto itself as a landing: equal, so nobody heard of it, and the
// lane's commit later changed nothing it had shown. A render effect reading
// the projection's indices saw the new order. Now the container's readers
// re-derive as the lane's work. The DOM version is
// packages/web/test/for-projection-reorder-guess-4843.spec.tsx.
import { test, expect } from "vitest";
import {
  action,
  createMemo,
  createOptimisticStore,
  createProjection,
  createRenderEffect,
  createRoot,
  flush,
  mapArray,
  refresh
} from "../src/index.js";

const settle = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

test("#4843 mapArray over a projection of an optimistic list follows a reorder guess", async () => {
  const asks: { key: string; res: (v: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
  const land = async (key: string, v: any) => {
    const i = asks.findIndex(a => a.key === key);
    asks.splice(i, 1)[0].res(v);
    await settle();
  };
  let rows: any, setRows: any, tog: any, rev: any;
  let mapped = "",
    direct = "";
  const frames: string[] = [];
  createRoot(() => {
    [rows, setRows] = createOptimisticStore(() => ask("list"), [] as any[], { key: "id" } as any);
    const open = createProjection(() => rows.filter((x: any) => !x.d), [] as any[]);
    tog = action(function* (id: number, v: boolean) {
      const i = rows.findIndex((x: any) => x.id === id);
      setRows((d: any) => {
        d[i].d = v;
      });
      yield ask("tog");
    });
    rev = action(function* () {
      setRows((rs: any) => [...rs].reverse());
      yield ask("rev");
      refresh(rows);
    });
    const m = mapArray(
      () => open,
      (y: any) => createMemo(() => y.id)
    );
    createRenderEffect(
      () =>
        m()
          .map(f => f())
          .join(""),
      v => void (mapped = v)
    );
    createRenderEffect(
      () => open.map((y: any) => y.id).join(""),
      v => void (direct = v)
    );
  });
  const show = (l: string) => frames.push(`${l}: ${mapped} ${direct}`);
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
  expect(frames).toEqual([
    "loaded: 1 1",
    "tog: 12 12",
    "rev: 21 21",
    "saved: 21 21",
    "refetched: 21 21"
  ]);
});
