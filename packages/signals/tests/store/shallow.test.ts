import { describe, expect, test } from "vitest";
import {
  createStore,
  createOptimisticStore,
  createProjection,
  createSignal,
  reconcile,
  createEffect,
  createRoot,
  flush
} from "../../src/index.js";
// internal for now — shallow stores mark automatically; direct marking is
// package-internal until the standalone use cases are designed
import { markRaw } from "../../src/store/store.js";

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

  test("setter reads serve raws; in-place mutation is reactively inert", () => {
    const [state, setState] = createStore(makeRows(0), { shallow: true });
    let runs = 0;
    createRoot(() => {
      createEffect(
        () => state[0],
        () => {
          runs++;
        }
      );
    });
    flush();
    runs = 0;
    setState(s => {
      // reads in write scope hand back the raw record (read-then-replace,
      // filter, pop all depend on this); mutating it notifies nothing —
      // records are replaced, not edited.
      (s[0] as any).count = 99;
    });
    flush();
    expect(runs).toBe(0);
  });

  test("canonical filter-removal idiom works on shallow stores", () => {
    const [state, setState] = createStore(makeRows(0), { shallow: true });
    setState(s => s.filter(r => r.id !== 1) as any);
    flush();
    expect(state.length).toBe(3);
    expect(state.some(r => r.id === 1)).toBe(false);
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
    const [state, setState] = createOptimisticStore(rows as any, { shallow: true });
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

  test("shallow projection: derive re-runs, reconciles at the boundary, rows stay raw", () => {
    const [frame, setFrame] = createSignal(0);
    const proj = createProjection(
      (draft: any) => {
        // reading the draft must not poison the derive (write-scope reads
        // serve raws), and the signal read registers the dependency
        void draft[0];
        return makeRows(frame());
      },
      makeRows(0) as any,
      { shallow: true }
    );
    createRoot(() => {
      createEffect(
        () => (proj as any)[0],
        () => {}
      );
    });
    flush();
    expect((proj as any)[0].count).toBe(0);
    expect((proj as any)[0].queries[0].elapsed).toBe(0);
    setFrame(2);
    flush();
    expect((proj as any)[0].count).toBe(2);
  });

  test("setter write followed by reconcile lands the reconciled value", () => {
    // regression: the staged override must fold into the shallow diff, not
    // freeze the slot
    const [state, setState] = createStore(makeRows(0), { shallow: true });
    const replacement = { id: 0, count: 555, queries: [{ elapsed: 9 }] };
    setState(s => {
      (s as any)[0] = replacement;
    });
    flush();
    expect(state[0]).toBe(replacement);
    const fresh = makeRows(7);
    setState(reconcile(fresh, null));
    flush();
    expect(state[0]).toBe(fresh[0]);
    expect(state[0].count).toBe(7);
  });

  test("markRaw values in DEEP stores reconcile by replacement", () => {
    // regression: raw-marked pairs are leaves, not recursable children
    const a = markRaw({ v: 1 });
    const b = markRaw({ v: 2 });
    const [state, setState] = createStore<{ item: any }>({ item: a });
    let seen: any;
    createRoot(() => {
      createEffect(
        () => state.item,
        v => {
          seen = v;
        }
      );
    });
    flush();
    expect(seen).toBe(a);
    setState(reconcile({ item: b }, null));
    flush();
    expect(state.item).toBe(b);
    expect(seen).toBe(b);
  });

  test("shallow store nested in a deep store reconciles through the parent", () => {
    // regression: applyStateChild/descendKey must route STORE_SHALLOW
    const rows = makeRows(0);
    const [inner] = createStore(rows, { shallow: true });
    const [outer, setOuter] = createStore<{ list: any }>({ list: rows });
    expect(outer.list).toBe(inner);
    let seen: any;
    createRoot(() => {
      createEffect(
        () => outer.list[0],
        v => {
          seen = v;
        }
      );
    });
    flush();
    const fresh = makeRows(7);
    setOuter(reconcile({ list: fresh }, null));
    flush();
    expect(inner[0]).toBe(fresh[0]);
    expect(seen).toBe(fresh[0]);
  });

  test("shallow OBJECT store: per-key nodes, membership, raw values", () => {
    const a = { v: 1 };
    const b = { v: 2 };
    const [state, setState] = createStore<Record<string, any>>({ a }, { shallow: true });
    expect(state.a).toBe(a);
    let runs = 0;
    createRoot(() => {
      createEffect(
        () => state.a,
        () => {
          runs++;
        }
      );
    });
    flush();
    runs = 0;
    setState(reconcile({ a: b, extra: { z: 1 } }, null));
    flush();
    expect(runs).toBe(1);
    expect(state.a).toBe(b);
    expect((state as any).extra.z).toBe(1);
  });

  test("keyed reconcile on a shallow store is positional by design", () => {
    const rows = makeRows(0);
    const [state, setState] = createStore(rows, { shallow: true });
    const reversed = rows.slice().reverse();
    setState(reconcile(reversed));
    expect(state[0]).toBe(rows[3]);
    expect(state[0].id).toBe(3);
  });

  test("ingesting a deep-tracked value into a shallow store throws in dev", () => {
    const child = { v: 1 };
    const [deep] = createStore({ child });
    // reading through the deep store wraps child into the global lookup
    // (creation happens lazily on read)
    void deep.child;
    expect(() => createStore([child], { shallow: true })).toThrow();
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
