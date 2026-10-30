/**
 * #4379 (ReactiveScript tracker eval): a keyed `createOptimisticStore` list
 * whose question reads `filter()`, under `<Loading on={filter()}>`, with a
 * render effect per row (as `<For>` binds each row's text). An action
 * guesses a row, yields, then `refresh()`es the list. A plain `filter`
 * write while the action is out is held with it (D-34, #4336), so the
 * boundary's swap is staged into that hold (D-15) and the screen keeps the
 * old list.
 *
 * Once the new question's answer lands, held with the same action, the
 * content is ready inside the hold the fallback was staged into: the seam
 * folds the fallback back (D-16, U-9), as it does when the readers are
 * already landed at the re-arm. When the action ends, its own `refresh()`
 * is quiet (F-9): it must not pull the fallback on screen. On `next` the
 * fold only ran in the re-arm's own flush (`_armed`); the rows' effects
 * survive the answer (same keys) and land a flush later, so the staged
 * fallback committed with the action, and the refresh's pending, caught by
 * a boundary still collecting, showed it until the refresh answered.
 */
import { describe, expect, it } from "vitest";
import {
  action,
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

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};
type Issue = { id: number; assignee: string | null };
const OPEN: Issue[] = [
  { id: 1, assignee: null },
  { id: 3, assignee: null }
];
const ASSIGNED: Issue[] = [
  { id: 1, assignee: null },
  { id: 3, assignee: "ann" }
];

function page(on: boolean) {
  const asks: { key: string; res: (v: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
  const land = async (key: string, v: any) => {
    const i = asks.findIndex(a => a.key === key);
    if (i < 0) throw new Error(`not asked: ${key}; asked: ${asks.map(a => a.key)}`);
    // A fresh answer each time, as a fetch gives.
    asks.splice(i, 1)[0].res(structuredClone(v));
    await tick();
  };
  const frames: string[] = [];
  let setFilter!: (f: string) => void;
  let assign!: (id: number, who: string) => void;
  createRoot(() => {
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
      const i = issues.findIndex(t => t.id === id);
      setIssues((d: Issue[]) => {
        d[i].assignee = who;
      });
      yield ask(`assign:${id},${who}`);
      refresh(issues);
    }) as any;
    const list = untrack(() =>
      createLoadingBoundary(
        () => {
          const m = mapArray(
            () => issues,
            (i: any) => {
              // Frame readers per row, under the boundary (`<For>`'s text
              // holes). The `id` read is not served by the guess: over the
              // new question it is an ordinary pending read (#4336
              // `stands`), recorded by the boundary, and it lands held.
              createRenderEffect(
                () => i.id,
                () => {}
              );
              createRenderEffect(
                () => i.assignee,
                () => {}
              );
              return () => `#${i.id}(${i.assignee ?? "-"})`;
            }
          );
          return () =>
            m()
              .map(f => f())
              .join(" ");
        },
        () => "loading",
        on ? { on: () => filter() } : undefined
      )
    );
    createRenderEffect(
      () => {
        const v: any = list();
        return typeof v === "function" ? v() : v;
      },
      v => {
        if (frames.at(-1) !== v) frames.push(v);
      }
    );
  });
  return {
    land,
    asks,
    frames,
    screen: () => frames.at(-1),
    setFilter: async (f: string) => {
      setFilter(f);
      flush();
      await tick();
    },
    assign: async (id: number, who: string) => {
      assign(id, who);
      flush();
      await tick();
    }
  };
}

const MOUNT = ["loading", "#1(-) #3(-)"];

describe("#4379 a held `on` change whose content lands inside the hold", () => {
  for (const on of [true, false]) {
    it(`toggled back while held: the action's refresh shows no fallback (on=${on})`, async () => {
      const p = page(on);
      await tick();
      await p.land("fetchIssues:open", OPEN);
      await p.assign(3, "ann");
      await p.setFilter("closed");
      await p.setFilter("open");
      expect(p.screen()).toBe("#1(-) #3(ann)");
      await p.land("fetchIssues:closed", []);
      await p.land("fetchIssues:open", OPEN);
      expect(p.screen()).toBe("#1(-) #3(ann)");
      await p.land("assign:3,ann", undefined);
      expect(p.screen()).toBe("#1(-) #3(ann)");
      await p.land("fetchIssues:open", ASSIGNED);
      expect(p.frames).toEqual([...MOUNT, "#1(-) #3(ann)"]);
      expect(p.asks).toEqual([]);
    });

    // The same seam without the toggle: the new question's answer keeps the
    // rows (same keys), so their effects survive and land held.
    it(`a new question whose answer keeps the rows: no fallback (on=${on})`, async () => {
      const p = page(on);
      await tick();
      await p.land("fetchIssues:open", OPEN);
      await p.assign(3, "ann");
      await p.setFilter("closed");
      expect(p.screen()).toBe("#1(-) #3(ann)");
      await p.land("fetchIssues:closed", OPEN);
      expect(p.screen()).toBe("#1(-) #3(ann)");
      await p.land("assign:3,ann", undefined);
      expect(p.screen()).toBe("#1(-) #3(ann)");
      await p.land("fetchIssues:closed", ASSIGNED);
      expect(p.frames).toEqual([...MOUNT, "#1(-) #3(ann)"]);
      expect(p.asks).toEqual([]);
    });
  }

  // Control (passes on `next`): the answer drops the rows, so their effects
  // die and the boundary's own pass finds nothing left to wait on.
  it("control: an answer that drops the rows holds the old list to the refresh", async () => {
    const p = page(true);
    await tick();
    await p.land("fetchIssues:open", OPEN);
    await p.assign(3, "ann");
    await p.setFilter("closed");
    await p.land("fetchIssues:closed", []);
    await p.land("assign:3,ann", undefined);
    expect(p.screen()).toBe("#1(-) #3(ann)");
    await p.land("fetchIssues:closed", []);
    expect(p.frames).toEqual([...MOUNT, "#1(-) #3(ann)", ""]);
  });

  // Control: nothing holds the change — the fallback shows with it (D-15).
  it("control: no hold — the fallback shows with the change and clears at its answer", async () => {
    const p = page(true);
    await tick();
    await p.land("fetchIssues:open", OPEN);
    await p.setFilter("closed");
    expect(p.screen()).toBe("loading");
    await p.land("fetchIssues:closed", OPEN);
    expect(p.frames).toEqual([...MOUNT, "loading", "#1(-) #3(-)"]);
  });
});
