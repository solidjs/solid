// #5204 (board app): a path guess sets a row's count (`todo[1].done = 2`).
// A move then puts that row as it is (the store row, not a copy) into another
// optimistic store, and a second path guess there writes the count back to
// what the first guess covered (`doing[2].done = 1`). With every action still
// out, the second guess shows (F-11: a guess is the displayed value until its
// hold commits). The DOM version is
// packages/web/test/optimistic-moved-row-second-path-guess-5204.spec.tsx.
import { test, expect } from "vitest";
import {
  action,
  createLoadingBoundary,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  flush,
  mapArray
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};
type C = { id: number; done: number };

for (const copy of [false, true])
  for (const first of [true, false])
    test(`#5204 a path guess on a row moved into another store ${copy ? "(as a copy)" : "(the row itself)"}${first ? " while an earlier path guess on it is out" : ""} shows`, async () => {
      const asks: { k: string; res: (v: any) => void }[] = [];
      const ask = (k: string) => new Promise<any>(res => asks.push({ k, res }));
      const find = (k: string) =>
        asks.splice(
          asks.findIndex(a => a.k === k),
          1
        )[0];
      const placed = (rs: C[], c: C, i: number) => {
        const n = rs.filter(x => x.id !== c.id);
        n.splice(i, 0, c);
        return n;
      };
      const L: any = {};
      const out: Record<string, string> = {};
      createRoot(() => {
        for (const k of ["todo", "doing"]) {
          const [s, set] = (createOptimisticStore as any)(async () => await ask(k), [], {
            key: "id"
          });
          L[k] = { s, set };
          const rows = mapArray(
            () => L[k].s,
            (r: any) => () => `[${r.id} ${r.done}]`
          );
          const b = createLoadingBoundary(
            () =>
              rows()
                .map(f => f())
                .join(""),
            () => "L"
          );
          createRenderEffect(b, v => {
            out[k] = v as string;
          });
        }
      });
      const state = () => `todo:${out.todo ?? "L"}doing:${out.doing ?? "L"}`;
      const move = action(function* (card: C, from: string, to: string, i: number) {
        L[from].set((rs: C[]) => rs.filter(x => x.id !== card.id));
        L[to].set((rs: C[]) => placed(rs, copy ? { ...card } : card, i));
        yield ask(`move:${card.id}`);
      });
      const count = action(function* (col: string, i: number, n: number, k: string) {
        L[col].set((d: any) => {
          d[i].done = n;
        });
        yield ask(k);
      });
      await tick();
      find("todo").res([
        { id: 1, done: 0 },
        { id: 2, done: 1 }
      ]);
      await tick();
      if (first) {
        count("todo", 1, 2, "toggle:a");
        await tick();
      }
      find("doing").res([
        { id: 3, done: 2 },
        { id: 4, done: 0 }
      ]);
      await tick();
      move(L.todo.s[1], "todo", "doing", 2);
      await tick();
      expect(state()).toBe(`todo:[1 0]doing:[3 2][4 0][2 ${first ? 2 : 1}]`);
      count("doing", 2, first ? 1 : 2, "toggle:b");
      await tick();
      expect(state()).toBe(`todo:[1 0]doing:[3 2][4 0][2 ${first ? 1 : 2}]`);
      // Each guess ends with its action, back to what it covered (F-11).
      find("toggle:b").res({});
      await tick();
      expect(state()).toBe(`todo:[1 0]doing:[3 2][4 0][2 ${first ? 2 : 1}]`);
      if (first) {
        find("toggle:a").res({});
        await tick();
        expect(state()).toBe(`todo:[1 0]doing:[3 2][4 0][2 ${copy ? 2 : 1}]`);
      }
      find("move:2").res({});
      await tick();
      expect(state()).toBe("todo:[1 0][2 1]doing:[3 2][4 0]");
    });
