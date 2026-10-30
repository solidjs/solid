import { expect, it } from "vitest";
import {
  action,
  createLoadingBoundary,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  flush,
  mapArray,
  refresh
} from "../src/index.js";

// #4441: two actions each remove a row with `splice`. The first is accepted
// and refreshes; its refresh answers (without the row) while the second is
// still pending. The answer is re-based under the second's arrangement guess:
// the row both guesses and the answer removed must not come back.
const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

for (const boundary of [false, true])
  for (const form of ["splice", "replace"] as const)
    it(`a removed row stays removed when its refresh lands under another removal (${form}, Loading=${boundary})`, async () => {
      const asks: { key: string; res: (v: any) => void }[] = [];
      const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
      const land = async (key: string, v: any) => {
        for (const a of asks.filter(a => a.key === key)) {
          asks.splice(asks.indexOf(a), 1);
          a.res(v);
        }
        await tick();
      };
      const frames: string[] = [];
      let view: () => string = () => "";
      const snap = (l: string) => frames.push(`${l}: ${view()}`);
      let closeOne!: (id: number) => any;
      let dispose!: () => void;
      createRoot(d => {
        dispose = d;
        const [issues, set] = createOptimisticStore(
          async (d: any[]) => {
            const r = await ask("fetch");
            d.length = r.length;
            r.forEach((x: any, i: number) => {
              d[i] = x;
            });
          },
          [] as any[],
          { key: "id" }
        );
        closeOne = action(function* (id: number) {
          set((d: any) => {
            if (form === "splice") {
              const i = d.findIndex((t: any) => t.id === id);
              if (i >= 0) d.splice(i, 1);
            } else {
              const next = d.filter((t: any) => t.id !== id);
              d.length = next.length;
              next.forEach((x: any, i: number) => {
                d[i] = x;
              });
            }
          });
          yield ask(`close:${id}`);
          refresh(issues);
        });
        const list = () =>
          mapArray(
            () => issues,
            (it: any) => {
              const s = { id: "" };
              createRenderEffect(
                () => it.id,
                v => {
                  s.id = v;
                }
              );
              return s;
            }
          );
        const b = boundary ? createLoadingBoundary(list, () => "loading") : list;
        createRenderEffect(
          () => {
            const v: any = b();
            return typeof v === "function" ? v() : v;
          },
          (v: any) => {
            view = () => (typeof v === "string" ? v : v.map((s: any) => `[#${s.id}]`).join(""));
          }
        );
      });
      await tick();
      await land("fetch", [{ id: 1 }, { id: 3 }, { id: 4 }]);
      snap("loaded");
      closeOne(1);
      await tick();
      snap("close 1");
      closeOne(4);
      await tick();
      snap("close 4");
      await land("close:1", {});
      snap("close 1 accepted");
      await land("fetch", [{ id: 3 }, { id: 4 }]);
      snap("refresh answered");
      await land("close:4", {});
      await land("fetch", [{ id: 3 }]);
      snap("close 4 settled");
      dispose();
      expect(frames).toEqual([
        "loaded: [#1][#3][#4]",
        "close 1: [#3][#4]",
        "close 4: [#3]",
        "close 1 accepted: [#3]",
        "refresh answered: [#3]",
        "close 4 settled: [#3]"
      ]);
    });
