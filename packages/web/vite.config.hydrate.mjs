/// <reference types="vitest" />

import { configDefaults, defineConfig } from "vitest/config";
// Test JSX compiles with the native Rust compiler by default;
// `JSX_COMPILER=babel` switches to the Babel transform for A/B.
import solidPlugin from "@solidjs/vite-plugin";

const compiler = process.env.JSX_COMPILER === "babel" ? "babel" : "native";
import { resolve } from "path";
// `LOWER_SHOW=1` compiles with `<Show>` lowered to a ternary, as production
// builds do (dev builds keep the component).
const lowerShow = process.env.LOWER_SHOW === "1" ? { lowerShow: true } : {};
// #4087 replays a hand-recorded server stream whose `_hk` keys come from the
// `<Show>` tree; lowered client code numbers its nodes differently, so the
// spec only means something on the default (unlowered) run.
const LOWERED_SKIP =
  process.env.LOWER_SHOW === "1"
    ? ["test/hydration/streamed-fragment-lazy-assets-4087.spec.tsx"]
    : [];

const rootDir = resolve(__dirname);

export default defineConfig({
  // hot: false — solid-refresh wraps top-level components (e.g. the shared
  // parity-harness scenarios) in HMR wrappers that add owners and break
  // hydration id parity.
  plugins: [
    solidPlugin({ compiler, hot: false, solid: { dev: true, hydratable: true, ...lowerShow } })
  ],
  test: {
    environment: "jsdom",
    pool: "threads",
    globals: true,
    // test/consistency: the frames/hydration consistency contract's pins and
    // property harness (documentation/server-components/frames-consistency-
    // contract.md). Hydratable + dev is the superset posture every pin needs
    // (claims, `_hk` keys, the dev findings the oracle listens for); the pins
    // that never hydrate run unchanged under it. The harness's generated
    // campaign is opt-in: CONSISTENCY_FUZZ=1 (see harness/README.md).
    include: ["test/hydration/**/*.spec.tsx", "test/consistency/**/*.spec.tsx"],
    exclude: [...configDefaults.exclude, ...LOWERED_SKIP],
    setupFiles: ["test/setup-frames-eager.ts"]
  },
  resolve: {
    conditions: ["development", "browser"],
    alias: {
      // Subpaths first: aliases match by prefix in order, so the bare
      // "@solidjs/web" entry below would otherwise swallow them. Specs that
      // pull in frames/src/client.ts (which imports the shared server-function
      // client) need these to resolve to source, like the entry itself.
      "@solidjs/web/server-functions/client": resolve(rootDir, "server-functions/src/client.ts"),
      // The frames client lazy-imports the codec through the packaged
      // specifiers (external in its dist build); route them to the runtime
      // source so specs get the same single instance as the client itself.
      "@solidjs/web/serialization/decode": resolve(
        rootDir,
        "serialization/src/serializer-decode.ts"
      ),
      "@solidjs/web/serialization": resolve(rootDir, "serialization/src/serializer.ts"),
      // The frames client's tiers (lazy, through the packaged specifiers) —
      // to the source, for the same single-instance reason.
      "@solidjs/web/frames/trace": resolve(rootDir, "frames/src/trace-tier.ts"),
      "@solidjs/web/frames/regions": resolve(rootDir, "frames/src/regions-tier.ts"),
      "@solidjs/web/frames/assets": resolve(rootDir, "frames/src/assets-tier.ts"),
      "@solidjs/web/frames/wire": resolve(rootDir, "frames/src/wire-tier.ts"),
      "@solidjs/web": resolve(rootDir, "src/index.ts")
    }
  }
});
