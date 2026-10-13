import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import solid from "@solidjs/vite-plugin";
import basicSsl from "@vitejs/plugin-basic-ssl";

// HTTP/2 in dev. An open thread holds a connection, and a browser allows six
// per origin under HTTP/1.1 — a few tabs would use them up. Vite speaks
// HTTP/2 when `server.https` is set (self-signed here); `HTTPS=0 pnpm dev`
// turns it off.
const https = process.env.HTTPS !== "0";

// `serverFunctions.components` lets a `"use server"` function answer with a
// component; `configure` names the module that registers the router's flight
// collector (src/server-config.ts).
export default defineConfig({
  resolve: {
    alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) }
  },
  server: { port: 3009, https: https ? {} : undefined },
  plugins: [
    ...(https ? [basicSsl()] : []),
    solid({
      start: {},
      ssr: true,
      serverFunctions: { components: true, configure: "src/server-config.ts" }
    })
  ]
});
