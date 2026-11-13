/**
 * #4824: a per-row "closing" guess in an optimistic store, made while another
 * action's `refresh()` is in flight, after a third guess on the same store
 * was declined. A user effect reports the open count; each row hides at the
 * row site through `<Show>`'s memo chain, and the list's render effect reads
 * the rows through a projection over the refreshed list — pending on that
 * re-ask and held by it.
 *
 * The re-ask asks no new question and holds nothing new (D-34 ¶3), so the
 * new guess shows now beside it (F-11, F-6), and the two readers of the
 * guessed slot agree in every frame (F-1). The render effect is seated in
 * the guess's lane before its pass, as a memo pending on a re-ask is
 * (#4629): its first read, the re-asked rows, is the screen's there. Its
 * pending source is the projection, which waits on the re-asked memo's
 * flight: the re-ask is found through it. The DOM shapes (under `<Loading>`,
 * where the hold also holds the list's render effect, and without one) are
 * in packages/web/test/optimistic-store-two-guesses-4824-4825.spec.tsx.
 */
import { expect, test } from "vitest";
import {
  action,
  createEffect,
  createMemo,
  createOptimisticStore,
  createProjection,
  createRenderEffect,
  createRoot,
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

// `show`: `<Show when={closing[r.id] !== true}>`'s memo chain. `ternary`: the
// compiled `<>{closing[r.id] !== true ? <b/> : undefined}</>` (and Babel's
// lowered `<Show>`), whose row memo re-creates its condition memo every run:
// the new one is born in the guess's lane pass and reads the re-asked rows as
// the one it replaces did.
for (const shape of ["show", "ternary"] as const)
  test(`count and rows agree on a close guessed during another close's refresh (#4824, ${shape})`, async () => {
    const asks: { key: string; res: (v: any) => void; rej: (e: any) => void }[] = [];
    const ask = (key: string) => new Promise<any>((res, rej) => asks.push({ key, res, rej }));
    const take = (key: string) => {
      const i = asks.findIndex(a => a.key === key);
      if (i < 0) throw new Error(`no ask ${key}`);
      return asks.splice(i, 1)[0];
    };
    let close!: (id: number) => unknown;
    let count = -1;
    let rowsShown = "";
    createRoot(() => {
      const server = createMemo(() => ask("list"));
      const [closing, setClosing] = createOptimisticStore<Record<number, boolean>>(d => {
        for (const k of Object.keys(d)) delete d[k as any];
      }, {});
      const rows = createProjection<{ id: number }[]>(() => server() as any, [], { key: "id" });
      const openCount = createMemo(() => rows.filter(i => closing[i.id] !== true).length);
      close = action(function* (id: number) {
        setClosing(d => {
          d[id] = true;
        });
        try {
          yield ask(`close:${id}`);
          refresh(server);
        } catch {}
      });
      createEffect(
        () => openCount(),
        n => {
          count = n;
        }
      );
      // `<For>` of `<Show when={closing[r.id] !== true}>`: the condition value,
      // the condition and the value memo, inserted by one render effect.
      const mapped = mapArray(
        () => rows,
        r => {
          if (shape === "ternary")
            return createMemo(() => (createMemo(() => closing[r.id] !== true)() ? `#${r.id}` : ""));
          const value = createMemo(() => closing[r.id] !== true);
          const condition = createMemo(value, { equals: (a, b) => !a === !b });
          return createMemo(() => (condition() ? `#${r.id}` : ""));
        }
      );
      createRenderEffect(
        () =>
          mapped()
            .map(f => f())
            .filter(Boolean)
            .join(" "),
        v => {
          rowsShown = v;
        }
      );
    });
    const frames: string[] = [];
    const snap = () => {
      const f = `[${count}] ${rowsShown}`.trim();
      frames.push(f);
      // F-1: the count and the rows agree in every frame.
      expect(count, f).toBe(rowsShown ? rowsShown.split(" ").length : 0);
    };
    await tick();
    take("list").res([{ id: 1 }, { id: 3 }, { id: 4 }]);
    await tick();
    snap();
    close(3);
    await tick();
    snap();
    close(1);
    await tick();
    snap();
    take("close:1").res({});
    await tick();
    snap();
    take("close:3").rej(new Error("declined"));
    await tick();
    snap();
    // The guess shows now, beside close #1's re-ask (F-11, D-34 ¶3).
    close(4);
    await tick();
    snap();
    take("close:4").res({});
    await tick();
    snap();
    while (asks.some(a => a.key === "list")) {
      take("list").res([{ id: 3 }]);
      await tick();
    }
    snap();
    expect(frames).toEqual([
      "[3] #1 #3 #4",
      "[2] #1 #4",
      "[1] #4",
      "[1] #4",
      "[1] #4",
      "[0]",
      "[0]",
      "[1] #3"
    ]);
  });
