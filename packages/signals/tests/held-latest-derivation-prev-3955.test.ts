import { describe, expect, it } from "vitest";
import {
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest
} from "../src/index.js";

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

async function tick(n = 4) {
  for (let i = 0; i < n; i++) await Promise.resolve();
  flush();
}

describe("a derivation reading a held signal through latest()/isPending() keeps its prev", () => {
  for (const read of ["latest", "isPending"] as const) {
    it(`${read}(): an equal pass under the hold does not turn the next pass's prev into NOT_PENDING`, async () => {
      const prevs: unknown[] = [];
      const gates = { current: deferred() };
      let setFilter!: (v: string) => void;
      let dispose!: () => void;
      createRoot(d => {
        dispose = d;
        const [filter, set] = createSignal("a");
        setFilter = set;
        const data = createMemo(async () => {
          const f = filter();
          await gates.current.promise;
          return f;
        });
        createRenderEffect(data, () => {});
        const [names] = createSignal<string[]>(
          (prev = []) => {
            read === "latest" ? latest(filter) : isPending(filter);
            prevs.push(prev);
            return [...prev];
          },
          { equals: (a, b) => a.length === b.length }
        );
        createRenderEffect(names, () => {});
      });
      flush();
      const mountGate = gates.current;
      gates.current = deferred();
      mountGate.resolve();
      await tick();
      expect(prevs).toEqual([[]]);

      setFilter("b");
      flush();
      setFilter("c");
      expect(() => flush()).not.toThrow();
      await tick();
      expect(prevs).toEqual([[], [], []]);

      gates.current.resolve();
      await tick();
      dispose();
    });
  }
});
