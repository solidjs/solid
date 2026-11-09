/**
 * #4489: a keyed derived optimistic store's re-ask (a `filter` change, held
 * with a pending removal guess's action — D-34) rejected. The view held, but
 * an untracked read (a click handler) of a row the screen still showed threw
 * the new error: a derived store's derive published its held rejection at
 * once (D-41's open deviation for derived stores).
 *
 * Ruled (D-41, F-1 "what it does not say", D-29, D-34): an error that lands
 * on a held node is staged with the frame. Until the reveal the screen keeps
 * what it showed and an untracked read reads the screen — here the guess
 * over the committed rows (F-11); the effect's error arm does not run. At
 * the reveal the error shows, to the screen and to reads alike.
 */
import { expect, it } from "vitest";
import {
  action,
  createEffect,
  createErrorBoundary,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  refresh,
  untrack
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

it("#4489: while an action holds the view, a handler reads the row the screen shows (D-41)", async () => {
  const asks: { key: string; res: (v: any) => void; rej: (e: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>((res, rej) => asks.push({ key, res, rej }));
  const settle = async (key: string, f: (a: (typeof asks)[number]) => void) => {
    for (const a of asks.filter(a => a.key === key)) {
      asks.splice(asks.indexOf(a), 1);
      f(a);
    }
    await tick();
  };
  const frames: string[] = [];
  const screen: string[] = [];
  let setFilter!: (f: string) => void;
  let issues!: any[];
  let close!: (id: number) => any;
  const dispose = createRoot(d => {
    const [filter, sf] = createSignal("open");
    setFilter = sf;
    const [store, setStore] = createOptimisticStore(
      async () => await ask(`f:${filter()}`),
      [] as any[],
      { key: "id" }
    );
    issues = store;
    close = action(function* (id: number) {
      setStore((d: any[]) => {
        const i = d.findIndex(x => x.id === id);
        if (i >= 0) d.splice(i, 1);
      });
      yield ask(`close:${id}`);
      refresh(store);
    });
    const rows = () => (store as any[]).map(i => `#${i.id}`).join(" ");
    createEffect(rows, {
      effect: (v: string) => void frames.push(v),
      error: (e: any) => void frames.push(`ERR ${e?.message ?? e}`)
    });
    // The screen: an `<Errored>` over the rows.
    createRenderEffect(
      createErrorBoundary(rows, (e: () => any) => `ERR ${e()?.message}`),
      v => void screen.push(v)
    );
    return d;
  });
  try {
    await tick();
    await settle("f:open", a => a.res([{ id: 1 }, { id: 3 }, { id: 4 }]));
    close(3);
    await tick();
    expect(frames).toEqual(["#1 #3 #4", "#1 #4"]);
    setFilter("closed");
    flush();
    await tick();
    await settle("f:closed", a => a.rej(new Error("declined")));
    // Held: the screen keeps the guess, and so does a handler's read.
    expect(frames).toEqual(["#1 #3 #4", "#1 #4"]);
    expect(screen.at(-1)).toBe("#1 #4");
    expect(untrack(() => issues[1].id)).toBe(4);
    expect(untrack(() => issues.length)).toBe(2);
    // The close is accepted; its refresh re-asks the new question, which
    // fails too. The action ends: the error reveals to the screen and reads.
    await settle("close:3", a => a.res({}));
    expect(frames.at(-1)).toBe("#1 #4");
    await settle("f:closed", a => a.rej(new Error("declined again")));
    expect(frames.at(-1)).toBe("ERR declined again");
    expect(screen.at(-1)).toBe("ERR declined again");
    expect(() => untrack(() => issues[1])).toThrow("declined again");
  } finally {
    dispose();
    flush();
  }
});
