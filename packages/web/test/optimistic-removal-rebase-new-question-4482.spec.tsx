/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
/**
 * #4482: a keyed derived optimistic store over `list(filter)`. A per-key
 * guess (assign #3) and a removal guess (close #3) are out; the filter
 * switch holds behind them (D-34). When the assign is accepted, its refresh
 * answers the new question — an older question than the close guess's, so
 * the close guess is re-based over it (D-35). The re-base kept the rows the
 * guess had only carried over from the open list (#1, #4) beside the closed
 * answer (#2): rows of two questions at once (F-1).
 *
 * Ruled: the re-base composes the guess's own edit — the removal of #3 —
 * over the new truth, so the screen is `[#2 eve]` (the issue's second
 * acceptable frame); never the open list's rows beside the closed one's.
 */
import { expect, test } from "vitest";
import {
  For,
  action,
  createOptimisticStore,
  createSignal,
  createMemo,
  flush,
  refresh,
  untrack
} from "solid-js";
import { render } from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

test("#4482: a removal guess re-based over a new question's answer shows only that answer's rows", async () => {
  const asks: { key: string; res: (v: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
  const settle = async (key: string, v: any) => {
    const i = asks.findIndex(a => a.key === key);
    asks.splice(i, 1)[0].res(v);
    await tick();
  };
  const container = document.body.appendChild(document.createElement("div"));
  // Every DOM state the screen passes through.
  const seen: string[] = [];
  const observer = new MutationObserver(() => seen.push(container.textContent!));
  observer.observe(container, { childList: true, subtree: true, characterData: true });
  let setFilter!: (f: string) => void;
  let assignTo!: (id: number, who: string) => any;
  let closeOne!: (id: number) => any;
  const dispose = render(() => {
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
    return (
      <For each={issues}>
        {(it: any) => (
          <i>
            [#{it.id} {it.assignee}]
          </i>
        )}
      </For>
    );
  }, container);
  try {
    await tick();
    await settle("issues:open", [
      { id: 1, assignee: null },
      { id: 3, assignee: null },
      { id: 4, assignee: "dana" }
    ]);
    expect(container.textContent).toBe("[#1 ][#3 ][#4 dana]");
    assignTo(3, "guest");
    await tick();
    expect(container.textContent).toBe("[#1 ][#3 guest][#4 dana]");
    closeOne(3);
    await tick();
    expect(container.textContent).toBe("[#1 ][#4 dana]");
    setFilter("closed");
    await tick();
    expect(container.textContent).toBe("[#1 ][#4 dana]");
    await settle("issues:closed", [{ id: 2, assignee: "eve" }]);
    expect(container.textContent).toBe("[#1 ][#4 dana]");
    const from = seen.length;
    await settle("assign:3", {});
    expect(container.textContent).toBe("[#2 eve]");
    await settle("close:3", {});
    expect(container.textContent).toBe("[#2 eve]");
    // Never a row of the open list beside the closed answer (F-1).
    expect(seen.slice(from).filter(s => s.includes("#2") && /#1 |#4 /.test(s))).toEqual([]);
  } finally {
    observer.disconnect();
    dispose();
    container.remove();
  }
});
