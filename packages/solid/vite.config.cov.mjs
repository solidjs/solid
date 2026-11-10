// Scratch (not committed): solid's config with @solidjs/signals from SOURCE for the unreached-arm inventory.
import { mergeConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import base from "./vite.config.mjs";
const rootDir = dirname(fileURLToPath(import.meta.url));
const sig = p => resolve(rootDir, "../signals/src", p);
export default mergeConfig(base, {
  define: { __DEV__: "true", __OBSERVE__: "true", __TEST__: "false" },
  resolve: { alias: { "@solidjs/signals/attribution": sig("attribution.ts"), "@solidjs/signals": sig("index.ts") } },
  test: { coverage: { provider: "v8", reporter: ["json"], allowExternal: true, include: ["**/packages/signals/src/**/*.ts"], exclude: [] } }
});
