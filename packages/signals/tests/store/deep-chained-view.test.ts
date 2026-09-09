import { describe, expect, it } from "vitest";
import {
  action,
  createEffect,
  createOptimisticStore,
  createRoot,
  createStore,
  deep,
  flush
} from "../../src/index.js";
import { $TARGET } from "../../src/store/store.js";

type Row = { id: string; qty: number; meta?: { tag: string } };

// #3323: deep() over a derived (chained) view must hear writes that arrive
// through the BASE family, exactly as per-key reads do. The view's own
// witness nodes only see the view family's writes (optimistic overrides), so
// the walk reads through to the inner record's key-set and deep witness — the
// $TRACK trap's rule (#2864 / R21) applied to deep().
describe("deep() over a chained optimistic view (#3323)", () => {
  function setup() {
    const [base, setBase] = createStore<Row[]>([{ id: "a", qty: 1, meta: { tag: "x" } }]);
    const [view, setView] = createOptimisticStore<Row[]>(base);
    flush();
    const runs = { row: 0, root: 0, key: 0 };
    const row = view[0];
    createEffect(
      () => deep(row),
      () => void runs.row++
    );
    createEffect(
      () => deep(view),
      () => void runs.root++
    );
    createEffect(
      () => row.qty,
      () => void runs.key++
    );
    flush();
    const first = { ...runs };
    const delta = () => ({
      row: runs.row - first.row,
      root: runs.root - first.root,
      key: runs.key - first.key
    });
    return { base, setBase, view, setView, row, runs, delta };
  }

  it("wakes deep(view[0]) and deep(view) on an authoritative base write", () => {
    createRoot(() => {
      const { setBase, view, delta } = setup();
      setBase(d => {
        d[0].qty = 2;
      });
      flush();
      expect(view[0].qty).toBe(2);
      expect(delta()).toEqual({ row: 1, root: 1, key: 1 });
    });
  });

  it("wakes on a nested base write the per-key effect does not see", () => {
    createRoot(() => {
      const { setBase, view, delta } = setup();
      setBase(d => {
        d[0].meta!.tag = "y";
      });
      flush();
      expect(view[0].meta!.tag).toBe("y");
      expect(delta()).toEqual({ row: 1, root: 1, key: 0 });
    });
  });

  it("wakes deep(view) on a base structural change", () => {
    createRoot(() => {
      const { setBase, view, delta } = setup();
      setBase(d => {
        d.push({ id: "b", qty: 5 });
      });
      flush();
      expect(view.length).toBe(2);
      expect(delta().root).toBe(1);
    });
  });

  it("re-walk after a base push subscribes the new row", () => {
    createRoot(() => {
      const { setBase, view, runs } = setup();
      setBase(d => {
        d.push({ id: "b", qty: 5 });
      });
      flush();
      const before = runs.root;
      setBase(d => {
        d[1].qty = 6;
      });
      flush();
      expect(view[1].qty).toBe(6);
      expect(runs.root - before).toBe(1);
    });
  });

  it("does not create a second view target for a row the walk reaches", () => {
    createRoot(() => {
      const [base] = createStore<Row[]>([{ id: "a", qty: 1 }]);
      const [view] = createOptimisticStore<Row[]>(base);
      flush();
      let walked: any;
      createEffect(
        () => {
          walked = deep(view);
        },
        () => {}
      );
      flush();
      // The row the walk resolved is the one the get trap serves: one chained
      // target per row, keyed by the inner proxy.
      const served = view[0];
      const fam = (view as any)[$TARGET].fam;
      const raw = (base as any)[$TARGET].v[0];
      expect(fam.map.get(base[0])).toBe((served as any)[$TARGET]);
      expect(fam.map.get(raw)).toBeUndefined(); // no orphan raw-keyed wrapper
      expect(walked).toEqual([{ id: "a", qty: 1 }]);
    });
  });

  it("still wakes on the view's own optimistic write (and its revert)", async () => {
    await createRoot(async () => {
      const { setView, view, runs } = setup();
      const before = runs.row;
      setView(d => {
        d[0].qty = 9;
      });
      flush();
      // Outside an action the optimistic write applies and reverts in this
      // flush; the row witness fires for both.
      expect(runs.row - before).toBeGreaterThanOrEqual(1);
    });
  });

  it("deep(view) also wakes on the view's optimistic structural write", () => {
    createRoot(() => {
      const { setView, view, runs } = setup();
      const before = runs.root;
      setView(d => {
        d.push({ id: "opt", qty: 0 });
      });
      flush();
      expect(runs.root - before).toBeGreaterThanOrEqual(1);
    });
  });
});

// The walk enumerates and resolves children exactly as the traps serve them
// (shared visibleKeys/visibleDescriptor). A row added under a held optimistic
// action lives in presence/value overrides, not the committed backing; the
// walk used to skip its record entirely, so deep() showed the row (snapshot
// composes the view) but was deaf to every write on it until settle.
describe("deep() over rows added by a held optimistic action", () => {
  type Row = { id: string; qty: number; meta: { tag: string } };
  for (const derived of [false, true]) {
    it(`hears shallow and nested writes on the added row (derived=${derived})`, async () => {
      const gate = Promise.withResolvers<void>();
      let view!: Row[];
      let setView!: (fn: (d: Row[]) => void) => void;
      let runs = 0;
      let seen!: Row[];
      let dispose!: () => void;
      createRoot(d => {
        dispose = d;
        const [base] = createStore<Row[]>([{ id: "a", qty: 1, meta: { tag: "x" } }]);
        [view, setView] = derived
          ? createOptimisticStore<Row[]>(base)
          : createOptimisticStore<Row[]>([{ id: "a", qty: 1, meta: { tag: "x" } }]);
        createEffect(
          () => {
            seen = deep(view);
          },
          () => void runs++
        );
      });
      flush();
      const push = action(function* () {
        setView(d => {
          d.push({ id: "b", qty: 0, meta: { tag: "n" } });
        });
        yield gate.promise;
      });
      const p1 = push();
      flush();
      expect.soft(seen.length).toBe(2);
      const afterPush = runs;

      const shallow = action(function* () {
        setView(d => {
          d[1].qty = 7;
        });
        yield gate.promise;
      });
      const p2 = shallow();
      flush();
      expect.soft(view[1].qty).toBe(7);
      expect.soft(runs, "shallow write on the added row wakes deep()").toBeGreaterThan(afterPush);
      expect.soft(seen[1].qty).toBe(7);
      const afterShallow = runs;

      const nested = action(function* () {
        setView(d => {
          d[1].meta.tag = "m";
        });
        yield gate.promise;
      });
      const p3 = nested();
      flush();
      expect.soft(view[1].meta.tag).toBe("m");
      expect.soft(runs, "nested write on the added row wakes deep()").toBeGreaterThan(afterShallow);
      expect.soft(seen[1].meta.tag).toBe("m");

      gate.resolve();
      await Promise.all([p1, p2, p3]);
      flush();
      expect(seen.length).toBe(1); // optimistic rows revert
      dispose();
    });
  }
});

// A chained target serving from its pending backing resolves inner-owned raws
// to the inner family's proxy, so an active overlay serves the SAME chained
// row targets as the settled state: identities hold through an optimistic
// action, and optimistic nested writes land where deep()'s witnesses are.
describe("derived view identity under an optimistic overlay", () => {
  type Row = { id: string; qty: number; meta: { tag: string } };
  function build() {
    let view!: Row[];
    let setView!: (fn: (d: Row[]) => void) => void;
    let runs = 0;
    let seen!: Row[];
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const [base] = createStore<Row[]>([
        { id: "a", qty: 1, meta: { tag: "x" } },
        { id: "b", qty: 2, meta: { tag: "y" } }
      ]);
      [view, setView] = createOptimisticStore<Row[]>(base);
      createEffect(
        () => {
          seen = deep(view);
        },
        () => void runs++
      );
    });
    flush();
    return {
      view,
      setView,
      get runs() {
        return runs;
      },
      get seen() {
        return seen;
      },
      dispose
    };
  }

  it("keeps untouched row identities stable while an action holds a structural write", async () => {
    const gate = Promise.withResolvers<void>();
    const s = build();
    const row0 = s.view[0];
    const row1 = s.view[1];
    const meta0 = s.view[0].meta;
    const push = action(function* () {
      s.setView(d => {
        d.push({ id: "c", qty: 3, meta: { tag: "z" } });
      });
      yield gate.promise;
    });
    const p = push();
    flush();
    expect.soft(s.view.length).toBe(3);
    expect.soft(s.view[0]).toBe(row0);
    expect.soft(s.view[1]).toBe(row1);
    expect.soft(s.view[0].meta).toBe(meta0);
    expect
      .soft(s.view.map(r => r).filter((r, i) => i < 2 && r !== [row0, row1][i]))
      .toHaveLength(0);
    gate.resolve();
    await p;
    flush();
    expect(s.view[0]).toBe(row0);
    expect(s.view[1]).toBe(row1);
    s.dispose();
  });

  it("wakes deep(view) on an optimistic nested write to an existing row after a structural write", async () => {
    const gate = Promise.withResolvers<void>();
    const s = build();
    const push = action(function* () {
      s.setView(d => {
        d.push({ id: "c", qty: 3, meta: { tag: "z" } });
      });
      yield gate.promise;
    });
    const p1 = push();
    flush();
    const before = s.runs;
    const nested = action(function* () {
      s.setView(d => {
        d[0].meta.tag = "q";
      });
      yield gate.promise;
    });
    const p2 = nested();
    flush();
    expect.soft(s.view[0].meta.tag).toBe("q");
    expect.soft(s.runs).toBeGreaterThan(before);
    expect.soft(s.seen[0].meta.tag).toBe("q");
    gate.resolve();
    await Promise.all([p1, p2]);
    flush();
    expect(s.view[0].meta.tag).toBe("x");
    s.dispose();
  });
});
