import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "./client.js";
import { generate } from "./generate.js";
import type { RunResult } from "./runner.js";

function semanticResult({ metrics, error, ...result }: RunResult) {
  // Worker heap, timings and stack locations are diagnostic, not semantics.
  return {
    ...result,
    error: error?.split("\n")[0],
    metrics: {
      operations: metrics.operations,
      skipped: metrics.skipped,
      requests: metrics.requests,
      frames: metrics.frames
    }
  };
}
test("fresh and reused workers agree per case across observation and action cohorts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "solid-fuzz-isolation-"));
  const file = join(dir, "worker.mjs");
  const reused = new Client(file);
  const fresh = new Client(file, 5000, true);
  try {
    await build({
      entryPoints: [fileURLToPath(new URL("./worker.ts", import.meta.url))],
      outfile: file,
      bundle: true,
      platform: "node",
      format: "esm",
      define: { __DEV__: "true", __OBSERVE__: "true", __TEST__: "true" }
    });
    for (const cohort of ["ordinary", "optimistic", "mounts", "branch-boundaries"] as const)
      for (const scenario of generate(3289, 12, cohort)) {
        const a = await reused.run(scenario);
        const b = await fresh.run(scenario);
        expect(semanticResult(a)).toEqual(semanticResult(b));
      }
  } finally {
    await reused.close();
    await fresh.close();
    await rm(dir, { recursive: true, force: true });
    reused.checkHealth();
    fresh.checkHealth();
  }
}, 20000);
