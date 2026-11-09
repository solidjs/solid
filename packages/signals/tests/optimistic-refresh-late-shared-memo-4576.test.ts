import { expect, test } from "vitest";
import {
  action,
  createErrorBoundary,
  createMemo,
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

// #4576: a filter change re-asks an optimistic keyed list and a second async
// memo; an action guesses a removal on the list and refreshes it after its
// own ask. The second memo's answer to the new filter lands only after the
// refresh answered. The list's derivation is lane work (it reads the guess):
// its pass over the refreshing list was served the committed rows and dropped
// the refresh it had been marked pending on, but the render effect that
// pending had propagated onto through it kept the mark — the refresh's
// landing walk stopped at the derivation and never reached it. The filter's
// hold then waited on a reader pending on a flight that had already landed,
// and never committed. Once every ask has answered the change commits (F-2),
// because a hold lasts only while an on-screen reader observes a flight it
// waits on (D-11), and what shares the screen settles as one (D-9) — whole on
// the way there (F-1).
for (const shape of ["shared", "split"] as const)
  for (const mode of ["inline", "memo"] as const)
    test(`a late second memo answer after the action's refresh commits the filter change (${shape}, ${mode})`, async () => {
      type Issue = { id: number };
      const asks: { key: string; resolve: (value: any) => void }[] = [];
      const ask = (key: string) => new Promise<any>(resolve => asks.push({ key, resolve }));
      const settle = async (key: string, value: any) => {
        const i = asks.findIndex(a => a.key === key);
        expect(i, `ask ${key}`).toBeGreaterThanOrEqual(0);
        asks.splice(i, 1)[0].resolve(value);
        await tick();
      };
      let f = "";
      let l = "";
      let o = "";
      let recording = false;
      const frames: string[] = [];
      let queued = false;
      const snap = () => {
        if (queued) return;
        queued = true;
        queueMicrotask(() => {
          queued = false;
          if (recording) frames.push(`${f}: ${l} | ${o}`);
        });
      };
      let setFilter!: (value: string) => void;
      let closeOne!: (id: number) => unknown;
      let dispose!: () => void;
      createRoot(d => {
        dispose = d;
        const [filter, setFilterValue] = createSignal("open");
        setFilter = setFilterValue;
        const [issues, set] = createOptimisticStore<Issue[]>(() => ask(`issues:${filter()}`), [], {
          key: "id"
        });
        const other = createMemo(() => ask(`other:${filter()}`));
        closeOne = action(function* (id: number) {
          set(list => {
            const i = list.findIndex(row => row.id === id);
            if (i >= 0) list.splice(i, 1);
          });
          yield ask(`close:${id}`);
          refresh(issues);
        });
        const list = () => issues.map(row => `[#${row.id}]`).join("");
        if (shape === "shared") {
          const both = () => `${filter()}: ${list()}`;
          createRenderEffect(mode === "memo" ? createMemo(both) : both, v => {
            [f, l] = v.split(": ");
            snap();
          });
        } else {
          createRenderEffect(filter, v => {
            f = v;
            snap();
          });
          createRenderEffect(mode === "memo" ? createMemo(list) : list, v => {
            l = v;
            snap();
          });
        }
        createRenderEffect(
          createErrorBoundary(
            () => other(),
            () => "ERR"
          ) as any,
          (v: string) => {
            o = v;
            snap();
          }
        );
      });
      await tick();
      await settle("issues:open", [{ id: 1 }, { id: 3 }, { id: 4 }]);
      await settle("other:open", "O-open");
      expect(`${f}: ${l} | ${o}`).toBe("open: [#1][#3][#4] | O-open");
      recording = true;

      setFilter("closed");
      await tick();
      closeOne(1);
      await tick();
      await settle("issues:closed", [{ id: 1 }, { id: 2 }]);
      await settle("close:1", {});
      await settle("issues:closed", [{ id: 2 }]);
      // The second memo answers the new filter last.
      await settle("other:closed", "O-closed");
      for (let i = 0; i < 3; i++) await tick();

      expect(`${f}: ${l} | ${o}`).toBe("closed: [#2] | O-closed");
      expect(asks.map(a => a.key)).toEqual([]);
      // Whole on the way: the old screen, the guess over it, or the new one.
      for (const frame of frames)
        expect([
          "open: [#1][#3][#4] | O-open",
          "open: [#3][#4] | O-open",
          "closed: [#2] | O-closed"
        ]).toContain(frame);
      expect(frames.at(-1)).toBe("closed: [#2] | O-closed");
      dispose();
    });
