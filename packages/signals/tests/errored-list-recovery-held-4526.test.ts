/**
 * #4526: a keyed optimistic list under an error boundary. A new question
 * (`filter`) rejects and the boundary shows the error; an action then
 * guesses on the store (a removal), which re-asks. The re-ask's answer lands
 * held with the action (the guess's hold, D-34): the list's re-map is a
 * parked pass, and it disposes the old rows' effects — readers the boundary
 * caught the error on. The boundary revealed anyway, at the seam: the
 * content it showed was the list from before the error, the old question's
 * rows (`[#1][#3][#4]` under "closed").
 *
 * Ruled (D-41 recovery, D-39, F-1): a shown error stays the display until
 * the frame that carries its replacement reveals, through a held recovery.
 * The error holds until the action's hold commits, and the reveal shows that
 * frame's rows.
 */
import { expect, it } from "vitest";
import {
  action,
  createErrorBoundary,
  createMemo,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  mapArray,
  refresh
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

it("#4526: an errored list's held recovery keeps the error until its frame reveals (D-41)", async () => {
  const asks: { key: string; res: (v: any) => void; rej: (e: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>((res, rej) => asks.push({ key, res, rej }));
  const settle = async (key: string, f: (a: (typeof asks)[number]) => void) => {
    const i = asks.findIndex(a => a.key === key);
    f(asks.splice(i, 1)[0]);
    await tick();
  };
  // A DOM stand-in: the content is a list of cells each row's render effect
  // writes, attached to the screen when the boundary shows it.
  type Cell = { text: string };
  let shown: string | { cells: Cell[] } = "";
  const screen = () => (typeof shown === "string" ? shown : shown.cells.map(c => c.text).join(""));
  let setFilter!: (f: string) => void;
  let close!: (id: number) => any;
  const dispose = createRoot(d => {
    const [filter, sf] = createSignal("open");
    setFilter = sf;
    const [store, setStore] = createOptimisticStore(
      () => ask(`issues:${filter()}`),
      [] as { id: number }[],
      { key: "id" }
    );
    close = action(function* (id: number) {
      setStore(list => {
        const i = list.findIndex(t => t.id === id);
        if (i >= 0) list.splice(i, 1);
      });
      yield ask(`close:${id}`);
      refresh(store);
    });
    const view = createErrorBoundary(
      () => {
        const rows = mapArray(
          () => store,
          (it: { id: number }) => {
            const cell: Cell = { text: "" };
            createRenderEffect(
              () => `[#${it.id}]`,
              v => void (cell.text = v)
            );
            return cell;
          }
        );
        const content = { cells: [] as Cell[] };
        createRenderEffect(rows, cells => void (content.cells = cells));
        return content;
      },
      e => `error ${(e() as Error).message}`
    );
    createRenderEffect(view, v => void (shown = v));
    return d;
  });
  await tick();
  await settle("issues:open", a => a.res([{ id: 1 }, { id: 3 }, { id: 4 }]));
  expect(screen()).toBe("[#1][#3][#4]");
  setFilter("closed");
  await tick();
  await settle("issues:closed", a => a.rej(new Error("declined")));
  expect(screen()).toBe("error declined");
  close(1);
  await tick();
  expect(screen()).toBe("error declined");
  // The re-ask's answer lands held with the action: the error stays.
  await settle("issues:closed", a => a.res([{ id: 2 }]));
  expect(screen()).toBe("error declined");
  await settle("close:1", a => a.res({}));
  expect(screen()).toBe("error declined");
  // The action's refresh lands: its frame reveals.
  await settle("issues:closed", a => a.res([{ id: 1 }, { id: 2 }]));
  expect(screen()).toBe("[#1][#2]");
  dispose();
});

it("#4526: a recovery's reader clears walk the boundary's readers once, not once per clear", () => {
  // N render effects read one memo under the boundary; the memo errors and
  // recovers. Each effect's clear asks whether it was the last reader: that
  // must not re-walk the remaining readers (`prune`) every time — N²/2 steps.
  // Counted as Map iteration steps during the recovery flush (deterministic).
  const N = 1000;
  const [bad, setBad] = createSignal(false);
  let shown: unknown;
  const dispose = createRoot(d => {
    const m = createMemo(() => {
      if (bad()) throw new Error("x");
      return 1;
    });
    const view = createErrorBoundary(
      () => {
        for (let i = 0; i < N; i++) createRenderEffect(m, () => {});
        return "ok";
      },
      () => "err"
    );
    createRenderEffect(view, v => void (shown = v));
    return d;
  });
  flush();
  setBad(true);
  flush();
  expect(shown).toBe("err");
  const proto = Map.prototype as any;
  const iterate = proto[Symbol.iterator];
  let steps = 0;
  proto[Symbol.iterator] = function (this: Map<unknown, unknown>) {
    const it = iterate.call(this);
    return {
      next: () => (steps++, it.next()),
      [Symbol.iterator]() {
        return this;
      }
    };
  };
  try {
    setBad(false);
    flush();
  } finally {
    proto[Symbol.iterator] = iterate;
  }
  expect(shown).toBe("ok");
  expect(steps).toBeLessThan(4 * N);
  dispose();
});
