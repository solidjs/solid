import { describe, expect, it } from "vitest";
import {
  action,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  flush,
  refresh
} from "../src/index.js";

// #4988: unanswered guesses on one row of a keyed optimistic store. A guess
// on another field between two guesses on one field must not drop either.
const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

describe("a guess on a field keeps the earlier guesses on it (#4988)", () => {
  for (const between of [false, true])
    it(between ? "with a guess on another field between" : "with nothing between", async () => {
      let rows!: any[];
      let setRows!: (f: (d: any[]) => void) => void;
      let seen = "";
      const dispose = createRoot(d => {
        [rows, setRows] = createOptimisticStore(
          async () => [{ id: 1, title: "Write spec", done: 0 }],
          [] as any[],
          { key: "id" } as any
        ) as any;
        createRenderEffect(
          () => rows.map(r => `${r.title} ${r.done}`).join(","),
          v => {
            seen = v;
          }
        );
        return d;
      });
      const write = action(function* (f: (d: any) => void) {
        setRows(f);
        yield new Promise(() => {}); // never answers
        refresh(rows);
      });
      await tick();
      write(d => void (d[0].done = d[0].done + 1));
      await tick();
      if (between) {
        write(d => void (d[0].title = "Alpha"));
        await tick();
      }
      write(d => void (d[0].done = d[0].done + 1));
      await tick();
      const title = between ? "Alpha" : "Write spec";
      expect(seen).toBe(`${title} 2`);
      write(d => void (d[0].done = d[0].done - 1));
      await tick();
      expect(seen).toBe(`${title} 1`);
      dispose();
    });
});
