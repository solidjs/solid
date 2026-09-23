/**
 * The attribution engine's per-re-run cost — what a production observability
 * consumer pays once it holds the engine — is a cap, not a number to read
 * off a benchmark. Every check the engine grows runs on every re-run of
 * every app whose APM adapter enabled it, so a check that stopped being a
 * field read and a compare would charge every consumer at once, and nothing
 * else in the suite would notice.
 *
 * Relative tripwire, same discipline as observe-idle-cost: the SAME workload
 * runs on the built observe artifact with the engine idle and with it
 * enabled (defaults, log off), interleaved, best-of-k, and the enabled/idle
 * ratio is what is capped.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

type Tier = typeof import("../src/index.js");
type Engine = typeof import("../src/attribution.js");

const here = dirname(fileURLToPath(import.meta.url));
const OBSERVE = resolve(here, "../dist/observe/index.js");
const ENGINE = resolve(here, "../dist/observe/attribution.js");

/**
 * N chains of signal → memo → memo → effect, half of whose first memo
 * discards its input (a no-op run the equality gate stops), then K write
 * passes touching every chain. Named, as an app on the observe build is.
 */
function workload(tier: Tier, N: number, K: number): number {
  const { createEffect, createMemo, createRoot, createSignal, flush } = tier;
  let ms = 0;
  createRoot(dispose => {
    const setters: ((v: number) => void)[] = [];
    let sink = 0;
    for (let i = 0; i < N; i++) {
      const [a, setA] = createSignal(i, { name: `a${i}` });
      const b =
        i % 2 === 0
          ? createMemo(() => a() * 2, { name: `b${i}` })
          : createMemo(() => (a(), 1), { name: `w${i}` });
      const c = createMemo(() => b() + 1, { name: `c${i}` });
      createEffect(
        () => c(),
        v => {
          sink += v;
        },
        { name: `e${i}` }
      );
      setters.push(setA);
    }
    flush();
    const start = performance.now();
    for (let k = 1; k <= K; k++) {
      for (let i = 0; i < N; i++) setters[i](i + k * 7);
      flush();
    }
    ms = performance.now() - start;
    dispose();
    if (sink === Infinity) throw new Error("unreachable");
  });
  return ms;
}

describe.skipIf(!existsSync(OBSERVE) || !existsSync(ENGINE))("attribution engine cost", () => {
  test("engine enabled with defaults: a re-run costs within the cap of the idle observe build", async () => {
    const tier = (await import(OBSERVE)) as Tier;
    const { attribution } = (await import(ENGINE)) as Engine;
    const warn = console.warn;
    const info = console.info;
    console.warn = () => {};
    console.info = () => {};
    try {
      const N = 500;
      const K = 10;
      workload(tier, N, 2);
      const warmRelease = attribution.enable({ log: false });
      workload(tier, N, 2);
      warmRelease();
      // Measured 2026-09-23 (M-series, engine at #3613): ~9.5–10x — the
      // RerunEvent (causes, dep diffs, previews), the history ring buffer,
      // recordSubject, the six checks (~10% of the whole) and emitRecord.
      // The cap trips when the enabled engine costs ~40% more per re-run
      // than it does today; a check that grew a map lookup or a clock read
      // on the hot path moves this by a few percent, a record that grew a
      // per-run allocation by more. The lean-posture work in
      // documentation/plans/responsiveness-findings-plan.md is what would
      // bring the ratio DOWN; ratchet the cap when it lands.
      const CAP = 14;
      let best = Infinity;
      let detail = "";
      for (let round = 0; round < 3 && best >= CAP; round++) {
        let idleMs = Infinity;
        let enabledMs = Infinity;
        for (let i = 0; i < 5; i++) {
          idleMs = Math.min(idleMs, workload(tier, N, K));
          const release = attribution.enable({ log: false });
          try {
            enabledMs = Math.min(enabledMs, workload(tier, N, K));
          } finally {
            release();
          }
        }
        const ratio = enabledMs / idleMs;
        if (ratio < best) {
          best = ratio;
          detail = `enabled ${enabledMs.toFixed(1)}ms / idle ${idleMs.toFixed(1)}ms`;
        }
      }
      expect(best, detail).toBeLessThan(CAP);
    } finally {
      console.warn = warn;
      console.info = info;
    }
  }, 60_000);
});
