/// <reference types="vitest" />

import { defineConfig } from "vitest/config";
import solidPlugin from "vite-plugin-solid";
import { resolve } from "path";

const rootDir = resolve(import.meta.dirname);

export default defineConfig({
  plugins: [solidPlugin({ solid: { generate: "ssr", hydratable: true } })],
  test: {
    environment: "node",
    include: ["test/server/**/*.spec.tsx"],
    globals: true,
    threads: false,
    isolate: false,
  },
  resolve: {
    conditions: ["node"],
    alias: {
      rxcore: resolve(rootDir, "src/core"),
      "@solidjs/web": resolve(rootDir, "server/index.ts"),
      "solid-js": resolve(rootDir, "../solid/src/server/index.ts"),
    }
  }
});
