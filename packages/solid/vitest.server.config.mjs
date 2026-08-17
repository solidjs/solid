import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    name: "server",
    environment: "node",
    include: ["test/server/**/*.spec.ts"],
    globals: true,
    server: { deps: { inline: [/dom-expressions/] } }
  },
  resolve: {
    conditions: ["node"],
    alias: {
      rxcore: resolve(__dirname, "web/src/core.ts"),
      "solid-js/web": resolve(__dirname, "web/server/index.ts"),
      "solid-js": resolve(__dirname, "src/server/index.ts")
    }
  }
});
