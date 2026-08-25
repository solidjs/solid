/// <reference types="vitest" />

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    pool: "threads",
    globals: true,
    exclude: ["**/node_modules/**"]
  },
  resolve: {
    conditions: ["development", "browser"]
  }
});
