import { describe, expect, it } from "vitest";
import {
  createEffect,
  createMemo,
  createProjection,
  createRoot,
  createStore,
  flush
} from "../src/index.js";

// #4782: a projection whose derive reads a memo sits higher in the heap than a
// projection reading its leaves (a leaf carries no height). The reader's
// family pull must bring the derive up to date and lift the reader above it,
// as a tracked read of a memo does, so each derive runs once per flush.
function run(N: number, memo: boolean) {
  let bRuns = 0,
    rRuns = 0,
    setSizes!: (fn: (d: Record<number, number>) => void) => void,
    out = -1;
  const dispose = createRoot(dispose => {
    const [sizes, set] = createStore<Record<number, number>>(
      Object.fromEntries(Array.from({ length: N }, (_, i) => [i, 0]))
    );
    setSizes = set;
    const A = Array.from({ length: N }, (_, i) => {
      const m = createMemo(() => ({ id: i }));
      return createProjection(() => ({ id: memo ? m().id : i, size: sizes[i] }), {
        id: -1,
        size: 0
      });
    });
    const B = Array.from({ length: N - 1 }, (_, i) =>
      createProjection(
        () => {
          bRuns++;
          return { ok: A[i].size > 0 && A[i + 1].size > 0 };
        },
        { ok: false }
      )
    );
    const R = createProjection(
      (draft: { ok: number }) => {
        rRuns++;
        let n = 0;
        for (const b of B) if (b.ok) n++;
        draft.ok = n;
      },
      { ok: 0 }
    );
    createEffect(
      () => R.ok,
      v => void (out = v)
    );
    return dispose;
  });
  flush();
  bRuns = rRuns = 0;
  setSizes(d => {
    for (let i = 0; i < N; i++) d[i] = 1;
  });
  flush();
  dispose();
  return { bRuns, rRuns, out };
}

describe("a projection read by another projection's derive (#4782)", () => {
  for (const memo of [true, false])
    it(`each derive runs once per flush (${memo ? "derive reads a memo" : "store keys only"})`, () => {
      expect(run(50, memo)).toEqual({ bRuns: 49, rRuns: 1, out: 49 });
    });
});
