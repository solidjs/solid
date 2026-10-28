/**
 * #4361: a keyed `createProjection(() => memo(), [], { key })` whose fn
 * returns an async store's proxy, then a plain array, then the proxy again
 * must keep updating — the frames reach `#1(-) #3(ann)`. The root was
 * chained to the proxy (§7b), so the diff base of the switch back read the
 * inner store's next frame, not what the projection's nodes were last told:
 * no leaf (nor the container) heard the change, and the held frame waited
 * on a reader that never re-ran.
 */
import { describe, expect, it } from "vitest";
import {
  createMemo,
  createOptimisticStore,
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

const readers = {
  // Leaves: `length` and each index.
  leaves: (p: any) => p.map((i: any) => `#${i.id}(${i.a})`).join(" "),
  // Structure: the container node.
  keys: (p: any) => Object.keys(p).join(",")
};
const expected = {
  leaves: ["#1(-) #3(-)", "#2(eve)", "#1(-) #3(ann)"],
  keys: ["0,1", "0", "0,1"]
};

describe("#4361 projection returning a store proxy, then an array, then the proxy", () => {
  for (const reader of ["leaves", "keys"] as const)
    for (const kind of ["optimisticStore", "store"] as const)
      for (const memo of [true, false])
        it(`${reader} ${kind} memo=${memo}`, async () => {
          const asks: { key: string; res: (v: any) => void }[] = [];
          const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
          const land = async (key: string, v: any) => {
            const i = asks.findIndex(a => a.key === key);
            asks.splice(i, 1)[0].res(v);
            await tick();
          };
          const frames: string[] = [];
          let setFilter!: (f: string) => void;
          createRoot(() => {
            const [filter, sf] = createSignal("open");
            setFilter = sf;
            const make: any = kind === "store" ? createStore : createOptimisticStore;
            const [issues] = make(
              async (d: any[]) => {
                const r = await ask(`f:${filter()}`);
                d.length = 0;
                d.push(...r.map((x: any) => ({ ...x })));
              },
              [],
              { key: "id" }
            );
            const src = memo
              ? createMemo(() =>
                  filter() === "open" ? (issues as any[]).filter(() => true) : issues
                )
              : () => issues;
            const p = createProjection(() => src() as any, [] as any, { key: "id" } as any);
            createRenderEffect(
              () => readers[reader](p),
              v => {
                if (frames.at(-1) !== v) frames.push(v);
              }
            );
          });
          await land("f:open", [
            { id: 1, a: "-" },
            { id: 3, a: "-" }
          ]);
          setFilter("closed");
          flush();
          await tick();
          await land("f:closed", [{ id: 2, a: "eve" }]);
          setFilter("open");
          flush();
          await tick();
          await land("f:open", [
            { id: 1, a: "-" },
            { id: 3, a: "ann" }
          ]);
          expect(frames).toEqual(expected[reader]);
        });
});
