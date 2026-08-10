/// <reference types="vitest" />

import { defineConfig } from "vitest/config";
// Test JSX compiles with the native Rust compiler by default;
// `JSX_COMPILER=babel` switches to the Babel transform for A/B.
import solidPlugin from "vite-plugin-solid";

const compiler = process.env.JSX_COMPILER === "babel" ? "babel" : "native";
import { resolve } from "path";

const rootDir = resolve(__dirname);

export default defineConfig({
  // hot: false — solid-refresh wraps top-level components (e.g. the shared
  // parity-harness scenarios) in HMR wrappers that add owners and break
  // hydration id parity.
  plugins: [solidPlugin({ compiler, hot: false, solid: { dev: true, hydratable: true } })],
  test: {
    environment: "jsdom",
    pool: "threads",
    globals: true,
    include: ["test/hydration/**/*.spec.tsx"]
  },
  resolve: {
    conditions: ["development", "browser"],
    alias: {
      rxcore: [resolve(rootDir, "../../packages/solid-web/src/core")],
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
        "../../node_modules/@dom-expressions/runtime/src/serializer-decode.js"
      ),
      "@solidjs/web/serialization": resolve(
        rootDir,
        "../../node_modules/@dom-expressions/runtime/src/serializer.js"
      ),
      "@solidjs/web": resolve(rootDir, "src/index.ts")
    }
  }
});
