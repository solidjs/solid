// Measurement half of observe-idle-cost.test.ts. Runs in a worker thread so
// Node loads the built artifacts itself: inside the test runner they would go
// through vite's SSR transform, which rewrites every cross-module import of
// the module-preserving builds into a namespace-object property load — a
// cost apps never pay, larger than the one under measurement, and not the
// same for both tiers.
import { parentPort, workerData } from "node:worker_threads";

const { prodUrl, observeUrl, N, K, warmup, pairs } = workerData;
const prod = await import(prodUrl);
const observe = await import(observeUrl);

// This thread's CPU time, in ms: time spent descheduled on a loaded runner
// is wall-clock noise, not cost. Wall clock where Node predates the API.
const clock = process.threadCpuUsage
  ? () => {
      const { user, system } = process.threadCpuUsage();
      return (user + system) / 1000;
    }
  : () => performance.now();

/**
 * A graph-heavy workload with no hooks installed: N chains of
 * signal → memo → memo → effect, then K write passes that touch every chain,
 * then teardown. Reads, writes, recomputes and effect runs cross the observe
 * wiring in the timed window; nothing observes.
 */
function workload(tier) {
  const { createEffect, createMemo, createRoot, createSignal, flush } = tier;
  let ms = 0;
  createRoot(dispose => {
    const setters = [];
    let sink = 0;
    for (let i = 0; i < N; i++) {
      const [a, setA] = createSignal(i);
      const b = createMemo(() => a() * 2);
      const c = createMemo(() => b() + 1);
      createEffect(
        () => c(),
        v => {
          sink += v;
        }
      );
      setters.push(setA);
    }
    flush();
    const start = clock();
    for (let k = 1; k <= K; k++) {
      for (let i = 0; i < N; i++) setters[i](i + k);
      flush();
    }
    ms = clock() - start;
    dispose();
    if (sink === Infinity) throw new Error("unreachable");
  });
  return ms;
}

// Paired samples: each pair runs the tiers back to back, alternating which
// goes first, so both halves of a pair see the same machine load and neither
// tier owns the slot after (say) a GC of the other's garbage.
function pair(i) {
  if (i % 2) {
    const o = workload(observe);
    return [workload(prod), o];
  }
  const p = workload(prod);
  return [p, workload(observe)];
}

for (let i = 0; i < warmup; i++) pair(i);
const prodMs = [];
const observeMs = [];
for (let i = 0; i < pairs; i++) {
  const [p, o] = pair(i);
  prodMs.push(p);
  observeMs.push(o);
}
parentPort.postMessage({
  observeDefined: observe.OBSERVE !== undefined,
  prodDefined: prod.OBSERVE !== undefined,
  prodMs,
  observeMs
});
