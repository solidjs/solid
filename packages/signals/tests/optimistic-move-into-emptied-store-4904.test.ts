// #4904 (fuzz seed 44, board app): a row moved into a keyed optimistic store
// that just emptied reads as undefined once every answer has landed, when
// each row's reader also reads the list's first row (`rows[0]`).
// The DOM version is packages/web/test/optimistic-move-into-emptied-store-4904.spec.tsx.
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
type Row = { id: number };
type Col = "todo" | "doing" | "done";

for (const firstRead of [true, false])
  test(`#4904 a row moved into an emptied keyed optimistic store reads its row once the answers land${firstRead ? "" : " (no rows[0] read)"}`, async () => {
    const srv: Record<Col, number[]> = { todo: [1, 2], doing: [4], done: [3, 5] };
    const fl: Record<string, ((v: any) => void)[]> = {};
    const ask = (k: string) => new Promise<any>(r => (fl[k] ??= []).push(r));
    const land = (k: string, v: any) => {
      const rs = fl[k] ?? [];
      if (!rs.length) throw new Error("no ask " + k);
      fl[k] = [];
      rs.forEach(r => r(structuredClone(v)));
    };
    const landCards = (col: Col) =>
      land(
        col,
        srv[col].map(id => ({ id }))
      );
    const landMove = (id: number, from: Col, to: Col, at: number) => {
      srv[from] = srv[from].filter(x => x !== id);
      srv[to].splice(at, 0, id);
      land(`move:${id}`, {});
    };
    const out: Record<string, string> = {};
    const anss: any = {},
      stores: any = {},
      sets: any = {};
    createRoot(() => {
      for (const k of ["todo", "doing", "done"] as Col[]) {
        const [a] = createSignal<any>(() => ask(k), { loadingValue: null } as any);
        const [s, set] = createOptimisticStore<Row[]>(() => a() ?? [], [], { key: "id" } as any);
        anss[k] = a;
        stores[k] = s;
        sets[k] = set;
        const rows = mapArray(
          () => s,
          (r: any) => () =>
            firstRead ? `${String(r?.id)}${s[0]?.id === r?.id ? "" : "^"}` : String(r?.id)
        );
        createRenderEffect(
          () =>
            rows()
              .map(f => f())
              .join(","),
          v => {
            out[k] = v;
          }
        );
      }
    });
    const state = () => `${out.todo} | ${out.doing} | ${out.done}`.replace(/\^/g, "");
    const move = action(function* (id: number, from: Col, to: Col) {
      const row = stores[from].find((r: Row) => r.id === id)!;
      sets[from]((rs: Row[]) => rs.filter(r => r.id !== id));
      sets[to]((rs: Row[]) => [...rs, row]);
      yield ask(`move:${id}`);
      refresh(anss[from]);
      refresh(anss[to]);
    });
    const S = async (f: () => void) => {
      f();
      await tick();
    };
    await S(() => {
      landCards("todo");
      landCards("doing");
      landCards("done");
    });
    expect(state()).toBe("1,2 | 4 | 3,5");
    await S(() => move(4, "doing", "todo"));
    await S(() => landMove(4, "doing", "todo", 2));
    await S(() => landCards("doing"));
    expect(state()).toBe("1,2,4 |  | 3,5");
    await S(() => move(3, "done", "doing"));
    expect(state()).toBe("1,2,4 | 3 | 5");
    await S(() => landMove(3, "done", "doing", 0));
    await S(() => landCards("todo"));
    await S(() => landCards("done"));
    expect(state()).toBe("1,2,4 | 3 | 5");
    await S(() => landCards("doing"));
    expect(state()).toBe("1,2,4 | 3 | 5");
  });
