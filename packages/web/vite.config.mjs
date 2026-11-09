/// <reference types="vitest" />

import { defineConfig } from "vitest/config";
// Test JSX compiles with the native Rust compiler by default;
// `JSX_COMPILER=babel` switches to the Babel transform for A/B.
import solidPlugin from "@solidjs/vite-plugin";
import codspeedPlugin from "@codspeed/vitest-plugin";

const compiler = process.env.JSX_COMPILER === "babel" ? "babel" : "native";
import { resolve } from "path";
// `LOWER_SHOW=1` compiles with `<Show>` lowered to a ternary, as production
// builds do (dev builds keep the component).
const lowerShow = process.env.LOWER_SHOW === "1" ? { lowerShow: true } : {};
// Specs about the `<Show>` component's own dev behavior: the lowering removes
// the component, so these only mean something on the default (unlowered) run.
// - performance-tracks: folds a flow control's nodes into its `<Show>` label.
// - #4140: ASYNC_WATERFALL names the `<Show>` gate as a link in the chain.
const LOWERED_SKIP =
  process.env.LOWER_SHOW === "1"
    ? ["test/performance-tracks.spec.tsx", "test/frames-late-mount-waterfall-4140.spec.tsx"]
    : [];

const rootDir = resolve(__dirname);

// CI runs these in one CodSpeed job and everything else in another.
const LANE_1_BENCHES = [
  "test/frames-hydration-gather.bench.tsx",
  "test/dynamic-tag.bench.tsx",
  "test/replace-full.bench.tsx"
];
const BENCH_LANE = process.env.BENCH_LANE;

export default defineConfig({
  plugins: [solidPlugin({ compiler, solid: { ...lowerShow } }), codspeedPlugin()],
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
    setupFiles: [
      "test/setup-frames-eager.ts",
      // Reader-seat shadow (S0): the signals dist built with
      // SIGNALS_TEST_DEFINE=true records per-file mismatches when
      // SEAT_SHADOW_REPORT=<file> is set.
      ...(process.env.SEAT_SHADOW_REPORT
        ? [resolve(rootDir, "../signals/tests/setup/seat-shadow-report.ts")]
        : [])
    ],
    exclude: [
      "**/node_modules/**",
      "wip_tests/**",
      "test/server/**",
      "test/hydration/**",
      // The consistency contract's pins run under vite.config.hydrate.mjs.
      "test/consistency/**",
      ...LOWERED_SKIP
    ],
    // Bench mode reads `benchmark.exclude` separately from `test.exclude`.
    // Without this, `pnpm bench` would pick up the SSR Tier-1 benches under
    // the jsdom env + client-build aliases, which silently produces wrong
    // numbers (server build is loaded as client). SSR benches run via
    // `pnpm bench:server` against `vite.config.server-bench.mjs` instead.
    benchmark: {
      ...(BENCH_LANE === "1" ? { include: LANE_1_BENCHES } : {}),
      exclude: [
        "**/node_modules/**",
        "test/server/**",
        "test/hydration/**",
        "test/consistency/**",
        ...(BENCH_LANE === "2" ? LANE_1_BENCHES : [])
      ]
    }
  },
  resolve: {
    conditions: ["development", "browser"],
    alias: {
      // frames/src/client.ts configures the SHARED server-function client
      // through the packaged specifier (kept external in its dist build).
      // The frames specs stub fetch/createServerReference against the
      // runtime SOURCE, so route the specifier to that same module — one
      // instance, like every from-source consumer of this seam.
      "@solidjs/web/server-functions/client": resolve(rootDir, "server-functions/src/client.ts"),
      "@solidjs/web/serialization/decode": resolve(
        rootDir,
        "serialization/src/serializer-decode.ts"
      ),
      "@solidjs/web/serialization": resolve(rootDir, "serialization/src/serializer.ts"),
      // The frames client's tiers, lazy-imported through the packaged
      // specifiers (external in their dist builds); route them to the
      // source so a tier installs into the same client instance the specs
      // drive.
      "@solidjs/web/frames/trace": resolve(rootDir, "frames/src/trace-tier.ts"),
      "@solidjs/web/frames/regions": resolve(rootDir, "frames/src/regions-tier.ts"),
      "@solidjs/web/frames/assets": resolve(rootDir, "frames/src/assets-tier.ts"),
      "@solidjs/web/frames/wire": resolve(rootDir, "frames/src/wire-tier.ts")
    }
  }
});
