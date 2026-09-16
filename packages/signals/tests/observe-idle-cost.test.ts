/**
 * The observe tier's idle cost — what a production observability build pays
 * with nothing subscribed and no engine installed — is a cap, not a number
 * to read off a benchmark. The wiring is a null check per hook site, a label
 * read, and an edge counter; every one of those runs on every write, read
 * and recompute of every app on the observe build, so a regression here
 * charges every consumer that opted into observability before any of them
 * turned a hook on.
 *
 * Relative tripwire, same discipline as heap-mark-incremental: absolute
 * wall-clock bounds do not survive CI, so the SAME workload runs against the
 * built prod and observe artifacts in one process, interleaved, best-of-k,
 * and the observe/prod ratio is what is capped. Both tiers see the same
 * machine load, and best-of-k picks the quiet run for each.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

type Tier = typeof import("../src/index.js");

// The built artifacts — what apps actually resolve. Gitignored, so the test
// skips when they haven't been built (run `pnpm build`); resolved paths rather
// than literal specifiers so the build's type pass doesn't try to find them.
const here = dirname(fileURLToPath(import.meta.url));
const PROD = resolve(here, "../dist/prod/index.js");
const OBSERVE = resolve(here, "../dist/observe/index.js");

/**
 * A graph-heavy workload with no hooks installed: N chains of
 * signal → memo → memo → effect, then K write passes that touch every chain,
 * then teardown. Reads, writes, recomputes, effect runs and creation all
 * cross the observe wiring; nothing observes.
 */
function workload(tier: Tier, N: number, K: number): number {
  const { createEffect, createMemo, createRoot, createSignal, flush } = tier;
  let ms = 0;
  createRoot(dispose => {
    const setters: ((v: number) => void)[] = [];
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
    const start = performance.now();
    for (let k = 1; k <= K; k++) {
      for (let i = 0; i < N; i++) setters[i](i + k);
      flush();
    }
    ms = performance.now() - start;
    dispose();
    if (sink === Infinity) throw new Error("unreachable");
  });
  return ms;
}

describe.skipIf(!existsSync(PROD) || !existsSync(OBSERVE))("observe tier idle cost", () => {
  test("no hooks installed: the observe artifact runs the same graph within the cap of prod", async () => {
    const prod = (await import(PROD)) as Tier;
    const observe = (await import(OBSERVE)) as Tier;
    expect((prod as any).OBSERVE).toBeUndefined();
    expect((observe as any).OBSERVE).toBeDefined();

    // ~15ms a sample locally; under a loaded CI worker a full three rounds
    // stays well inside the explicit timeout below.
    const N = 1000;
    const K = 10;
    // Warm both (JIT, allocator) before anything is timed.
    workload(prod, N, 2);
    workload(observe, N, 2);
    // Measured 2026-09-16 (M-series, five samples): 1.03–1.09 — the wiring
    // is 3–9% on a graph that does nothing but cross it. The cap trips when
    // the wiring costs ~3x what it does today (25%), which is the regression
    // this exists to catch — a hook site that stopped being a null check.
    // Noise: the suite runs this beside other files on worker
    // threads, so one tier can draw the busy slots; a round is best-of-k
    // interleaved, and a round over the cap is re-measured (a regression is
    // over the cap every round, contention is not).
    const CAP = 1.25;
    let best = Infinity;
    let detail = "";
    for (let round = 0; round < 3 && best >= CAP; round++) {
      let prodMs = Infinity;
      let observeMs = Infinity;
      for (let i = 0; i < 5; i++) {
        prodMs = Math.min(prodMs, workload(prod, N, K));
        observeMs = Math.min(observeMs, workload(observe, N, K));
      }
      const ratio = observeMs / prodMs;
      if (ratio < best) {
        best = ratio;
        detail = `observe ${observeMs.toFixed(1)}ms / prod ${prodMs.toFixed(1)}ms`;
      }
    }
    expect(best, detail).toBeLessThan(CAP);
  }, 60_000);
});
