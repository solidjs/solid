/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { test, expect } from "vitest";
import { For, action, createMemo, createOptimisticStore, createSignal, flush } from "solid-js";
import { render } from "../src/index.js";

type Row = { id: number; title: string; done: number; total: number };

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

test.each([true, false])(
  "#4931 a borrowed row's DOM follows its source answer (destination re-derives: %s)",
  async writeDone => {
    const pending = new Map<string, (value: Row[] | null) => void>();
    const ask = (key: string) => new Promise<Row[] | null>(resolve => pending.set(key, resolve));
    const land = (key: string, value: Row[] | null = null) => {
      const resolve = pending.get(key);
      if (!resolve) throw new Error(`No pending request: ${key}`);
      pending.delete(key);
      resolve(value);
    };
    const container = document.body.appendChild(document.createElement("div"));
    let addItem!: () => Promise<void>;
    let move!: () => Promise<void>;
    const dispose = render(() => {
      const [doingAnswer, setDoingAnswer] = createSignal<Row[] | null>(() => ask("doing"), {
        loadingValue: null
      });
      const [doneAnswer, setDoneAnswer] = createSignal<Row[] | null>(() => ask("done"), {
        loadingValue: null
      });
      const makeStore = (answer: () => Row[] | null) => {
        const seen = createMemo(() => {
          try {
            return answer();
          } catch {
            return null;
          }
        });
        return createOptimisticStore<Row[]>(() => (seen() ?? []).map(row => ({ ...row })), [], {
          key: "id"
        });
      };
      const [doing, setDoing] = makeStore(doingAnswer);
      const [done, setDone] = makeStore(doneAnswer);
      addItem = action(function* () {
        yield ask("addItem");
        const counted = (rows: Row[] | null) =>
          rows?.map(row => (row.id === 3 ? { ...row, total: row.total + 1 } : row)) ?? null;
        setDoingAnswer(counted);
        if (writeDone) setDoneAnswer(counted);
      });
      move = action(function* () {
        const row = doing[0];
        setDoing(rows => rows.filter(item => item.id !== row.id));
        setDone(rows => [...rows, row]);
        yield ask("move");
      });
      const column = (rows: Row[]) => (
        <ul>
          <For each={rows}>
            {row => <li>{`#${row.id} ${row.title} ${row.done}/${row.total}`}</li>}
          </For>
        </ul>
      );
      return (
        <div>
          {column(doing)}|{column(done)}
        </div>
      );
    }, container);
    try {
      land("doing", [{ id: 3, title: "Review PR", done: 2, total: 2 }]);
      land("done", [{ id: 5, title: "Kickoff", done: 3, total: 3 }]);
      await tick();
      addItem();
      await tick();
      move();
      await tick();
      expect(container.textContent).toBe("|#5 Kickoff 3/3#3 Review PR 2/2");
      const movedElement = container.querySelectorAll("li")[1];

      land("addItem");
      await tick();
      expect(pending.has("move")).toBe(true);
      expect(container.textContent).toBe("|#5 Kickoff 3/3#3 Review PR 2/3");
      expect(container.querySelectorAll("li")[1]).toBe(movedElement);

      land("move");
      await tick();
      expect(container.textContent).toBe("#3 Review PR 2/3|#5 Kickoff 3/3");
      expect(pending.size).toBe(0);
    } finally {
      dispose();
      container.remove();
    }
  }
);
