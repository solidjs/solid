/// <reference types="vitest" />

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    deps: { registerNodeLoader: true },
    threads: false,
    isolate: false,
    globals: true,
    exclude: ["**/node_modules/**"]
  },
  resolve: {
    conditions: ["development", "browser"]
  }
});
