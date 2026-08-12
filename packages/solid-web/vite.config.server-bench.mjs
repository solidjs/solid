/// <reference types="vitest" />

// Tier-1 SSR-lane bench config. Mirrors `vite.config.server.mjs` (node
// environment, SSR-mode JSX compile, server-build aliases) but only picks up
// `*.bench.tsx` files in `test/server/`. Run via `pnpm bench:server`.

import { defineConfig } from "vitest/config";
// Test JSX compiles with the native Rust compiler by default;
// `JSX_COMPILER=babel` switches to the Babel transform for A/B.
import solidPlugin from "@solidjs/vite-plugin";

const compiler = process.env.JSX_COMPILER === "babel" ? "babel" : "native";
import codspeedPlugin from "@codspeed/vitest-plugin";
import { resolve } from "path";

const rootDir = resolve(import.meta.dirname);

export default defineConfig({
  plugins: [
    solidPlugin({ compiler, solid: { generate: "ssr", hydratable: true } }),
    codspeedPlugin()
  ],
  test: {
    environment: "node",
    include: ["test/server/**/*.bench.tsx"],
    globals: true,
    benchmark: {
      include: ["test/server/**/*.bench.tsx"],
      exclude: ["**/node_modules/**", "test/*.bench.tsx"]
    }
  },
  resolve: {
    conditions: ["node"],
    alias: {
      rxcore: resolve(rootDir, "src/core"),
      "@solidjs/web": resolve(rootDir, "server/index.ts"),
      "solid-js": resolve(rootDir, "../solid/src/server/index.ts")
    }
  }
});
