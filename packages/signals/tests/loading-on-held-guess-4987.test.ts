import { expect, it } from "vitest";
import {
  action,
  createLoadingBoundary,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  mapArray,
  refresh
} from "../src/index.js";

// #4987: an `on` re-arm the frame holds has entered its fallback, but the
// screen keeps the old content until the hold lifts (D-17). That content is
// the display, so a guess written over it reaches the rows inside the
// boundary as it reaches a reader outside (F-1: the screen is whole).
const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

for (const withOn of [false, true])
  it(`a guess on the previous answer a re-armed boundary still shows reaches the content (on: ${withOn}) (#4987)`, async () => {
    const asks: { key: string; res: (v: any) => void }[] = [];
    const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
    const take = (key: string) =>
      asks.splice(
        asks.findIndex(a => a.key === key),
        1
      )[0];
    let inside = "";
    let outside = -1;
    let shown: any;
    const [selected, setSelected] = createSignal(2);
    let list: any, toggle: any;
    createRoot(() => {
      const [l, setList] = createOptimisticStore(
        async () => await ask(`checklist:${selected()}`),
        [] as any[],
        { key: "id" } as any
      );
      list = l;
      toggle = action(function* (j: number, next: boolean) {
        setList((d: any) => {
          d[j].done = next;
        });
        yield ask(`toggle:${j}`);
        refresh(list);
      });
      createRenderEffect(
        () => list.filter((x: any) => x.done).length,
        v => {
          outside = v;
        }
      );
      const b = createLoadingBoundary(
        () => {
          const rows: string[] = [];
          const mapped = mapArray(
            () => list,
            (it: any, i: any) => {
              createRenderEffect(
                () => (it.done ? "x" : "-"),
                v => {
                  rows[i()] = v;
                  inside = rows.join("");
                }
              );
              return null;
            }
          );
          createRenderEffect(mapped, () => {});
          return "content";
        },
        () => "fallback",
        withOn ? { on: () => selected() } : undefined
      );
      createRenderEffect(b, v => {
        shown = v;
      });
    });
    flush();
    take("checklist:2").res([
      { id: 21, done: true },
      { id: 22, done: false },
      { id: 23, done: false }
    ]);
    await tick();
    expect([outside, inside]).toEqual([1, "x--"]);
    toggle(2, true);
    await tick();
    setSelected(4);
    await tick();
    expect([outside, inside, shown]).toEqual([2, "x-x", "content"]);
    toggle(0, false);
    await tick();
    expect([outside, inside, shown]).toEqual([1, "--x", "content"]);
  });
