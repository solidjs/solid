/// <reference types="vitest" />

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    pool: "threads",
    globals: true,
    include: ["__tests__/**/*.test.js"],
    exclude: ["**/node_modules/**"],
    setupFiles: process.env.SOLID_COMPILER_TEST_WASI ? ["./__tests__/force-wasi.js"] : []
  }
});
