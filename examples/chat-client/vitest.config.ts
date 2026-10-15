import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import solid from "@solidjs/vite-plugin";

// The acceptance test runs the view against the server function in-process:
// without `serverFunctions`, `"use server"` is left alone and `reply` is a
// plain async generator, so the fake model streams straight into the
// projection, under jsdom, with the dev channels @solidjs/diagnostics reads.
export default defineConfig({
  resolve: {
    alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) },
    conditions: ["development", "browser"]
  },
  plugins: [solid()],
  test: { environment: "jsdom", dir: "test" }
});
