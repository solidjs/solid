import { defineConfig } from "vitest/config";
import codspeedPlugin from "@codspeed/vitest-plugin";

// Vitest sets mode to "benchmark" for `vitest bench`. Benchmarks measure dev
// semantics but must not pay the __TEST__-only invariant machinery
// (per-write tracking + quiescence sweeps) — that cost regressed the whole
// CodSpeed suite by 5-21% when it ran under the test defines.
export default defineConfig(({ mode }) => ({
  plugins: [codspeedPlugin()],
  define: {
    __DEV__: "true",
    __TEST__: mode === "benchmark" ? "false" : "true"
  },
  test: {
    globals: true,
    dir: "./tests",
    pool: "threads"
  }
}));
