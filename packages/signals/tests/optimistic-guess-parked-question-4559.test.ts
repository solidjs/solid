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

// #4559: #4536's setup plus a second async read of the question that answers
// after the list does. The question's transaction stays parked on that read,
// so the frame must not show the old question beside the new answer's rows
// (F-1, D-34 ¶3).
for (const order of ["question first", "list first"] as const)
  for (const mode of ["inline", "memo", "split"] as const)
    test(`a guess re-based while the question's transaction is parked keeps the frame whole (${order}, ${mode})`, async () => {
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
      const last = () => frames.filter(f => !f.startsWith("other")).at(-1);
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
        const other = createMemo(async () => {
          const f = filter();
          await ask(`other:${f}`);
          return f.length;
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
        if (mode === "split") {
          // One binding per read, as a template's holes are: the screen is
          // what both show after each flush.
          let question = "",
            rows = "";
          const show = () => frames.push(`${question}: ${rows}`);
          const bindQuestion = () =>
            createRenderEffect(filter, v => {
              question = v;
              queueMicrotask(show);
            });
          const bindRows = () =>
            createRenderEffect(
              () => issues.map(row => `[#${row.id}]`).join(""),
              v => {
                rows = v;
                queueMicrotask(show);
              }
            );
          if (order === "question first") {
            bindQuestion();
            bindRows();
          } else {
            bindRows();
            bindQuestion();
          }
        } else
          createRenderEffect(
            mode === "memo" ? createMemo(screen) : screen,
            value => void frames.push(value)
          );
        createRenderEffect(other, value => void frames.push(`other ${value}`));
      });
      try {
        await tick();
        await settle("other:open", {});
        await settle("issues:open", [{ id: 1 }, { id: 3 }, { id: 4 }]);
        expect(last()).toBe("open: [#1][#3][#4]");
        setFilter("closed");
        await tick();
        closeOne(1);
        await tick();
        expect(["open: [#3][#4]", "open: [#1][#3][#4]"]).toContain(last());
        await settle("issues:closed", [{ id: 1 }, { id: 2 }]);
        // The transaction is still parked on `other`: the question and its
        // answer have not landed, so the old frame (guess or not) stands.
        expect(["open: [#3][#4]", "open: [#1][#3][#4]"]).toContain(last());
        await settle("other:closed", {});
        expect(last()).toBe("closed: [#2]");
        await settle("close:1", {});
        await settle("issues:closed", [{ id: 2 }]);
        expect(last()).toBe("closed: [#2]");
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
