import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests run against the signals source (not dist) so the harness can be
// developed without a build step; __DEV__/__TEST__ mirror the signals suite.
export default defineConfig({
  define: {
    __DEV__: "true",
    __OBSERVE__: "true",
    __TEST__: "true"
  },
  resolve: {
    // Array form: entries match in order, and the bare package alias would
    // otherwise swallow the `/attribution` subpath as a prefix match.
    alias: [
      {
        find: "@solidjs/signals/attribution",
        replacement: fileURLToPath(new URL("../signals/src/attribution.ts", import.meta.url))
      },
      {
        find: "@solidjs/signals",
        replacement: fileURLToPath(new URL("../signals/src/index.ts", import.meta.url))
      }
    ]
  },
  test: {
    globals: true,
    dir: "./tests",
    pool: "threads"
  }
});
