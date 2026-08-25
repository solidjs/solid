/// <reference types="vitest" />

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    pool: "threads",
    globals: true,
    include: ["__tests__/**/*.test.js"],
    exclude: ["**/node_modules/**"]
  }
});
