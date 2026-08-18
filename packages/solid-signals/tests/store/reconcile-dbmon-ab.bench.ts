// Transitional A/B bench: the SAME dbmon workload against the rewrite (via
// the public dispatcher) and the legacy implementation (imported directly),
// interleaved in one process — no session/thermal skew, one JIT. Delete with
// the legacy modules.
import { afterAll, bench } from "vitest";
import { createRenderEffect, createRoot, createStore, flush, reconcile } from "../../src/index.js";
import { createStore as legacyCreateStore } from "../../src/store/store.js";
import { reconcile as legacyReconcile } from "../../src/store/reconcile.js";

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
  const dispose = createRoot(d => {
    const [state, setState] = createStore({ rows: makeData(ROWS, 0) });
    subscribeRows(state);
    applyTick = fresh =>
      setState((s: any) => {
        reconcile(fresh, "id")(s.rows);
      });
    return d;
  });
  flush();
  return { applyTick, dispose };
}

function setupLegacy() {
  let applyTick!: (fresh: any[]) => void;
  const dispose = createRoot(d => {
    const [state, setState] = (legacyCreateStore as any)({ rows: makeData(ROWS, 0) });
    subscribeRows(state);
    applyTick = fresh =>
      setState((s: any) => {
        legacyReconcile(fresh, "id")(s.rows);
      });
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

const next = setupNext();
const legacy = setupLegacy();

bench(
  "A/B full tick — next",
  () => {
    runTicks(next.applyTick, false);
  },
  { time: 4000, warmupIterations: 3 }
);

bench(
  "A/B full tick — legacy",
  () => {
    runTicks(legacy.applyTick, false);
  },
  { time: 4000, warmupIterations: 3 }
);

bench(
  "A/B partial tick — next",
  () => {
    runTicks(next.applyTick, true);
  },
  { time: 4000, warmupIterations: 3 }
);

bench(
  "A/B partial tick — legacy",
  () => {
    runTicks(legacy.applyTick, true);
  },
  { time: 4000, warmupIterations: 3 }
);

afterAll(() => {
  next.dispose();
  legacy.dispose();
  if (sink === Infinity) console.log("impossible");
});
