/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4379 — an action guesses a row of a keyed optimistic store, yields, then
// `refresh()`es it. A `filter` change made meanwhile (closed, then back to
// open) holds with the action (D-34). When the action ends, the held change
// commits while the action's own refresh is still in flight; a refresh is
// quiet (F-9), so `<Loading on={filter()}>` keeps the list up, as it does
// without `on` and for the closed-only change. The signals-side pin is
// `packages/signals/tests/loading-on-held-filter-refresh-4379.test.ts`.
import { expect, test } from "vitest";
import {
  Loading,
  Errored,
  For,
  action,
  createOptimisticStore,
  createSignal,
  flush,
  refresh
} from "solid-js";
import { render } from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};
type Issue = { id: number; assignee: string | null };

for (const useOn of [true, false])
  for (const toggle of [true, false])
    test(`on=${useOn} toggle=${toggle}: the action's refresh never shows the fallback`, async () => {
      const asks: { key: string; res: (v: any) => void }[] = [];
      const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
      const land = async (key: string, v: any) => {
        const i = asks.findIndex(a => a.key === key);
        if (i < 0) throw new Error(`not asked ${key}: ${asks.map(a => a.key)}`);
        asks.splice(i, 1)[0].res(v);
        await tick();
      };
      const container = document.body.appendChild(document.createElement("div"));
      const frames: string[] = [];
      const snap = () => frames.push(container.textContent!);
      let setFilter!: (f: string) => void;
      let assign!: (id: number, who: string) => void;
      const dispose = render(() => {
        const [filter, sf] = createSignal("open");
        setFilter = sf;
        const [issues, setIssues] = createOptimisticStore<Issue[]>(
          async (d: Issue[]) => {
            const r: Issue[] = await ask(`fetchIssues:${filter()}`);
            d.length = r.length;
            r.forEach((x, i) => ((d as any)[i] = x));
          },
          [],
          { key: "id" } as any
        );
        assign = action(function* (id: number, who: string) {
          try {
            const i = issues.findIndex(t => t.id === id);
            setIssues((d: Issue[]) => {
              d[i].assignee = who;
            });
            yield ask(`assign:${id},${who}`);
            refresh(issues);
          } catch {}
        });
        return (
          <Errored fallback={(e: any) => <p>err {String(e()?.message ?? e())}</p>}>
            <Loading on={useOn ? filter() : undefined} fallback={<p>loading {filter()}</p>}>
              <For each={issues}>
                {(it: any) => (
                  <i>
                    #{it.id}({it.assignee ?? "-"})
                  </i>
                )}
              </For>
            </Loading>
          </Errored>
        );
      }, container);
      await tick();
      await land("fetchIssues:open", [
        { id: 1, assignee: null },
        { id: 3, assignee: null }
      ]);
      snap();
      assign(3, "ann");
      flush();
      await tick();
      snap();
      setFilter("closed");
      flush();
      await tick();
      if (toggle) {
        setFilter("open");
        flush();
        await tick();
      }
      snap();
      await land("fetchIssues:closed", []);
      if (toggle)
        await land("fetchIssues:open", [
          { id: 1, assignee: null },
          { id: 3, assignee: null }
        ]);
      snap();
      await land("assign:3,ann", undefined);
      snap();
      await land(
        `fetchIssues:${toggle ? "open" : "closed"}`,
        toggle
          ? [
              { id: 1, assignee: null },
              { id: 3, assignee: "ann" }
            ]
          : []
      );
      snap();
      dispose();
      container.remove();
      const held = "#1(-)#3(ann)";
      expect(frames).toEqual(["#1(-)#3(-)", held, held, held, held, toggle ? "#1(-)#3(ann)" : ""]);
    });
