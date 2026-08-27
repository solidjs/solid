// Tier-1 memory-overhead guard (stage-3 regression fence).
//
// Stage 3 paid for its wins in FIELDS: signal/computed literal diets, the
// `_x` cold-field extension split, pre-shaped store targets under the
// dictionary-mode cliff. One innocent field addition regresses all of it,
// and neither CodSpeed (instructions) nor size-limit (shipped bytes) sees
// heap bytes. This harness measures BYTES PER NODE for each primitive
// against ratcheted budgets (memory-budgets.json) — bump a budget in the
// same PR that deliberately grows a node, and say why.
//
// Method: allocate N nodes retained in a pre-sized array, GC-fence both
// sides, take the min of REPS runs (mins are stable under GC jitter; the
// retaining array's own slot cost is subtracted). Requires --expose-gc.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(__dirname, "../dist/prod/index.js");
const target = process.env.MEM_TARGET ?? dist;
const { createSignal, createMemo, createEffect, createRoot, createStore, flush } = await import(
  target
);

if (typeof globalThis.gc !== "function") {
  console.error("memory-overhead: run with --expose-gc");
  process.exit(1);
}

const N = 100_000;
const REPS = 5;

function settleHeap() {
  globalThis.gc();
  globalThis.gc();
  return process.memoryUsage().heapUsed;
}

// Bytes per node for `build(hold, n)` which pushes n retained units into
// `hold`. The retaining array is pre-sized OUTSIDE the measured window and
// its 8 B/slot pointer cost subtracted.
function bytesPerNode(build) {
  let best = Infinity;
  for (let r = 0; r < REPS; r++) {
    const hold = new Array(N);
    // Shape warmup outside the window: first allocations pay one-time
    // hidden-class transitions and IC setup.
    const warm = new Array(1000);
    build(warm, 1000);
    const before = settleHeap();
    build(hold, N);
    const after = settleHeap();
    const per = (after - before) / N - 8;
    if (per < best) best = per;
  }
  return best;
}

const scenarios = {
  // Signal pair: one signal node + its bound setter closure — the shape the
  // stage-3 literal diet minimized.
  signal: (hold, n) => {
    for (let i = 0; i < n; i++) hold[i] = createSignal(i);
  },
  // Computed under a root, read once (initialized graph node, one source
  // edge to a shared signal).
  memo: (hold, n) => {
    const [s] = createSignal(1);
    createRoot(() => {
      for (let i = 0; i < n; i++) {
        const m = createMemo(() => s());
        m();
        hold[i] = m;
      }
    });
    flush();
  },
  // Effect + its owner slot (the zombie-pair/_x split surface): one source
  // edge, compute + effect phases. createEffect returns void — the nodes are
  // retained through the ROOT's owner chain, so the root's dispose handle is
  // what `hold` keeps (slot 0; the per-node divisor still amortizes it away).
  effect: (hold, n) => {
    const [s] = createSignal(1);
    hold[0] = createRoot(dispose => {
      for (let i = 0; i < n; i++) {
        createEffect(
          () => s(),
          () => {}
        );
      }
      return dispose;
    });
    hold[1] = s;
    flush();
  },
  // Owner scope (createRoot without disposal).
  owner: (hold, n) => {
    for (let i = 0; i < n; i++) hold[i] = createRoot(() => ({}));
  },
  // Store per-record target: one wrapped record read through the proxy —
  // TargetShape (pre-shaped constructor, pc/hv/ht slots) + proxy + node map
  // amortized. The record objects themselves are the +72 B baseline the
  // subtraction constant below removes (measured separately as `rawRecord`).
  storeRecord: (hold, n) => {
    const rows = new Array(n);
    for (let i = 0; i < n; i++) rows[i] = { id: i, a: 1, b: 2 };
    const [state] = createStore({ rows });
    // Touch each record so its target + proxy exist (lazy wrap).
    for (let i = 0; i < n; i++) hold[i] = state.rows[i];
  },
  // Raw-record control for storeRecord: the same rows WITHOUT wrapping.
  rawRecord: (hold, n) => {
    for (let i = 0; i < n; i++) hold[i] = { id: i, a: 1, b: 2 };
  }
};

const budgets = JSON.parse(readFileSync(path.join(__dirname, "memory-budgets.json"), "utf8"));

let failed = false;
const results = {};
for (const [name, build] of Object.entries(scenarios)) {
  const bytes = Math.round(bytesPerNode(build));
  results[name] = bytes;
  const budget = budgets[name];
  if (budget === undefined) {
    console.log(`  ${name}: ${bytes} B/node (no budget — add one)`);
    failed = true;
    continue;
  }
  const status = bytes <= budget ? "ok" : "OVER BUDGET";
  if (bytes > budget) failed = true;
  console.log(`  ${name}: ${bytes} B/node (budget ${budget}) ${status}`);
}

// storeRecord is reported net of the raw record baseline for readability.
console.log(
  `  (storeRecord net of raw record: ${results.storeRecord - results.rawRecord} B/node wrap overhead)`
);

if (failed) {
  console.error(
    "\nmemory-overhead: budget exceeded — a node literal grew. If deliberate, " +
      "bump memory-budgets.json in the same PR and document why."
  );
  process.exit(1);
}
console.log("memory-overhead: all budgets hold");
