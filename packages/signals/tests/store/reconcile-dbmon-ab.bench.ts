// dbmon workload benches for the store implementation (CodSpeed per-PR
// tracking). Formerly an A/B against the legacy implementation — legacy is
// deleted; the rows remain as absolute regression tripwires.
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

function subscribeRows(state: any) {
  for (let i = 0; i < ROWS; i++) {
    const db = state.rows[i];
    createRenderEffect(() => db.name, consume);
    createRenderEffect(() => db.count, consume);
    createRenderEffect(() => db.countClass, consume);
    for (let q = 0; q < 5; q++) {
      createRenderEffect(() => db.queries[q].elapsed, consume);
      createRenderEffect(() => db.queries[q].className, consume);
    }
  }
}

function setupNext() {
  let applyTick!: (fresh: any[]) => void;
  const initial = makeData(ROWS, 0);
  const dispose = createRoot(d => {
    const [state, setState] = createStore({ rows: initial });
    subscribeRows(state);
    applyTick = fresh =>
      setState((s: any) => {
        reconcile(fresh, "id")(s.rows);
      });
    return d;
  });
  flush();
  return { applyTick, dispose, last: initial };
}

type Lane = { applyTick: (fresh: any[]) => void; last: any[] };

function runTicks(lane: Lane, partial: boolean) {
  for (let frame = 1; frame <= 5; frame++) {
    let fresh: any[];
    if (partial) {
      // Reuse the row objects the store holds now, so the other 90% hit the identity skip.
      const changed = makeData(ROWS / 10, frame);
      fresh = lane.last.map((row, i) => (i < changed.length ? changed[i] : row));
    } else fresh = makeData(ROWS, frame);
    lane.applyTick(fresh);
    lane.last = fresh;
    flush();
  }
}

function subscribeShallow(state: any) {
  for (let i = 0; i < ROWS; i++) {
    createRenderEffect(() => state[i], consume as any);
  }
}

function setupShallowNext() {
  let applyTick!: (fresh: any[]) => void;
  const initial = makeData(ROWS, 0);
  const dispose = createRoot(d => {
    const [state, setState] = createStore(initial, { shallow: true } as any);
    subscribeShallow(state);
    applyTick = fresh => setState(reconcile(fresh, null) as any);
    return d;
  });
  flush();
  return { applyTick, dispose, last: initial };
}

const next = setupNext();
const shallowNext = setupShallowNext();

bench(
  "dbmon full tick",
  () => {
    runTicks(next, false);
  },
  { time: 4000, warmupIterations: 3 }
);

bench(
  "dbmon partial tick",
  () => {
    runTicks(next, true);
  },
  { time: 4000, warmupIterations: 3 }
);

bench(
  "dbmon shallow full tick",
  () => {
    runTicks(shallowNext, false);
  },
  { time: 3000, warmupIterations: 3 }
);

afterAll(() => {
  next.dispose();
  shallowNext.dispose();
  if (sink === Infinity) console.log("impossible");
});
