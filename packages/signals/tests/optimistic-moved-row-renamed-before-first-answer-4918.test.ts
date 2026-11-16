// #4918 (fuzz seed 11, board app; each derive returns its answer): a row is
// moved, as it is, into a store whose first answer hasn't come yet, and
// renamed there by a path guess. Both writes are accepted and every answer
// lands: at rest the row shows its store's last answer (the new title).
// The DOM version is packages/web/test/optimistic-moved-row-renamed-before-first-answer-4918.spec.tsx.
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
type Row = { id: number; title: string };

test("#4918 a row moved into a store before its first answer, then renamed there, shows the last answer at rest", async () => {
  const srv = {
    doing: [
      { id: 3, title: "Review" },
      { id: 4, title: "Deploy" }
    ],
    done: [{ id: 5, title: "Kickoff" }]
  };
  const fl: Record<string, ((v: any) => void)[]> = {};
  const ask = (k: string) => new Promise<any>(r => (fl[k] ??= []).push(r));
  const air = () =>
    Object.keys(fl)
      .filter(x => fl[x].length)
      .join(" ");
  const land = (k: string, v?: any) => {
    const rs = fl[k] ?? [];
    if (!rs.length) throw new Error("no ask " + k + " in " + air());
    fl[k] = [];
    rs.forEach(r => r(structuredClone(v)));
  };
  const out: Record<string, string> = {};
  let doing: any, setDoing: any, done: any, setDone: any, doingAns: any, doneAns: any;
  createRoot(() => {
    [doingAns] = createSignal<any>(() => ask("doing"), { loadingValue: null } as any);
    [doneAns] = createSignal<any>(() => ask("done"), { loadingValue: null } as any);
    [doing, setDoing] = createOptimisticStore<Row[]>(() => doingAns() ?? [], [], {
      key: "id"
    } as any);
    [done, setDone] = createOptimisticStore<Row[]>(() => doneAns() ?? [], [], { key: "id" } as any);
    for (const [k, s] of [
      ["doing", doing],
      ["done", done]
    ] as const) {
      const rows = mapArray(
        () => s,
        (r: any) => () => `${r.id}:${r.title}`
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
  const state = () => `${out.doing} | ${out.done}`;
  const move = action(function* (id: number) {
    const row = doing.find((r: Row) => r.id === id)!;
    setDoing((rs: Row[]) => rs.filter(r => r.id !== id));
    setDone((rs: Row[]) => [row, ...rs]);
    yield ask("move");
    refresh(doingAns);
    refresh(doneAns);
  });
  const rename = action(function* (i: number, t: string) {
    setDone((d: any) => {
      d[i].title = t;
    });
    yield ask("rename");
    refresh(doneAns);
  });

  land("doing", srv.doing);
  await tick();
  move(3);
  await tick();
  expect(state()).toBe("4:Deploy | 3:Review");
  rename(0, "Alpha");
  await tick();
  expect(state()).toBe("4:Deploy | 3:Alpha");
  srv.doing = [srv.doing[1]];
  srv.done = [{ id: 3, title: "Review" }, ...srv.done];
  land("move");
  await tick();
  land("done", srv.done);
  await tick();
  srv.done[0] = { id: 3, title: "Alpha" };
  land("rename");
  await tick();
  land("done", srv.done);
  await tick();
  expect(state()).toBe("4:Deploy | 3:Alpha");
  land("doing", srv.doing);
  await tick();
  expect(air()).toBe("");
  expect(state()).toBe("4:Deploy | 3:Alpha,5:Kickoff");
});
