/// <reference types="vitest" />

import { defineConfig } from "vitest/config";
// Test JSX compiles with the native Rust compiler by default;
// `JSX_COMPILER=babel` switches to the Babel transform for A/B.
import solidPlugin from "@solidjs/vite-plugin";
import codspeedPlugin from "@codspeed/vitest-plugin";

const compiler = process.env.JSX_COMPILER === "babel" ? "babel" : "native";
import { resolve } from "path";

const rootDir = resolve(__dirname);

export default defineConfig({
  plugins: [solidPlugin({ compiler }), codspeedPlugin()],
  server: {
    port: 3000
  },
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["**/*.d.ts", "src/server/*.ts"]
    },
    environment: "jsdom",
    pool: "threads",
    globals: true,
    exclude: ["**/node_modules/**", "wip_tests/**", "test/server/**", "test/hydration/**"],
    // Bench mode reads `benchmark.exclude` separately from `test.exclude`.
    // Without this, `pnpm bench` would pick up the SSR Tier-1 benches under
    // the jsdom env + client-build aliases, which silently produces wrong
    // numbers (server build is loaded as client). SSR benches run via
    // `pnpm bench:server` against `vite.config.server-bench.mjs` instead.
    benchmark: {
      exclude: ["**/node_modules/**", "test/server/**", "test/hydration/**"]
    }
  },
  resolve: {
    conditions: ["development", "browser"],
    alias: {
      rxcore: [resolve(rootDir, "../../packages/solid-web/src/core")],
      // Keep the frame runtime and compiled references on one client instance.
      "@solidjs/web/server-functions/client": resolve(
        rootDir,
        "server-functions/src/client.js"
      ),
      // The frames client lazy-imports the codec through the packaged
      // specifiers (external in its dist build); route them to the runtime
      // source for the same one-instance reason as above.
      "@solidjs/web/serialization/decode": resolve(rootDir, "serialization/src/decode.ts"),
      "@solidjs/web/serialization": resolve(rootDir, "serialization/src/index.ts")
    }
  }
});
