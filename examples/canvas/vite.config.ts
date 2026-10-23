import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import solid from "@solidjs/vite-plugin";
import basicSsl from "@vitejs/plugin-basic-ssl";

// HTTP/2 in dev. A live source holds a connection, and a browser allows six
// per origin under HTTP/1.1 — a tab of this canvas holds two, and a second
// tab plus every tab's pointer writes would run out.
// Vite speaks HTTP/2 when `server.https` is set (self-signed here);
// `HTTPS=0 pnpm dev` turns it off.
const https = process.env.HTTPS !== "0";

export default defineConfig({
  resolve: {
    alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) }
  },
  server: { port: 3014, https: https ? {} : undefined },
  plugins: [
    ...(https ? [basicSsl()] : []),
    solid({
      start: {},
      ssr: true,
      serverFunctions: { configure: "src/server-config.ts" }
    })
  ]
});
