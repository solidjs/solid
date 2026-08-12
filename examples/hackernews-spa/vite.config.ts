import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import solid from "@solidjs/vite-plugin";

// Turnkey SSR: `start: {}` (with `ssr: true`) generates the entries and the
// serving layer around src/app.tsx, so there is no entry-server, entry-client,
// or dev server script in this example. `serverFunctions` serves the
// `/_server` endpoint the `"use server"` modules dispatch through.
//
// The server-components twin (../hackernews) is this same config plus
// `serverFunctions: { components: true }` — that one flag is the whole
// difference in wiring between the two apps.
export default defineConfig({
  resolve: {
    alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) }
  },
  server: { port: 3005 },
  plugins: [solid({ start: {}, ssr: true, serverFunctions: true })]
});
