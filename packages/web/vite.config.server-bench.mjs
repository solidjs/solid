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
    // Vitest compiles with `dev: true`, and `sourceNames` follows `dev` in
    // both compilers — which, for SSR output, keeps `createComponent(Comp,
    // props, "Name")` in place of the inlined `Comp(props)` so the dev/observe
    // runtime can run each component under a labelled transparent owner.
    // That owner is the diagnostics tier's cost, not the SSR runtime cost
    // this lane tracks (search-results: 50 items is ~24% of the render under
    // CodSpeed). Pinned off so the lane keeps measuring the production
    // component shape the way it did before the default followed `dev`.
    solidPlugin({ compiler, solid: { generate: "ssr", hydratable: true, sourceNames: false } }),
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
      "@solidjs/web": resolve(rootDir, "src/index.server.ts"),
      // Before "solid-js": a string alias prefix-matches its subpaths.
      "solid-js/internal": resolve(rootDir, "../solid/src/internal.ts"),
      "solid-js": resolve(rootDir, "../solid/src/server/index.ts")
    }
  }
});
