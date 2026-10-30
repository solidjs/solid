import { expect, it } from "vitest";
import {
  createEffect,
  createMemo,
  createOptimisticStore,
  createRoot,
  createSignal,
  createStore,
  flush
} from "../src/index.js";

// #4437 (F-12): a derived optimistic store whose derive reads a failed async
// memo is errored, as `createStore(fn)` is.
const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

for (const kind of ["optimistic", "store"] as const)
  for (const form of ["await", "memo-async", "memo-sync"] as const)
    it(`${kind} over a failing loader (${form}) delivers the error`, async () => {
      const asks: { key: string; res: (v: any) => void; rej: (e: any) => void }[] = [];
      const ask = (key: string) => new Promise<any>((res, rej) => asks.push({ key, res, rej }));
      const settle = async (key: string, f: (a: any) => void) => {
        for (const a of asks.filter(a => a.key === key)) {
          asks.splice(asks.indexOf(a), 1);
          f(a);
        }
        await tick();
      };
      const frames: string[] = [];
      let setFilter!: (f: string) => void;
      createRoot(() => {
        const [filter, sf] = createSignal("open");
        setFilter = sf;
        const m = createMemo(() => ask(`f:${filter()}`));
        const make: any = kind === "store" ? createStore : createOptimisticStore;
        const write = (d: any[], r: any) => {
          d.length = 0;
          d.push(...r.map((x: any) => ({ ...x })));
        };
        const [issues] = make(
          form === "memo-sync"
            ? (d: any[]) => {
                write(d, m());
              }
            : async (d: any[]) => {
                write(d, form === "memo-async" ? m() : await ask(`f:${filter()}`));
              },
          [],
          { key: "id" }
        );
        createEffect(() => (issues as any[]).map(i => `#${i.id}`).join(" "), {
          effect: (v: string) => {
            frames.push(v);
          },
          error: (e: any) => {
            frames.push(`ERR ${e?.message ?? e}`);
          }
        } as any);
      });
      await tick();
      await settle("f:open", a => a.res([{ id: 1 }, { id: 3 }]));
      setFilter("closed");
      flush();
      await tick();
      await settle("f:closed", a => a.rej(new Error("timeout")));
      expect(frames).toEqual(["#1 #3", "ERR timeout"]);
    });
