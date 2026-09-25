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
 * ratio is what is capped. Three enabled postures, cheapest first:
 *
 * - lean — nobody wants re-run records (no listener, fold or log): the engine
 *   runs its checks off the raw facts and builds no `RerunEvent`;
 * - listened — a `rerun` subscriber on the records channel: the record is
 *   built, kept and delivered;
 * - folded — the `costs`/`feedback` folds loaded as well, as a consumer that
 *   imports the `attribution` entry has them. The cap is on this one; the
 *   other two are measured for the failure message.
 *
 * The engine is imported from its core module, not the entry, so the folds
 * (which register on import) arrive only when the test loads them.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

type Tier = typeof import("../src/index.js");
type Engine = typeof import("../src/core/attribution.js");

const here = dirname(fileURLToPath(import.meta.url));
const OBSERVE = resolve(here, "../dist/observe/index.js");
const ENGINE = resolve(here, "../dist/observe/core/attribution.js");
const FOLDS = ["attribution-costs", "attribution-feedback"].map(m =>
  resolve(here, `../dist/observe/core/${m}.js`)
);

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
      const records = tier.OBSERVE!.records;
      /** The engine enabled with defaults; `listened` adds a no-op `rerun` subscriber. */
      const enabled = (listened: boolean): number => {
        const off = listened ? records.subscribe("rerun", () => {}) : () => {};
        const release = attribution.enable({ log: false });
        try {
          return workload(tier, N, K);
        } finally {
          release();
          off();
        }
      };
      /** Best-of-5 of the idle workload against one enabled posture. */
      const measure = (listened: boolean) => {
        let idleMs = Infinity;
        let enabledMs = Infinity;
        for (let i = 0; i < 5; i++) {
          idleMs = Math.min(idleMs, workload(tier, N, K));
          enabledMs = Math.min(enabledMs, enabled(listened));
        }
        return {
          ratio: enabledMs / idleMs,
          detail: `${(enabledMs / idleMs).toFixed(2)}x (${enabledMs.toFixed(1)}ms / idle ${idleMs.toFixed(1)}ms)`
        };
      };
      workload(tier, N, 2);
      enabled(true);

      // Nobody listening: no RerunEvent, no ring-buffer push, no delivery.
      // The checks still run on the causes every run collects, and the run is
      // timed, so this is not free. Then a subscriber: the record is built,
      // kept and delivered — the cost the lean gate spares. Both are measured
      // for the failure message; the functional gate is pinned in
      // attribution-lean-gate.test.ts, and the margin between the two is
      // within this harness's noise.
      const lean = measure(false);
      const listened = measure(true);

      // The folds, as a consumer of the `attribution` entry has them from
      // import; from here on every re-run is folded into the cost and
      // feedback tables as well.
      //
      // Baseline, measured 2026-09-24 (M-series, this file under vitest, six
      // runs, dist/observe at #3644 + #3646): folded 1.98–2.14x, listened
      // 1.91–2.11x, lean 1.71–1.90x (idle ~6.2–7.0ms / 5,000 re-runs; the
      // engine ~13–14ms folded). The #3613 engine, re-measured by this
      // harness the same day beside this one, was ~2.5–2.8x; its ~9.5–10x
      // figure of 2026-09-23 came from a different, flush-per-write
      // micro-harness and is not comparable — this harness's numbers are
      // the baseline from here. The ratio is harness-sensitive in the other direction too: a
      // bare `node` process (no vitest transform in the worker) measures
      // idle at ~2.8ms and the folded engine at ~3.1–3.7x, so a faster idle
      // build raises the ratio without the engine changing.
      //
      // Cap 4: ~85–100% headroom over the folded baseline — trips when the
      // engine costs roughly double what it does today per re-run, the same
      // discipline as observe-idle-cost's 1.25 over a 1.03–1.09 baseline.
      // A check that grew a map lookup or a clock read on the hot path
      // moves the ratio by a few percent, a record that grew a per-run
      // allocation by more; both stay under this until they compound. This
      // is the ratchet the #3613 cap (14, against the old ~10) asked for
      // once the lean-posture work landed (#3644; see the Lean posture
      // section of documentation/plans/responsiveness-findings-plan.md).
      for (const fold of FOLDS) await import(fold);
      const CAP = 4;
      let best = Infinity;
      let detail = "";
      for (let round = 0; round < 3 && best >= CAP; round++) {
        const folded = measure(true);
        if (folded.ratio < best) {
          best = folded.ratio;
          detail = `folded ${folded.detail}; listened ${listened.detail}; lean ${lean.detail}`;
        }
      }
      expect(best, detail).toBeLessThan(CAP);
    } finally {
      console.warn = warn;
      console.info = info;
    }
  }, 60_000);
});
