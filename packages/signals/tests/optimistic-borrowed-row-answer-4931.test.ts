import { test, expect } from "vitest";
import {
  action,
  createMemo,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  mapArray
} from "../src/index.js";

type Row = { id: number; title: string; done: number; total: number };

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

test.each([
  { writeDone: true, copy: false },
  { writeDone: false, copy: false },
  { writeDone: true, copy: true },
  { writeDone: false, copy: true }
])(
  "#4931 a moved row follows its source only when borrowed (destination re-derives: $writeDone, copied: $copy)",
  async ({ writeDone, copy }) => {
    const pending = new Map<string, (value: Row[] | null) => void>();
    const ask = (key: string) => new Promise<Row[] | null>(resolve => pending.set(key, resolve));
    const land = (key: string, value: Row[] | null = null) => {
      const resolve = pending.get(key);
      if (!resolve) throw new Error(`No pending request: ${key}`);
      pending.delete(key);
      resolve(value);
    };
    const out: Record<string, string> = {};
    const { dispose, addItem, move } = createRoot(dispose => {
      const [doingAnswer, setDoingAnswer] = createSignal<Row[] | null>(() => ask("doing"), {
        loadingValue: null
      });
      const [doneAnswer, setDoneAnswer] = createSignal<Row[] | null>(() => ask("done"), {
        loadingValue: null
      });
      const seen = (answer: () => Row[] | null) =>
        createMemo(() => {
          try {
            return answer();
          } catch {
            return null;
          }
        });
      const makeStore = (answer: () => Row[] | null) => {
        const value = seen(answer);
        return createOptimisticStore<Row[]>(() => (value() ?? []).map(row => ({ ...row })), [], {
          key: "id"
        });
      };
      const [doing, setDoing] = makeStore(doingAnswer);
      const [done, setDone] = makeStore(doneAnswer);
      for (const [name, store] of [
        ["doing", doing],
        ["done", done]
      ] as const) {
        const rows = mapArray(
          () => store,
          row => () => `${row.id}:${row.title}:${row.done}/${row.total}`
        );
        createRenderEffect(
          () =>
            rows()
              .map(row => row())
              .join(","),
          value => {
            out[name] = value;
          }
        );
      }
      return {
        dispose,
        addItem: action(function* () {
          yield ask("addItem");
          const counted = (rows: Row[] | null) =>
            rows?.map(row => (row.id === 3 ? { ...row, total: row.total + 1 } : row)) ?? null;
          setDoingAnswer(counted);
          if (writeDone) setDoneAnswer(counted);
        }),
        move: action(function* () {
          const row = copy ? { ...doing[0] } : doing[0];
          setDoing(rows => rows.filter(item => item.id !== row.id));
          setDone(rows => [...rows, row]);
          yield ask("move");
        })
      };
    });
    const screen = () => `${out.doing}|${out.done}`;
    try {
      land("doing", [{ id: 3, title: "Review PR", done: 2, total: 2 }]);
      land("done", [{ id: 5, title: "Kickoff", done: 3, total: 3 }]);
      await tick();
      addItem();
      await tick();
      move();
      await tick();
      expect(screen()).toBe("|5:Kickoff:3/3,3:Review PR:2/2");
      land("addItem");
      await tick();
      expect(pending.has("move")).toBe(true);
      expect(screen()).toBe(`|5:Kickoff:3/3,3:Review PR:2/${copy ? 2 : 3}`);

      // With no move written to the answers, settling the action restores
      // the source row with its latest count and removes the temporary row.
      land("move");
      await tick();
      expect(screen()).toBe("3:Review PR:2/3|5:Kickoff:3/3");
      expect(pending.size).toBe(0);
    } finally {
      dispose();
    }
  }
);
