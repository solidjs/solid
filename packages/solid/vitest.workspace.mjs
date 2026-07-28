import { defineWorkspace } from "vitest/config";
import { resolve } from "path";

export default defineWorkspace([
  "./vite.config.mjs",
  // SSR tests: the default config resolves `solid-js` to the client sources,
  // so the server entries get their own project.
  {
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
  }
]);
