/**
 * #4808: a plain store setter writes a nested field through a child that is
 * another store still loading its first answer. The draft needs that store's
 * contents as its base, and they do not exist yet: its seed is never an
 * observable value (A25), and copying it would show the seed for every key
 * the setter did not write, for good (the copy detaches the child, as the
 * same write after the first answer does). Throwing is not an option
 * (maintainer, 2026-11-12). The write is dropped, as a write to a loading
 * store itself is (its first answer replaces it), the outer keeps following
 * the inner store, and dev names the cause (STORE_WRITE_THROUGH_LOADING). A
 * whole-child replacement needs no base and still works; after the first
 * answer the nested write lands.
 */
import { describe, expect, it, vi } from "vitest";
import { OBSERVE, createRenderEffect, createRoot, createStore, flush } from "../../src/index.js";

const tick = async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

function setup() {
  let res!: (v: { x: number; y: number }) => void;
  const first = new Promise<{ x: number; y: number }>(r => (res = r));
  let setOuter!: any, outerStore!: any;
  const seen: unknown[] = [];
  createRoot(() => {
    const [inner] = createStore(() => first, { x: 0, y: 0 });
    const [outer, set] = createStore(() => ({ child: inner }), { child: { x: 0, y: 0 } } as any);
    setOuter = set;
    outerStore = outer;
    createRenderEffect(
      () => outer.child.x + "," + outer.child.y,
      v => void seen.push(v)
    );
  });
  flush();
  return {
    res: (v: { x: number; y: number }) => res(v),
    set: setOuter,
    seen,
    outer: () => outerStore
  };
}

describe("#4808 a nested write through a pending chained store", () => {
  it("is dropped with a named dev diagnostic, and never shows the seed", async () => {
    const { res, set, seen, outer } = setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const capture = OBSERVE!.diagnostics.capture();
    let thrown: unknown;
    try {
      set((d: any) => {
        d.child.x = 9;
        d.other = 1;
      });
    } catch (e) {
      thrown = e;
    }
    const events = capture.stop();
    warn.mockRestore();
    error.mockRestore();
    expect(thrown).toBeUndefined();
    expect(events.map(e => e.code)).toEqual(["STORE_WRITE_THROUGH_LOADING"]);
    expect(events[0].data).toEqual({ operation: "set", property: "child" });
    flush();
    res({ x: 2, y: 5 });
    await tick();
    // The inner store's answer shows; the rest of the setter's writes land.
    expect(seen).toEqual(["2,5"]);
    expect(outer().other).toBe(1);
    set((d: any) => {
      d.child.x = 9;
    });
    flush();
    expect(seen).toEqual(["2,5", "9,5"]);
  });

  it("a whole-child replacement still works before the first answer", async () => {
    const { res, set, seen } = setup();
    expect(() =>
      set((d: any) => {
        d.child = { x: 5, y: 6 };
      })
    ).not.toThrow();
    flush();
    res({ x: 2, y: 5 });
    await tick();
    expect(seen).toEqual(["5,6"]);
  });
});
