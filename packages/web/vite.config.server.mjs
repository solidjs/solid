/// <reference types="vitest" />

import { defineConfig } from "vitest/config";
// Test JSX compiles with the native Rust compiler by default;
// `JSX_COMPILER=babel` switches to the Babel transform for A/B.
import solidPlugin from "@solidjs/vite-plugin";

const compiler = process.env.JSX_COMPILER === "babel" ? "babel" : "native";
import { resolve } from "path";

const rootDir = resolve(import.meta.dirname);

export default defineConfig({
  plugins: [solidPlugin({ compiler, solid: { generate: "ssr", hydratable: true } })],
  test: {
    environment: "node",
    include: ["test/server/**/*.spec.tsx"],
    globals: true,
    pool: "threads",
  },
  resolve: {
    conditions: ["node"],
    alias: {
      "@solidjs/web/server-functions/server": resolve(rootDir, "server-functions/dist/server.js"),
      "@solidjs/web/server-functions/client": resolve(rootDir, "server-functions/dist/client.js"),
      "@solidjs/web/frames/server": resolve(rootDir, "frames/dist/server.js"),
      // the transport's lazy codec imports — without these the bare
      // "@solidjs/web" alias below swallows the subpath
      "@solidjs/web/serialization/decode": resolve(rootDir, "serialization/dist/decode.js"),
      "@solidjs/web/serialization": resolve(rootDir, "serialization/dist/serialization.js"),
      "@solidjs/web": resolve(rootDir, "src/index.server.ts"),
      "solid-js": resolve(rootDir, "../solid/src/server/index.ts"),
    }
  }
});
