import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import solid from "@solidjs/vite-plugin";

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
  // The devtools toolbar enters the graph through a virtual module, so Vite
  // only discovers it after the first optimize pass. Pre-including it keeps
  // dep optimization to a single pass — the late re-optimize can otherwise
  // pair chunks from different passes whose shared minified exports disagree.
  optimizeDeps: { include: ["@solidjs/vite-plugin > @solidjs/start-devtools"] },
  plugins: [
    solid({
      start: {},
      ssr: true,
      serverFunctions: { components: true, configure: "src/server-config.ts" }
    })
  ]
});
