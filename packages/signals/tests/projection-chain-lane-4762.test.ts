/**
 * #4762: a keyed projection whose fn returns another keyed projection as is
 * (a chained backing, §7b) while a guess is out. The derive had re-run in
 * the guess's lane before the switch, so its own length and row nodes
 * carried lane values; once chained, those covered the inner store's truth:
 * after the new list landed, `length` and the last row still answered the
 * old list while the first rows read through (`[2, undefined, 4]`).
 * A chained target's nodes are subscription points: the inner store answers
 * (F-1, F-11, D-34).
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimistic,
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

describe("#4762: a projection chained to another projection with a guess out", () => {
  for (const copy of [false, true])
    it(copy ? "returning a copy" : "returning the projection itself", async () => {
      const asks: { key: string; res: (v: any) => void }[] = [];
      const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
      const pick = (key: string) =>
        asks.splice(
          asks.findIndex(a => a.key === key),
          1
        )[0];
      let close!: (id: number) => any, setFilter!: (f: string) => void;
      const log: string[] = [];
      createRoot(() => {
        const [filter, sf] = createSignal("open");
        setFilter = sf;
        const server = createMemo(() => ask(`fetch:${filter()}`));
        const issues = createProjection(() => server(), [] as any[], { key: "id" });
        const [closingTruth] = createSignal<number[]>(() => []);
        const [closing, guessClose] = createOptimistic(() => closingTruth());
        const view = createMemo(() =>
          filter() === "open"
            ? issues.filter(r => !closing().includes(r.id))
            : copy
              ? [...issues]
              : issues
        );
        const shown = createProjection(() => view(), [] as any[], { key: "id" });
        close = action(function* (id: number) {
          guessClose(xs => [...xs, id]);
          yield ask(`close:${id}`);
        });
        createRenderEffect(
          () => `${shown.length}:${shown.map(r => r?.id).join(",")}`,
          v => void log.push(v)
        );
      });
      await tick();
      pick("fetch:open").res([
        { id: 1, title: "Login" },
        { id: 3, title: "Crash" },
        { id: 4, title: "Typo" }
      ]);
      await tick();
      close(4); // guess out, never answered
      await tick();
      expect(log.at(-1)).toBe("2:1,3");
      setFilter("closed");
      await tick();
      pick("fetch:closed").res([{ id: 2, title: "Old bug" }]);
      await tick();
      expect(log.at(-1)).toBe("1:2");
      expect(log.some(l => l.includes("undefined") || /,,|,$/.test(l))).toBe(false);
    });
});
