import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Store-rewrite gate config: runs the unmodified suites with the store barrel
// aliased to src/store/next/test-index.ts, so legacy tests score the rewrite.
// Usage: pnpm vitest run --config vite.next.config.ts tests/store/createStore.test.ts
const shim = fileURLToPath(new URL("./src/store/next/test-full-index.ts", import.meta.url));

export default defineConfig({
  define: {
    __DEV__: "true",
    __TEST__: "true"
  },
  test: {
    globals: true,
    dir: "./tests",
    pool: "threads",
    // Tests import "../src/index.js" / "../../src/index.js"; route them to
    // the shim (which star-re-exports the real index and shadows the ported
    // pieces). The shim's own "../../index.js" import doesn't match the
    // pattern, so there is no cycle.
    alias: [{ find: /^(\.\.\/)+src\/index\.js$/, replacement: shim }]
  }
});
