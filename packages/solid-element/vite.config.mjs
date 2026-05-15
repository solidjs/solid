/// <reference types="vitest" />

import { defineConfig } from "vitest/config";
import solidPlugin from "vite-plugin-solid";
import { resolve } from "path";

const rootDir = resolve(__dirname);

export default defineConfig({
  plugins: [solidPlugin()],
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
