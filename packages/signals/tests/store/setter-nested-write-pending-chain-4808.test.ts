/**
 * #4808: a plain store setter writes a nested field through a child that is
 * another store still loading its first answer. The draft's base for that
 * child is the child store's write base — its seed (A25: the seed is a
 * draft, never an observable value; a setter before the first answer runs
 * against it, #3274) — so the write lands instead of throwing NotReadyError.
 * Reads still never show the seed. The written key is the outer store's own,
 * as it is for the same write after the first answer (`[2, 9]` there: the
 * inner store's later answers read through only the keys the outer never
 * wrote), so it shows at the write and stays over the first answer.
 */
import { describe, expect, it } from "vitest";
import { createRenderEffect, createRoot, createStore, flush } from "../../src/index.js";

const tick = async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

describe("#4808 a nested write through a pending chained store", () => {
  it("writes against the seed and never throws", async () => {
    let res!: (v: { x: number }) => void;
    const first = new Promise<{ x: number }>(r => (res = r));
    let setOuter!: any;
    const seen: unknown[] = [];
    createRoot(() => {
      const [inner] = createStore(() => first, { x: 0 });
      const [outer, set] = createStore(() => ({ child: inner }), { child: { x: 0 } } as any);
      setOuter = set;
      createRenderEffect(
        () => outer.child.x,
        v => void seen.push(v)
      );
    });
    flush();
    let childSeen = false;
    expect(() =>
      setOuter((d: any) => {
        const child = d.child;
        childSeen = child !== undefined;
        child.x = 9;
      })
    ).not.toThrow();
    expect(childSeen).toBe(true);
    flush();
    res({ x: 2 });
    await tick();
    expect(seen).toEqual([9]);
  });

  it("a whole-child replacement still works before the first answer", async () => {
    let res!: (v: { x: number }) => void;
    const first = new Promise<{ x: number }>(r => (res = r));
    let setOuter!: any;
    createRoot(() => {
      const [inner] = createStore(() => first, { x: 0 });
      [, setOuter] = createStore(() => ({ child: inner }), { child: { x: 0 } } as any);
    });
    flush();
    expect(() =>
      setOuter((d: any) => {
        d.child = { x: 5 };
      })
    ).not.toThrow();
    res({ x: 2 });
    await tick();
  });
});
