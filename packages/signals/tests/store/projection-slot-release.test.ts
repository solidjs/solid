import { describe, expect, it } from "vitest";
import {
  $TARGET,
  createEffect,
  createMemo,
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  mapArray
} from "../../src/index.js";

/**
 * Projection leaf nodes are released when their readers let go (#3351).
 *
 * Every node materialized under a projection family (value, presence,
 * key-set, deep witness) is linked into the projection computed's firewall
 * child chain so a mark on the derive reaches their subscribers. The chain
 * was append-only: the unobserved sweep dropped a node from the target's
 * cache but left it linked, so a long-lived keyed record grew by one node
 * per leaf ever read — every deleted row's slots (and the last raw they held)
 * stayed reachable until the projection itself was disposed. The rc.1 store
 * rewrite lost the disposal the legacy store had for exactly this shape
 * (the js-framework-benchmark keyed rows). These tests pin it structurally;
 * gc.test.ts pins the heap side.
 */

type Row = { id: string; pos: { x: number; y: number } };
const row = (i: number): Row => ({ id: "n" + i, pos: { x: i, y: 0 } });

/** Nodes linked into a projection's firewall child chain. */
function chain(proj: any): any[] {
  const out: any[] = [];
  for (let c = proj[$TARGET].fam.node._x?._child ?? null; c !== null; c = c._nextChild) out.push(c);
  return out;
}
const chainLength = (proj: any) => chain(proj).length;
/** Cached value/presence nodes on a target. */
const nodeKeys = (target: any) => (target.n ? Object.keys(target.n) : []);
const hasKeys = (target: any) => (target.h ? Object.keys(target.h) : []);

describe("projection leaf release (#3351)", () => {
  it("a keyed record releases every slot of a deleted key once its readers let go", () => {
    const N = 40;
    const [rows, setRows] = createSignal<Row[]>([]);
    const seenX: number[] = [];
    const { record, dispose } = createRoot(dispose => {
      const record = createProjection<Record<string, Row>>(
        draft => {
          const seen = new Set<string>();
          for (const r of rows()) {
            seen.add(r.id);
            if (draft[r.id] !== r) draft[r.id] = r;
          }
          for (const k of Object.keys(draft)) if (!seen.has(k)) delete draft[k];
        },
        {},
        { key: null }
      );
      const ids = createMemo(() => Object.keys(record));
      // One reader per key, each touching a value node on the record, a
      // presence node, and a nested value node on the row target.
      createMemo(
        mapArray(ids, id => {
          createRenderEffect(
            () => (id in record ? record[id]!.pos.x : -1),
            x => {
              seenX.push(x);
            }
          );
          return id;
        })
      )();
      return { record, dispose };
    });
    flush();
    const baseline = chainLength(record);
    const recordTarget = (record as any)[$TARGET];

    setRows(Array.from({ length: N }, (_, i) => row(i)));
    flush();
    expect(seenX).toHaveLength(N);
    expect(nodeKeys(recordTarget)).toHaveLength(N);
    expect(hasKeys(recordTarget)).toHaveLength(N);
    // record value node + presence node per key, plus the nested `pos` and
    // `pos.x` nodes on each row's own target.
    const filled = chainLength(record);
    expect(filled).toBeGreaterThanOrEqual(baseline + 4 * N);

    setRows([]);
    flush();
    expect(Object.keys(record)).toEqual([]);
    // The readers were disposed with their rows: every slot they held is
    // gone from the caches AND from the chain.
    expect(nodeKeys(recordTarget)).toEqual([]);
    expect(hasKeys(recordTarget)).toEqual([]);
    expect(chainLength(record)).toBe(baseline);
    // Nothing left in the chain points at a deleted row's objects.
    for (const node of chain(record)) {
      const v = node._value;
      expect(v !== null && typeof v === "object" && "pos" in v).toBe(false);
    }

    // Refill + empty again: the chain does not ratchet across cycles.
    setRows(Array.from({ length: N }, (_, i) => row(i + N)));
    flush();
    setRows([]);
    flush();
    expect(chainLength(record)).toBe(baseline);
    dispose();
  });

  it("js-framework-benchmark selection: rows read selected[id]; removed rows release their slot", () => {
    // The jsfb shape: a selection projection keyed by row id (`draft[prev]
    // = false; draft[id] = true`), and every rendered row reads its own
    // `selected[row.id]`. A node materializes per rendered row; when rows are
    // removed (clear, swap, every-10th delete) their readers go away and the
    // slots must go with them — on the legacy store this was the explicit
    // disposal the rewrite lost. The record itself keeps its keys (they are
    // the app's data); only the subscription nodes are what's reclaimed.
    type Row = { id: number; label: string };
    const [data, setData] = createSignal<Row[]>([]);
    const [selectedId, setSelectedId] = createSignal<number | null>(null);
    const rendered = new Map<number, boolean>();
    const { selected, dispose } = createRoot(dispose => {
      let prev: number | null = null;
      const selected = createProjection<Record<number, boolean>>(
        draft => {
          const id = selectedId();
          if (prev !== null) draft[prev] = false;
          if (id !== null) draft[id] = true;
          prev = id;
        },
        {},
        { key: null }
      );
      createMemo(
        mapArray(data, row => {
          createRenderEffect(
            () => !!selected[row.id],
            on => {
              rendered.set(row.id, on);
            }
          );
          return row;
        })
      )();
      return { selected, dispose };
    });
    flush();
    const target = (selected as any)[$TARGET];
    const baseline = chainLength(selected);
    const make = (n: number, from = 0) =>
      Array.from({ length: n }, (_, i) => ({ id: from + i, label: "row " + (from + i) }));

    const rows = make(1000);
    setData(rows);
    flush();
    expect(nodeKeys(target)).toHaveLength(1000);
    expect(chainLength(selected)).toBe(baseline + 1000);

    setSelectedId(5);
    flush();
    expect(rendered.get(5)).toBe(true);
    setSelectedId(7);
    flush();
    expect(rendered.get(5)).toBe(false);
    expect(rendered.get(7)).toBe(true);

    // Remove every 10th row: exactly those slots go, the rest stay.
    setData(rows.filter(r => r.id % 10 !== 0));
    flush();
    expect(nodeKeys(target)).toHaveLength(900);
    expect(nodeKeys(target)).not.toContain("10");
    expect(chainLength(selected)).toBe(baseline + 900);

    // Clear: every slot released, the record keeps the app's stale keys.
    setData([]);
    flush();
    expect(nodeKeys(target)).toEqual([]);
    expect(chainLength(selected)).toBe(baseline);
    expect(Object.keys(selected)).toEqual(["5", "7"]);

    // Create 1000 fresh rows twice (jsfb "create" then "create" again — new
    // ids each time): steady state, no growth from rows that are gone.
    setData(make(1000, 1000));
    flush();
    setSelectedId(1001);
    flush();
    expect(rendered.get(1001)).toBe(true);
    expect(chainLength(selected)).toBe(baseline + 1000);
    setData(make(1000, 2000));
    flush();
    expect(chainLength(selected)).toBe(baseline + 1000);
    expect(nodeKeys(target).every(k => Number(k) >= 2000)).toBe(true);
    dispose();
  });

  it("rows projection: removed rows release their leaf nodes", () => {
    type Bench = { id: number; label: string };
    const [data, setData] = createSignal<Bench[]>([]);
    const labels: string[] = [];
    const { rows, dispose } = createRoot(dispose => {
      const rows = createProjection<Bench[]>(draft => {
        const next = data();
        for (let i = 0; i < next.length; i++) if (draft[i] !== next[i]) draft[i] = next[i];
        draft.length = next.length;
      }, []);
      createMemo(
        mapArray(
          () => rows,
          r => {
            createRenderEffect(
              () => r.label,
              l => {
                labels.push(l);
              }
            );
            return r;
          }
        )
      )();
      return { rows, dispose };
    });
    flush();
    const baseline = chainLength(rows);

    const make = (n: number, from = 0) =>
      Array.from({ length: n }, (_, i) => ({ id: from + i, label: "row " + (from + i) }));
    const all = make(100);
    setData(all);
    flush();
    expect(labels).toHaveLength(100);
    const rowTargets = all.map((_, i) => (rows[i] as any)[$TARGET]);
    for (const t of rowTargets) expect(nodeKeys(t)).toEqual(["label"]);
    expect(chainLength(rows)).toBeGreaterThanOrEqual(baseline + 100);

    // Remove every other row (same objects — the kept rows keep their
    // readers and their nodes), then clear.
    setData(all.filter(r => r.id % 2 === 0));
    flush();
    for (const t of rowTargets) expect(nodeKeys(t)).toEqual(t.v.id % 2 === 0 ? ["label"] : []);
    setData([]);
    flush();
    for (const t of rowTargets) expect(nodeKeys(t)).toEqual([]);
    expect(chainLength(rows)).toBe(baseline);

    // Replace with fresh rows: steady state, no growth from the old ones.
    setData(make(100, 1000));
    flush();
    const steady = chainLength(rows);
    setData(make(100, 2000));
    flush();
    expect(chainLength(rows)).toBe(steady);
    dispose();
  });

  it("a slot still read after its key was deleted stays linked until the reader releases", () => {
    const [gone, setGone] = createSignal(false);
    const seen: unknown[] = [];
    let disposeReader!: () => void;
    const record = createRoot(() => {
      const record = createProjection<{ a?: number; b: number }>(
        draft => {
          if (gone()) delete draft.a;
          else draft.a = 1;
        },
        { b: 2 },
        { key: null }
      );
      disposeReader = createRoot(d => {
        createEffect(
          () => record.a,
          v => {
            seen.push(v);
          }
        );
        return d;
      });
      return record;
    });
    flush();
    const target = (record as any)[$TARGET];
    expect(nodeKeys(target)).toEqual(["a"]);
    const linked = chainLength(record);

    setGone(true);
    flush();
    expect(seen).toEqual([1, undefined]);
    // The effect is still subscribed to `a`: the node is live, not leaked.
    expect(nodeKeys(target)).toEqual(["a"]);
    expect(chainLength(record)).toBe(linked);

    disposeReader();
    expect(nodeKeys(target)).toEqual([]);
    expect(chainLength(record)).toBe(linked - 1);

    // A fresh read materializes a fresh node — the chain does not double up.
    createRoot(() => {
      createEffect(
        () => record.a,
        () => {}
      );
    });
    flush();
    expect(nodeKeys(target)).toEqual(["a"]);
    expect(chainLength(record)).toBe(linked);
  });

  it("presence, key-set and deep-witness nodes unlink like value nodes", () => {
    const [tick, setTick] = createSignal(0);
    const record = createRoot(() =>
      createProjection<Record<string, number>>(
        draft => {
          draft["k" + tick()] = tick();
        },
        {},
        { key: null }
      )
    );
    flush();
    const target = (record as any)[$TARGET];
    const before = chainLength(record);
    const dispose = createRoot(d => {
      createEffect(
        () => ["k0" in record, Object.keys(record).length],
        () => {}
      );
      return d;
    });
    flush();
    expect(hasKeys(target)).toEqual(["k0"]);
    expect(target.k).not.toBeNull();
    expect(chainLength(record)).toBe(before + 2);
    dispose();
    expect(hasKeys(target)).toEqual([]);
    expect(target.k).toBeNull();
    expect(chainLength(record)).toBe(before);
    setTick(1);
    flush();
    expect(record.k1).toBe(1);
  });

  it("derived stores (createStore(fn, seed)) release slots the same way", () => {
    const [src, setSrc] = createStore<Record<string, { n: number }>>({});
    const { view, dispose } = createRoot(dispose => {
      const [view] = createStore<Record<string, { n: number }>>(
        draft => {
          for (const k of Object.keys(draft)) if (!(k in src)) delete draft[k];
          for (const k of Object.keys(src)) draft[k] = src[k];
        },
        {},
        { key: null }
      );
      const keys = createMemo(() => Object.keys(view));
      createMemo(
        mapArray(keys, k => {
          createRenderEffect(
            () => view[k]?.n,
            () => {}
          );
          return k;
        })
      )();
      return { view, dispose };
    });
    flush();
    const baseline = chainLength(view);
    setSrc(s => {
      for (let i = 0; i < 20; i++) s["k" + i] = { n: i };
    });
    flush();
    expect(chainLength(view)).toBeGreaterThanOrEqual(baseline + 40);
    setSrc(s => {
      for (let i = 0; i < 20; i++) delete s["k" + i];
    });
    flush();
    expect(Object.keys(view)).toEqual([]);
    expect(nodeKeys((view as any)[$TARGET])).toEqual([]);
    expect(chainLength(view)).toBe(baseline);
    dispose();
  });
});
