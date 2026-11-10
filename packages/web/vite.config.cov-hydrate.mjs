// Scratch (not committed): the default web config with @solidjs/signals
// resolved to its SOURCE, so V8 coverage from the web suites lands on the
// same src lines as the signals suite's (the unreached-arm inventory).
import { mergeConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import base from "./vite.config.hydrate.mjs";
const rootDir = dirname(fileURLToPath(import.meta.url));
const sig = p => resolve(rootDir, "../signals/src", p);
export default mergeConfig(base, {
  define: { __DEV__: "true", __OBSERVE__: "true", __TEST__: "false" },
  resolve: {
    alias: {
      "@solidjs/signals/attribution": sig("attribution.ts"),
      "@solidjs/signals": sig("index.ts")
    }
  },
  test: {
    coverage: {
      provider: "v8",
      reporter: ["json"],
      allowExternal: true,
      include: ["**/packages/signals/src/**/*.ts"],
      exclude: []
    }
  }
});
