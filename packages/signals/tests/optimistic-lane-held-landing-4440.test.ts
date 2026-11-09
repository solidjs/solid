import { expect, it } from "vitest";
import {
  action,
  createEffect,
  createLoadingBoundary,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  mapArray,
  refresh,
  untrack
} from "../src/index.js";

// #4440: a per-key guess whose action landed, its `refresh` in the air; a
// second action replaces the list. The refresh's landing settles readers a
// guess's lane holds: the flush must not join that lane as its transaction
// (the lane dissolves in the same flush), or the rows born in it are held by
// a dead lane and never render.
const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

for (const withCount of [false, true])
  for (const withAssign of [false, true])
    it(`a new row renders after a list guess joins a pending refresh (count=${withCount}, assign=${withAssign})`, async () => {
      const asks: { key: string; res: (v: any) => void }[] = [];
      const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
      const land = async (key: string, v: any) => {
        for (const a of asks.filter(a => a.key === key)) {
          asks.splice(asks.indexOf(a), 1);
          a.res(v);
        }
        await tick();
      };
      let assignTo!: (id: number) => any;
      let closeOne!: (id: number) => any;
      let view: () => string = () => "";
      createRoot(() => {
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
        assignTo = action(function* (id: number) {
          const i = untrack(() => issues.findIndex((t: any) => t.id === id));
          set((d: any) => {
            d[i].assignee = "guest";
          });
          yield ask(`assign:${id}`);
          refresh(issues);
        });
        closeOne = action(function* (id: number) {
          const next = untrack(() => issues.filter((t: any) => t.id !== id));
          set((d: any) => {
            d.length = next.length;
            next.forEach((x: any, i: number) => {
              d[i] = x;
            });
          });
          yield ask(`close:${id}`);
          refresh(issues);
        });
        const [count, setCount] = createSignal(-1);
        if (withCount)
          createEffect(
            () => issues.length,
            (n: number) => {
              setCount(n);
            }
          );
        const b = createLoadingBoundary(
          () =>
            mapArray(
              () => issues,
              (it: any) => {
                const s = { id: "", a: "" };
                createRenderEffect(
                  () => it.id,
                  v => {
                    s.id = v;
                  }
                );
                createRenderEffect(
                  () => it.assignee,
                  v => {
                    s.a = v;
                  }
                );
                return s;
              }
            ),
          () => "loading"
        );
        createRenderEffect(
          () => {
            const v: any = b();
            return typeof v === "function" ? v() : v;
          },
          (v: any) => {
            view = () =>
              typeof v === "string" ? v : v.map((s: any) => `[#${s.id} ${s.a}]`).join("");
          }
        );
        createRenderEffect(count, () => {});
      });
      await tick();
      await land("fetch", [
        { id: 1, assignee: "ann" },
        { id: 3, assignee: "bob" },
        { id: 4, assignee: "dana" }
      ]);
      if (withAssign) {
        assignTo(4);
        await tick();
        await land("assign:4", {});
      }
      closeOne(3);
      await tick();
      await land("close:3", {});
      await land("fetch", [
        { id: 1, assignee: "ann" },
        { id: 4, assignee: withAssign ? "guest" : "dana" }
      ]);
      expect(view()).toBe(`[#1 ann][#4 ${withAssign ? "guest" : "dana"}]`);
    });
