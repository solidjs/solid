import { describe, expect, it } from "vitest";
import {
  action,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  flush
} from "../src/index.js";

// #4812 (D-33, #4788 follow-up): a guess B computes from what A's live
// guess put in the store — a value under a child A replaced, a key A added
// (presence or enumeration) — derives from A's guess, so A's guess stays
// while B's is out, as for a direct primitive read.
const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};
type Shape = "primitive" | "child" | "in" | "keys";
function app(shape: Shape) {
  const ends: Record<string, () => void> = {};
  const wait = (k: string) => new Promise<void>(r => (ends[k] = r));
  const seen: string[] = [];
  let saveA!: () => any, saveB!: () => any;
  createRoot(() => {
    const [s, set] = createOptimisticStore<any>({ a: 0, child: { x: 0 }, b: 0 });
    createRenderEffect(
      () =>
        shape === "primitive"
          ? `a=${s.a} b=${s.b}`
          : shape === "child"
            ? `x=${s.child.x} b=${s.b}`
            : `extra=${"extra" in s} keys=${Object.keys(s).includes("extra")} b=${s.b}`,
      v => void seen.push(v)
    );
    saveA = action(function* () {
      set((d: any) => {
        if (shape === "primitive") d.a = 9;
        else if (shape === "child") d.child = { x: 9 };
        else d.extra = 1;
      });
      yield wait("A");
    });
    saveB = action(function* () {
      set((d: any) => {
        if (shape === "primitive") d.b = d.a;
        else if (shape === "child") d.b = d.child.x;
        else if (shape === "in") d.b = "extra" in d ? 2 : 0;
        else d.b = Object.keys(d).includes("extra") ? 2 : 0;
      });
      yield wait("B");
    });
  });
  return { seen, ends, saveA: () => saveA(), saveB: () => saveB() };
}
const afterA: Record<Shape, string> = {
  primitive: "a=9 b=9",
  child: "x=9 b=9",
  in: "extra=true keys=true b=2",
  keys: "extra=true keys=true b=2"
};
const end: Record<Shape, string> = {
  primitive: "a=0 b=0",
  child: "x=0 b=0",
  in: "extra=false keys=false b=0",
  keys: "extra=false keys=false b=0"
};
describe("a guess computed from another action's live structure (#4812)", () => {
  for (const shape of ["primitive", "child", "in", "keys"] as Shape[])
    it(shape, async () => {
      const a = app(shape);
      flush();
      a.saveA();
      await tick();
      a.saveB();
      await tick();
      a.ends.A();
      await tick();
      const mid = a.seen.at(-1);
      a.ends.B();
      await tick();
      expect([mid, a.seen.at(-1)]).toEqual([afterA[shape], end[shape]]);
    });
});

// Controls: what B reads that A's guess did not change stays B's own.
describe("reads A's guess did not change settle independently (#4812)", () => {
  for (const shape of ["child", "in", "keys"] as const)
    it(shape, async () => {
      const ends: Record<string, () => void> = {};
      const wait = (k: string) => new Promise<void>(r => (ends[k] = r));
      const seen: string[] = [];
      let saveA!: () => any, saveB!: () => any;
      createRoot(() => {
        const [s, set] = createOptimisticStore<any>({ a: 0, child: { x: 3 }, b: 0 });
        createRenderEffect(
          () => `a=${s.a} b=${s.b}`,
          v => void seen.push(v)
        );
        // A changes a value, not the child or the key set.
        saveA = action(function* () {
          set((d: any) => {
            d.a = 9;
          });
          yield wait("A");
        });
        saveB = action(function* () {
          set((d: any) => {
            d.b =
              shape === "child"
                ? d.child.x
                : shape === "in"
                  ? "a" in d
                    ? 2
                    : 0
                  : Object.keys(d).length;
          });
          yield wait("B");
        });
      });
      flush();
      saveA();
      await tick();
      saveB();
      await tick();
      ends.A();
      await tick();
      expect(seen.at(-1)).toBe(`a=0 b=${shape === "child" ? 3 : shape === "in" ? 2 : 3}`);
      ends.B();
      await tick();
      expect(seen.at(-1)).toBe("a=0 b=0");
    });
});

it("an added key's presence and enumeration agree once its action ends (#4812)", async () => {
  let end!: () => void;
  const seen: string[] = [];
  let save!: () => any;
  createRoot(() => {
    const [s, set] = createOptimisticStore<any>({ b: 0 });
    createRenderEffect(
      () => `in=${"extra" in s} keys=${Object.keys(s).join(",")}`,
      v => void seen.push(v)
    );
    save = action(function* () {
      set((d: any) => {
        d.extra = 1;
      });
      yield new Promise<void>(r => (end = r));
    });
  });
  flush();
  save();
  await tick();
  expect(seen.at(-1)).toBe("in=true keys=b,extra");
  end();
  await tick();
  expect(seen.at(-1)).toBe("in=false keys=b");
});
