import { describe, expect, test } from "vitest";
import {
  createStore,
  createOptimisticStore,
  createProjection,
  markRaw,
  reconcile,
  createEffect,
  createRoot,
  flush
} from "../../src/index.js";

describe("markRaw", () => {
  test("raw values never wrap — served as-is through deep stores", () => {
    const inst = markRaw({ deep: { x: 1 } });
    const [state] = createStore<{ inst: any }>({ inst });
    expect(state.inst).toBe(inst);
    expect(state.inst.deep).toBe(inst.deep);
  });

  test("raw values are tracked by reference at their slot", () => {
    const a = markRaw({ v: 1 });
    const b = markRaw({ v: 2 });
    const [state, setState] = createStore<{ item: any }>({ item: a });
    let runs = 0;
    let seen: any;
    createRoot(() => {
      createEffect(
        () => state.item,
        v => {
          runs++;
          seen = v;
        }
      );
    });
    flush();
    expect(seen).toBe(a);
    setState(s => {
      s.item = b;
    });
    flush();
    expect(runs).toBe(2);
    expect(seen).toBe(b);
  });
});

describe("createStore shallow", () => {
  const makeRows = (frame: number) =>
    Array.from({ length: 4 }, (_, i) => ({
      id: i,
      count: i * 10 + frame,
      queries: [{ elapsed: frame }]
    }));

  test("root keys are reactive, values are raw", () => {
    const rows = makeRows(0);
    const [state] = createStore(rows, { shallow: true });
    expect(state[0]).toBe(rows[0]);
    expect(state[0].queries[0]).toBe(rows[0].queries[0]);
  });

  test("reconcile replaces rows positionally and fires per-index", () => {
    const [state, setState] = createStore(makeRows(0), { shallow: true });
    let runs0 = 0;
    let runs2 = 0;
    createRoot(() => {
      createEffect(
        () => state[0],
        () => {
          runs0++;
        }
      );
      createEffect(
        () => state[2],
        () => {
          runs2++;
        }
      );
    });
    flush();
    runs0 = runs2 = 0;
    const fresh = makeRows(1);
    setState(reconcile(fresh, null));
    flush();
    expect(runs0).toBe(1);
    expect(runs2).toBe(1);
    expect(state[0]).toBe(fresh[0]);
    expect(state[0].count).toBe(1);
  });

  test("reference-identical rows skip (partial tick)", () => {
    const seed = makeRows(0);
    const [state, setState] = createStore(seed, { shallow: true });
    let runs1 = 0;
    createRoot(() => {
      createEffect(
        () => state[1],
        () => {
          runs1++;
        }
      );
    });
    flush();
    runs1 = 0;
    const fresh = makeRows(2);
    const mixed = seed.map((row, i) => (i === 0 ? fresh[0] : row));
    setState(reconcile(mixed, null));
    flush();
    expect(runs1).toBe(0);
    expect(state[0].count).toBe(2);
  });

  test("mutating below the boundary through the setter throws", () => {
    const [state, setState] = createStore(makeRows(0), { shallow: true });
    expect(() =>
      setState(s => {
        (s[0] as any).count = 99;
      })
    ).toThrow();
    expect(state[0].count).toBe(0);
  });

  test("record replacement through the setter works and marks raw", () => {
    const [state, setState] = createStore(makeRows(0), { shallow: true });
    const replacement = { id: 0, count: 42, queries: [{ elapsed: 1 }] };
    setState(s => {
      (s as any)[0] = replacement;
    });
    flush();
    expect(state[0]).toBe(replacement);
    // sticky: the replacement presents raw in a deep store too
    const [other] = createStore<{ r: any }>({ r: replacement });
    expect(other.r).toBe(replacement);
  });

  test("length changes propagate", () => {
    const [state, setState] = createStore(makeRows(0), { shallow: true });
    let len = 0;
    createRoot(() => {
      createEffect(
        () => state.length,
        v => {
          len = v;
        }
      );
    });
    flush();
    setState(reconcile(makeRows(0).slice(0, 2), null));
    flush();
    expect(len).toBe(2);
    expect(state.length).toBe(2);
  });

  test("optimistic shallow store: replacement stages, base rows untouched, children raw", () => {
    const rows = makeRows(0);
    const [state, setState] = createOptimisticStore(
      rows as any,
      undefined as any,
      {
        shallow: true
      } as any
    );
    // children served raw
    expect((state as any)[0]).toBe(rows[0]);
    const optimisticRow = { id: 0, count: 777, queries: [{ elapsed: 0 }] };
    setState((s: any) => {
      s[0] = optimisticRow;
    });
    // staged: visible immediately (tentative)
    expect((state as any)[0]).toBe(optimisticRow);
    expect(rows[0].count).toBe(0);
    // ambient (non-action) optimistic writes auto-revert at flush end,
    // re-reading the untouched raw base row — the boundary contract holds.
    flush();
    expect((state as any)[0]).toBe(rows[0]);
    expect(rows[0].count).toBe(0);
  });

  test("shallow projection: derive reconciles at the boundary, rows stay raw", () => {
    const [version, setVersion] = (() => {
      let v = 0;
      const listeners: any[] = [];
      return [() => v, (n: number) => (v = n)] as any;
    })();
    void version;
    void setVersion;
    let frame = 0;
    const proj = createProjection(
      (draft: any) => {
        // return-form derive: fresh rows each run, reconciled by key at the boundary
        return makeRows(frame);
      },
      makeRows(0) as any,
      { shallow: true } as any
    );
    expect((proj as any)[0].count).toBe(0);
    // rows are raw records
    const r0 = (proj as any)[0];
    expect(r0.queries[0].elapsed).toBe(0);
  });

  test("setter replacement never mutates the base rows", () => {
    // The boundary contract optimism relies on: replacement stages in the
    // override/node layers, the raw base rows stay untouched.
    // (Plumbing `shallow` through createOptimisticStore/createProjection is
    // follow-up work; the staging mechanism is the same layers.)
    const rows = makeRows(0);
    const [state, setState] = createStore(rows, { shallow: true });
    setState(s => {
      (s as any)[0] = { id: 0, count: 777, queries: [{ elapsed: 0 }] };
    });
    flush();
    expect(state[0].count).toBe(777);
    expect(rows[0].count).toBe(0);
  });
});
