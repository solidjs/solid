import { describe, expect, test } from "vitest";
import {
  createErrorBoundary,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  flush
} from "../src/index.js";

// #2949 — a source that recovers by recomputing to a value equal to its last
// committed one fires no value notification. Dependents that re-ran during
// the error window consumed their dirty flag in an errored run (fresh sibling
// values absorbed, nothing committed), so a silent recovery revealed stale
// content. recompute's tail now sweeps dependents holding the propagated
// error object (settleErroredDependents) and re-enqueues them.
describe("silent error recovery (#2949)", () => {
  function setup() {
    let setA!: (v: number) => void;
    let setB!: (v: number) => void;
    let out!: () => string;
    let sumRuns = 0;
    createRoot(() => {
      const [a, _setA] = createSignal(0);
      const [b, _setB] = createSignal(0);
      setA = _setA;
      setB = _setB;
      const ma = createMemo(() => a());
      const mb = createMemo(() => {
        const v = b();
        if (v < 0) throw new Error(`b=${v}`);
        return v;
      });
      const sum = createMemo(() => {
        sumRuns++;
        return ma() + mb();
      });
      out = createErrorBoundary(
        () => `ok:${sum()}`,
        err => `err:${(err() as Error)?.message}`
      );
      createEffect(
        () => out(),
        () => {}
      );
    });
    flush();
    return { setA, setB, out: () => out(), runs: () => sumRuns };
  }

  test("boundary reveals fresh sibling values after unchanged-value recovery", () => {
    const { setA, setB, out } = setup();
    expect(out()).toBe("ok:0");

    setB(-1); // b errors -> fallback
    flush();
    expect(out()).toBe("err:b=-1");

    setA(10); // sibling changes while the boundary is down
    flush();

    setB(0); // b recovers — to the same value it last committed
    flush();
    expect(out()).toBe("ok:10");
  });

  test("unchanged-value recovery with no sibling change reveals the same value", () => {
    const { setB, out, runs } = setup();
    expect(out()).toBe("ok:0");
    const runsBefore = runs();

    setB(-1);
    flush();
    expect(out()).toBe("err:b=-1");

    setB(0);
    flush();
    expect(out()).toBe("ok:0");
    // The sweep re-runs the errored dependent once; it commits an unchanged
    // value and everything settles.
    expect(runs()).toBe(runsBefore + 1);
  });

  test("changed-value recovery still rides normal notification", () => {
    const { setA, setB, out } = setup();

    setB(-1);
    flush();
    expect(out()).toBe("err:b=-1");

    setA(10);
    flush();

    setB(5); // recovers to a DIFFERENT value
    flush();
    expect(out()).toBe("ok:15");
  });

  test("a dependent with another still-broken source re-errors on its sweep re-run", () => {
    let setB!: (v: number) => void;
    let setC!: (v: number) => void;
    let out!: () => string;
    createRoot(() => {
      const [b, _setB] = createSignal(0);
      const [c, _setC] = createSignal(0);
      setB = _setB;
      setC = _setC;
      const mb = createMemo(() => {
        const v = b();
        if (v < 0) throw new Error(`b=${v}`);
        return v;
      });
      const mc = createMemo(() => {
        const v = c();
        if (v < 0) throw new Error(`c=${v}`);
        return v;
      });
      const sum = createMemo(() => mb() + mc());
      out = createErrorBoundary(
        () => `ok:${sum()}`,
        err => `err:${(err() as Error)?.message}`
      );
      createEffect(
        () => out(),
        () => {}
      );
    });
    flush();
    expect(out()).toBe("ok:0");

    setB(-1); // b errors first
    flush();
    expect(out()).toBe("err:b=-1");

    setC(-2); // c breaks too, while the boundary is down (sum re-errors on b)
    flush();

    setB(0); // b recovers unchanged — but c is still broken
    flush();
    expect(out()).toBe("err:c=-2");

    setC(3); // c recovers, changed
    flush();
    expect(out()).toBe("ok:3");
  });

  test("cascade: intermediate memo also recovers to an unchanged value", () => {
    let setA!: (v: number) => void;
    let setB!: (v: number) => void;
    let out!: () => string;
    createRoot(() => {
      const [a, _setA] = createSignal(0);
      const [b, _setB] = createSignal(0);
      setA = _setA;
      setB = _setB;
      const mb = createMemo(() => {
        const v = b();
        if (v < 0) throw new Error(`b=${v}`);
        return v;
      });
      // mid absorbs mb but always maps to its sign — recovery to 0 keeps
      // mid's committed value (0) unchanged, so the sweep must cascade
      // through mid to reach outer.
      const mid = createMemo(() => Math.sign(mb()));
      const [aa] = [a];
      const outer = createMemo(() => `${aa()}|${mid()}`);
      out = createErrorBoundary(
        () => `ok:${outer()}`,
        err => `err:${(err() as Error)?.message}`
      );
      createEffect(
        () => out(),
        () => {}
      );
    });
    flush();
    expect(out()).toBe("ok:0|0");

    setB(-1); // errors: mb -> mid -> outer hold the same error object
    flush();
    expect(out()).toBe("err:b=-1");

    setA(7); // sibling change absorbed by outer's errored re-run
    flush();

    setB(0); // mb recovers unchanged; mid re-runs, also commits unchanged (sign 0)
    flush();
    expect(out()).toBe("ok:7|0");
  });

  // The async dimension needs no sweep of its own: recovery passes through a
  // pending window whose re-runners set _blocked and ride settlePendingSource.
  // This documents that invariant (the sweep cannot fire on this path — the
  // refetch re-run exits recompute through the NotReadyError catch).
  test("async flavor: rejected async memo recovering to unchanged value reveals fresh siblings", async () => {
    let setA!: (v: number) => void;
    let setB!: (v: number) => void;
    let out!: () => string;
    createRoot(() => {
      const [a, _setA] = createSignal(0);
      const [b, _setB] = createSignal(0);
      setA = _setA;
      setB = _setB;
      const ma = createMemo(() => a());
      const mb = createMemo(async () => {
        const v = b();
        await Promise.resolve();
        if (v < 0) throw new Error(`b=${v}`);
        return v;
      });
      const sum = createMemo(() => ma() + mb());
      out = createErrorBoundary(
        () => `ok:${sum()}`,
        err => `err:${(err() as Error)?.message}`
      );
      createEffect(
        () => out(),
        () => {}
      );
    });
    flush();
    await new Promise(r => setTimeout(r, 10));
    expect(out()).toBe("ok:0");

    setB(-1);
    flush();
    await new Promise(r => setTimeout(r, 10));
    expect(out()).toBe("err:b=-1");

    setA(10);
    flush();
    await new Promise(r => setTimeout(r, 10));

    setB(0); // recovers — resolves to the same value it last committed
    flush();
    await new Promise(r => setTimeout(r, 10));
    expect(out()).toBe("ok:10");
  });

  test("plain effects (no boundary) re-run after unchanged-value recovery", () => {
    let setA!: (v: number) => void;
    let setB!: (v: number) => void;
    const seen: string[] = [];
    createRoot(() => {
      const [a, _setA] = createSignal(0);
      const [b, _setB] = createSignal(0);
      setA = _setA;
      setB = _setB;
      const mb = createMemo(() => {
        const v = b();
        if (v < 0) throw new Error(`b=${v}`);
        return v;
      });
      const sum = createMemo(() => a() + mb());
      createErrorBoundary(
        () => {
          createEffect(
            () => sum(),
            v => {
              seen.push(`v:${v}`);
            }
          );
          return "tree";
        },
        () => "fallback"
      )();
    });
    flush();
    expect(seen).toEqual(["v:0"]);

    setB(-1);
    flush();

    setA(4);
    flush();

    setB(0);
    flush();
    expect(seen[seen.length - 1]).toBe("v:4");
  });
});
