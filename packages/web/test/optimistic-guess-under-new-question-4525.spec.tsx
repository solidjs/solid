/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
/**
 * #4525 (ReactiveScript timing fuzzer, issue tracker apps): a keyed
 * `createOptimisticStore` list whose question reads `filter()`. The filter
 * changes by a plain write, and before the new question answers an action
 * guesses on the list (closes #1), yields and then refreshes it.
 *
 * The guess was written over the open list while the closed question was in
 * flight: the rows it only carried over (#3, #4) are the open answer's, not
 * the guess's. The closed answer landed as a current truth and folded
 * beneath the guess (D-34), so with `Loading on={filter()}` — whose fallback
 * had already taken the filter change (D-14) — the region left its fallback
 * showing `closed` beside the open list minus the guess (F-1) until the
 * action's refresh landed.
 *
 * Ruled: the answer to a question asked before the guess re-bases it like
 * an older truth (D-35, `_laneRebase`): the guess's own edit, #1 removed,
 * over the closed answer, so the screen is `closed: [#2]` (the issue's second
 * acceptable frame), with or without `on`; never a row of the open list
 * beside `closed`.
 */
import { expect, test } from "vitest";
import {
  For,
  Loading,
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

for (const on of [true, false])
  test(`#4525: a guess written while a new question is in flight re-bases over its answer (on=${on})`, async () => {
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
    let closeOne!: (id: number) => any;
    const dispose = render(() => {
      const [filter, sf] = createSignal("open");
      setFilter = sf;
      const [issues, set] = createOptimisticStore<any[]>(() => ask(`issues:${filter()}`), [], {
        key: "id"
      });
      closeOne = action(function* (id: number) {
        set(list => {
          const i = list.findIndex(t => t.id === id);
          if (i >= 0) list.splice(i, 1);
        });
        yield ask(`close:${id}`);
        refresh(issues);
      });
      const body = () => (
        <p>
          {filter()}: <For each={issues}>{(it: any) => <i>[#{it.id}]</i>}</For>
        </p>
      );
      return on ? (
        <Loading on={filter()} fallback={<p>loading</p>}>
          {body()}
        </Loading>
      ) : (
        <Loading fallback={<p>loading</p>}>{body()}</Loading>
      );
    }, container);
    try {
      await tick();
      await settle("issues:open", [{ id: 1 }, { id: 3 }, { id: 4 }]);
      expect(container.textContent).toBe("open: [#1][#3][#4]");
      setFilter("closed");
      await tick();
      closeOne(1);
      await tick();
      expect(container.textContent).toBe(on ? "loading" : "open: [#3][#4]");
      await settle("issues:closed", [{ id: 1 }, { id: 2 }]);
      expect(container.textContent).toBe("closed: [#2]");
      await settle("close:1", {});
      expect(container.textContent).toBe("closed: [#2]");
      await settle("issues:closed", [{ id: 2 }]);
      expect(container.textContent).toBe("closed: [#2]");
      expect(asks).toEqual([]);
      // Never a row of the open list beside `closed` (F-1).
      expect(seen.filter(s => s.startsWith("closed") && /#3|#4/.test(s))).toEqual([]);
    } finally {
      observer.disconnect();
      dispose();
      container.remove();
    }
  });
