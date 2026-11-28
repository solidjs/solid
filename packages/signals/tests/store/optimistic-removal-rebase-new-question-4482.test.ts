import { expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  mapArray,
  refresh,
  untrack
} from "../../src/index.js";

// A keyed derived optimistic list over `list(filter)`. A field guess
// (assign #3) and a removal guess (close #3) are out; the filter switch
// holds behind them (D-34). When the assign is accepted, its refresh answers
// the new question: the removal is made again over that answer (D-35), so
// the screen shows only that answer's rows, never the open list's rows
// beside the closed one's (F-1).
const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

it("a removal guess over a new question's answer shows only that answer's rows", async () => {
  const asks: { key: string; res: (v: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
  const settle = async (key: string, v: any) => {
    const i = asks.findIndex(a => a.key === key);
    asks.splice(i, 1)[0].res(v);
    await tick();
  };
  let text = "";
  const seen: string[] = [];
  let setFilter!: (f: string) => void;
  let assignTo!: (id: number, who: string) => any;
  let closeOne!: (id: number) => any;
  const dispose = createRoot(dispose => {
    const [filter, sf] = createSignal("open");
    setFilter = sf;
    const list = createMemo(() => ask(`issues:${filter()}`));
    const [issues, set] = createOptimisticStore(
      async (d: any[]) => {
        const r = list() as any[];
        d.length = r.length;
        r.forEach((x, i) => {
          d[i] = x;
        });
      },
      [] as any[],
      { key: "id" }
    );
    assignTo = action(function* (id: number, who: string) {
      const i = untrack(() => issues.findIndex((t: any) => t.id === id));
      set((d: any) => {
        d[i].assignee = who;
      });
      yield ask(`assign:${id}`);
      refresh(issues);
    });
    closeOne = action(function* (id: number) {
      set((d: any) => {
        const i = d.findIndex((t: any) => t.id === id);
        if (i >= 0) d.splice(i, 1);
      });
      yield ask(`close:${id}`);
      refresh(issues);
    });
    const rows = mapArray(
      () => issues,
      (it: any) => createMemo(() => `[#${it.id} ${it.assignee ?? ""}]`)
    );
    createRenderEffect(
      () =>
        rows()
          .map(r => r())
          .join(""),
      v => {
        seen.push((text = v));
      }
    );
    return dispose;
  });
  try {
    await tick();
    await settle("issues:open", [
      { id: 1, assignee: null },
      { id: 3, assignee: null },
      { id: 4, assignee: "dana" }
    ]);
    expect(text).toBe("[#1 ][#3 ][#4 dana]");
    assignTo(3, "guest");
    await tick();
    expect(text).toBe("[#1 ][#3 guest][#4 dana]");
    closeOne(3);
    await tick();
    expect(text).toBe("[#1 ][#4 dana]");
    setFilter("closed");
    await tick();
    expect(text).toBe("[#1 ][#4 dana]");
    await settle("issues:closed", [{ id: 2, assignee: "eve" }]);
    expect(text).toBe("[#1 ][#4 dana]");
    const from = seen.length;
    await settle("assign:3", {});
    expect(text).toBe("[#2 eve]");
    await settle("close:3", {});
    expect(text).toBe("[#2 eve]");
    expect(seen.slice(from).filter(s => s.includes("#2") && /#1 |#4 /.test(s))).toEqual([]);
  } finally {
    dispose();
  }
});
