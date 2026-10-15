import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import solid from "@solidjs/vite-plugin";

// Turnkey SSR: `start: {}` (with `ssr: true`) generates the entries and the
// serving layer around src/app.tsx; `serverFunctions` serves the `/_server`
// endpoint that src/server/reply.ts answers on.
//
// In dev the plugin couples a client that goes away to the request's
// `signal` — that is what `reply` forwards to the model. server.js does the
// same for production.
export default defineConfig({
  resolve: {
    alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) }
  },
  server: { port: 3012 },
  plugins: [solid({ start: {}, ssr: true, serverFunctions: true })]
});
