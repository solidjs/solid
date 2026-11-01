import { expect, test } from "vitest";
import {
  action,
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

for (const order of ["question first", "list first"] as const)
  for (const mode of ["inline", "memo"] as const)
    test(`a shared effect keeps the question and its guessed rows consistent (${order}, ${mode})`, async () => {
      type Issue = { id: number };
      const asks: { key: string; resolve: (value: any) => void }[] = [];
      const ask = (key: string) => new Promise<any>(resolve => asks.push({ key, resolve }));
      const settle = async (key: string, value: any) => {
        const i = asks.findIndex(a => a.key === key);
        expect(i).toBeGreaterThanOrEqual(0);
        asks.splice(i, 1)[0].resolve(value);
        await tick();
      };
      const frames: string[] = [];
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
        closeOne = action(function* (id: number) {
          set(list => {
            const i = list.findIndex(row => row.id === id);
            if (i >= 0) list.splice(i, 1);
          });
          yield ask(`close:${id}`);
          refresh(issues);
        });
        const screen = () => {
          let question: string;
          let rows: string;
          if (order === "question first") {
            question = filter();
            rows = issues.map(row => `[#${row.id}]`).join("");
          } else {
            rows = issues.map(row => `[#${row.id}]`).join("");
            question = filter();
          }
          return `${question}: ${rows}`;
        };
        createRenderEffect(
          mode === "memo" ? createMemo(screen) : screen,
          value => void frames.push(value)
        );
      });
      try {
        await tick();
        await settle("issues:open", [{ id: 1 }, { id: 3 }, { id: 4 }]);
        expect(frames.at(-1)).toBe("open: [#1][#3][#4]");
        setFilter("closed");
        await tick();
        expect(frames.at(-1)).toBe("open: [#1][#3][#4]");
        closeOne(1);
        await tick();
        // The guess can show over the old answer or wait with the pending read.
        expect(["open: [#3][#4]", "open: [#1][#3][#4]"]).toContain(frames.at(-1));
        await settle("issues:closed", [{ id: 1 }, { id: 2 }]);
        expect(frames.at(-1)).toBe("closed: [#2]");
        await settle("close:1", {});
        await settle("issues:closed", [{ id: 2 }]);
        expect(frames.at(-1)).toBe("closed: [#2]");
        // Never the new question beside the old answer's rows, nor the old
        // question beside the new answer's (F-1).
        expect(
          frames.filter(
            frame =>
              (frame.startsWith("closed") && /#3|#4/.test(frame)) ||
              (frame.startsWith("open") && /#2/.test(frame))
          )
        ).toEqual([]);
      } finally {
        dispose();
      }
    });
