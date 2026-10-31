/**
 * #4536 (residue of #4525): a keyed optimistic store asked by `filter()`.
 * The filter changes by a plain write and its frame is held on the new
 * question; before that question answers, an action guesses on the list
 * (closes #1).
 *
 * The render effects that read the list were waiting on the derive's flight
 * — the frame's hold (`blocked`). Their lane pass was served the guess as
 * standing in for the flight, so they left the hold with the flight still
 * up: the frame committed `closed` beside the open answer minus the guess
 * (F-1), with one binding reading both or a separate list binding. A guess
 * written over a question in flight does not answer it (D-34, #4336): the
 * screen keeps the old input with the guess until the answer lands, then
 * shows `closed: [#2]` (the #4525 re-base, D-35); under `on` the boundary
 * keeps its fallback (D-14).
 */
import { expect, it } from "vitest";
import {
  action,
  createLoadingBoundary,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  refresh
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

for (const split of [false, true])
  for (const on of [false, true])
    it(`#4536: a guess over a question in flight holds its readers' frame (split=${split}, on=${on})`, async () => {
      const asks: { key: string; res: (v: any) => void }[] = [];
      const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
      const settle = async (key: string, v: any) => {
        const i = asks.findIndex(a => a.key === key);
        asks.splice(i, 1)[0].res(v);
        await tick();
      };
      let f = "",
        l = "",
        shown: unknown;
      const screen = () => (shown === "content" ? (split ? `${f}: ${l}` : f) : shown);
      const seen: unknown[] = [];
      let setFilter!: (f: string) => void;
      let closeOne!: (id: number) => any;
      createRoot(() => {
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
        const list = () => issues.map((it: any) => `[#${it.id}]`).join("");
        const out = createLoadingBoundary(
          () => {
            if (split) {
              createRenderEffect(filter, v => void seen.push(screen(), (f = v)));
              createRenderEffect(list, v => void seen.push(screen(), (l = v)));
            } else
              createRenderEffect(
                () => `${filter()}: ${list()}`,
                v => void (f = v)
              );
            return "content";
          },
          () => "loading",
          on ? { on: filter } : undefined
        );
        createRenderEffect(out, v => void (shown = v));
      });
      await tick();
      await settle("issues:open", [{ id: 1 }, { id: 3 }, { id: 4 }]);
      expect(screen()).toBe("open: [#1][#3][#4]");
      setFilter("closed");
      await tick();
      expect(screen()).toBe(on ? "loading" : "open: [#1][#3][#4]");
      closeOne(1);
      await tick();
      expect(screen()).toBe(on ? "loading" : "open: [#3][#4]");
      await settle("issues:closed", [{ id: 1 }, { id: 2 }]);
      expect(screen()).toBe("closed: [#2]");
      await settle("close:1", {});
      await settle("issues:closed", [{ id: 2 }]);
      expect(screen()).toBe("closed: [#2]");
      expect(asks).toEqual([]);
      seen.push(screen());
      expect(seen.filter(s => String(s).startsWith("closed") && /#3|#4/.test(String(s)))).toEqual(
        []
      );
    });
