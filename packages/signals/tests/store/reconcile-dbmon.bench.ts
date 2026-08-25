// Tier-1 store-lane bench. High-frequency full-graph ingestion — the dbmon
// lane: every tick the app receives a completely FRESH keyed payload (1000
// rows × {id, name, count, countClass, queries: [5 × {elapsed, className}]},
// ~7k objects) and must update a store-driven UI whose bindings subscribe at
// leaf granularity (13 render effects per row, 13k total).
//
// Two shapes, both real authoring patterns:
//   - `deep reconcile`: `createStore` + `reconcile(fresh, "id")` per tick —
//     the keyed deep-diff path (applyStateFast keyed arrays, value walk,
//     leaf setSignal volume) plus effect re-reads through the proxy traps.
//   - `shallow reconcile`: `createStore(rows, { shallow: true })` +
//     `reconcile(fresh, null)` — the record-granularity boundary
//     (applyStateShallow positional slot compare, raw leaf reads, row-level
//     effect fan-out).
//
// Full ticks change every non-name cell (nothing skippable — the worst case
// for fine-grained diffing); partial ticks reuse 90% of row objects by
// reference and exercise the identity skip on both paths.
import { afterAll, bench } from "vitest";
import { createRenderEffect, createRoot, createStore, flush, reconcile } from "../../src/index.js";

const ROWS = 1000;

function makeData(count: number, frame: number) {
  const out = new Array(count);
  for (let i = 0; i < count; i++) {
    const queries = new Array(5);
    for (let q = 0; q < 5; q++) {
      const v = ((i * 31 + q * 7 + frame * 13) % 100) / 10;
      queries[q] = {
        elapsed: v.toFixed(2),
        className: v > 6 ? "warn_long" : v > 3 ? "warn" : "short"
      };
    }
    const c = (i * 17 + frame * 5) % 30;
    out[i] = {
      id: i,
      name: `cluster-${i}`,
      count: c,
      countClass: c > 20 ? "label-important" : c > 10 ? "label-warning" : "label-success",
      queries
    };
  }
  return out;
}

let sink = 0;
const consume = (v: unknown) => {
  sink += typeof v === "string" ? v.length : (v as number);
};

function subscribeRow(read: (q: number) => any, name: () => any, count: () => any, cls: () => any) {
  createRenderEffect(name, consume);
  createRenderEffect(count, consume);
  createRenderEffect(cls, consume);
  for (let q = 0; q < 5; q++) {
    const row = read(q);
    createRenderEffect(() => row().elapsed, consume);
    createRenderEffect(() => row().className, consume);
  }
}

function setup(shallow: boolean) {
  let applyTick!: (fresh: any[]) => void;
  const dispose = createRoot(d => {
    if (shallow) {
      const [state, setState] = createStore(makeData(ROWS, 0), { shallow: true });
      for (let i = 0; i < ROWS; i++) {
        subscribeRow(
          q => () => state[i].queries[q],
          () => state[i].name,
          () => state[i].count,
          () => state[i].countClass
        );
      }
      applyTick = fresh => setState(reconcile(fresh, null));
    } else {
      const [state, setState] = createStore({ rows: makeData(ROWS, 0) });
      for (let i = 0; i < ROWS; i++) {
        const db = state.rows[i];
        subscribeRow(
          q => () => db.queries[q],
          () => db.name,
          () => db.count,
          () => db.countClass
        );
      }
      applyTick = fresh =>
        setState(s => {
          reconcile(fresh, "id")(s.rows);
        });
    }
    return d;
  });
  flush();
  return { applyTick, dispose };
}

function runTicks(applyTick: (fresh: any[]) => void, partial: boolean) {
  for (let frame = 1; frame <= 5; frame++) {
    let fresh = makeData(ROWS, frame);
    if (partial) {
      const prev = makeData(ROWS, frame - 1);
      fresh = prev.map((row, i) => (i < ROWS / 10 ? fresh[i] : row));
    }
    applyTick(fresh);
    flush();
  }
}

const deep = setup(false);
const shallowStore = setup(true);

bench("dbmon full tick — deep reconcile", () => {
  runTicks(deep.applyTick, false);
});

bench("dbmon full tick — shallow reconcile", () => {
  runTicks(shallowStore.applyTick, false);
});

bench("dbmon partial tick — deep reconcile", () => {
  runTicks(deep.applyTick, true);
});

afterAll(() => {
  deep.dispose();
  shallowStore.dispose();
  if (sink === Infinity) console.log("impossible");
});
