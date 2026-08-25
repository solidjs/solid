import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests run against the signals source (not dist) so the harness can be
// developed without a build step; __DEV__/__TEST__ mirror the signals suite.
export default defineConfig({
  define: {
    __DEV__: "true",
    __TEST__: "true"
  },
  resolve: {
    alias: {
      "@solidjs/signals": fileURLToPath(new URL("../signals/src/index.ts", import.meta.url))
    }
  },
  test: {
    globals: true,
    dir: "./tests",
    pool: "threads"
  }
});
