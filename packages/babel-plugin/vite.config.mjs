/// <reference types="vitest" />

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    pool: "threads",
    globals: true,
    include: ["test/**/*.spec.js"],
    exclude: ["**/node_modules/**"]
  }
});
