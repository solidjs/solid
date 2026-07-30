import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

// The same turnkey setup as ../hackernews, plus the one piece a read-only app
// never needs: `serverFunctions.configure` names a module evaluated in the
// server-function handler graph, where this app registers the router's
// single-flight collector. With it, a mutation's response carries the
// redirect, the invalidated data, AND the invalidated server-component
// markup in one round trip.
export default defineConfig({
  resolve: {
    alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) }
  },
  server: { port: 3006 },
  plugins: [
    solid({
      ssr: {},
      serverFunctions: { components: true, configure: "src/server-config.ts" }
    })
  ]
});
