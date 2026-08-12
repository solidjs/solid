/// <reference types="vitest" />

import { defineConfig } from "vitest/config";
// Test JSX compiles with the native Rust compiler by default;
// `JSX_COMPILER=babel` switches to the Babel transform for A/B.
import solidPlugin from "@solidjs/vite-plugin";

const compiler = process.env.JSX_COMPILER === "babel" ? "babel" : "native";
import { resolve } from "path";

const rootDir = resolve(__dirname);

export default defineConfig({
  plugins: [solidPlugin({ compiler })],
  define: {
    __DEV__: "true",
    __TEST__: "true"
  },
  test: {
    environment: "jsdom",
    pool: "threads",
    globals: true,
    exclude: ["**/node_modules/**"]
  },
  resolve: {
    conditions: ["development", "browser"],
    alias: {
      "@solidjs/signals": [resolve(rootDir, "../solid-signals/src")],
      "solid-js": [resolve(rootDir, "../solid/src")],
      rxcore: [resolve(rootDir, "../solid-web/src/core")],
      "@solidjs/web": [resolve(rootDir, "../solid-web/src")]
    }
  }
});
