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
 * built prod and observe artifacts in one worker thread, as paired samples,
 * and the median of the per-pair observe/prod ratios is what is capped. A
 * pair sees one machine load for both tiers, so contention largely cancels
 * within it; the median drops the pairs it doesn't.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { describe, expect, test } from "vitest";

// The built artifacts — what apps actually resolve. Gitignored, so the test
// skips when they haven't been built (run `pnpm build`); resolved paths rather
// than literal specifiers so the build's type pass doesn't try to find them.
const here = dirname(fileURLToPath(import.meta.url));
const PROD = resolve(here, "../dist/prod/index.js");
const OBSERVE = resolve(here, "../dist/observe/index.js");
const WORKER = resolve(here, "observe-idle-cost.worker.mjs");

type Samples = {
  observeDefined: boolean;
  prodDefined: boolean;
  prodMs: number[];
  observeMs: number[];
};

function measure(): Promise<Samples> {
  return new Promise((done, fail) => {
    const worker = new Worker(WORKER, {
      workerData: {
        prodUrl: pathToFileURL(PROD).href,
        observeUrl: pathToFileURL(OBSERVE).href,
        // ~13ms a sample locally; 2×(warmup + pairs) samples per round.
        N: 1000,
        K: 40,
        warmup: 5,
        pairs: 21
      }
    });
    worker.once("message", done);
    worker.once("error", fail);
  });
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];

describe.skipIf(!existsSync(PROD) || !existsSync(OBSERVE))("observe tier idle cost", () => {
  test("no hooks installed: the observe artifact runs the same graph within the cap of prod", async () => {
    // Measured 2026-10-05 (M-series, Node loading the artifacts directly):
    // median pair ratio 0.96–1.05. The cap trips when the wiring costs a
    // quarter of the graph's own work, which is the regression this exists
    // to catch — a hook site that stopped being a null check. For scale, a
    // WeakMap bump per write and per recompute reads 1.23–1.28.
    // Noise: the suite runs this beside other files on worker threads, so
    // the machine's load shifts under the measurement. Pairing cancels the
    // shift a pair sees, the median drops the outliers, and a round over
    // the cap is re-measured (a regression is over the cap every round,
    // contention is not).
    const CAP = 1.25;
    let best = Infinity;
    let detail = "";
    for (let round = 0; round < 3 && best >= CAP; round++) {
      const s = await measure();
      expect(s.prodDefined).toBe(false);
      expect(s.observeDefined).toBe(true);
      const ratio = median(s.observeMs.map((o, i) => o / s.prodMs[i]));
      if (ratio < best) {
        best = ratio;
        detail = `median pair ratio over ${s.prodMs.length} pairs; observe ${median(
          s.observeMs
        ).toFixed(1)}ms / prod ${median(s.prodMs).toFixed(1)}ms (medians)`;
      }
    }
    expect(best, detail).toBeLessThan(CAP);
  }, 60_000);
});
