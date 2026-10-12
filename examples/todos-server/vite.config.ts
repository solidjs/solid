import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import solid from "@solidjs/vite-plugin";

// The same setup as ../notes: `serverFunctions.components` streams a
// server component's markup over the server-function endpoint, and
// `serverFunctions.configure` registers the router's single-flight collector
// in the handler graph, so a mutation's response carries the list's fresh
// markup.
export default defineConfig({
  resolve: {
    alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) }
  },
  server: { port: 3010 },
  plugins: [
    solid({
      start: {},
      ssr: true,
      serverFunctions: { components: true, configure: "src/server-config.ts" }
    })
  ]
});
