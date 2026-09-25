import { fileURLToPath } from "node:url";
import type { ServerResponse } from "node:http";
import { defineConfig, type Plugin } from "vite";
import solid from "@solidjs/vite-plugin";
import basicSsl from "@vitejs/plugin-basic-ssl";

// HTTP/2 in dev. Live sources hold a connection each and a browser allows
// six per origin under HTTP/1.1; Vite speaks HTTP/2 when `server.https` is
// set (self-signed here). `HTTPS=0 pnpm dev` turns it off to see the dev
// warning the runtime prints past five open live connections.
const https = process.env.HTTPS !== "0";

// The chaos switch. The dev server remembers every open server-function
// response — live ones at `/_server/live/…`, plain streamed ones at
// `/_server/data/…` — and `POST /__chaos/drop` destroys each of them
// mid-body, the way a proxy timeout, a redeploy, or a dropped radio would.
// Declared live sources read that as a death and reconnect with position;
// an undeclared stream rejects its reader. Dev only: the production harness
// (server.js) has no such route.
function chaos(): Plugin {
  const open = new Set<ServerResponse>();
  return {
    name: "room:chaos",
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url || "";
        if (url === "/__chaos/drop") {
          const count = open.size;
          for (const r of open) r.destroy();
          open.clear();
          res.setHeader("content-type", "text/plain");
          res.end(`dropped ${count}`);
          return;
        }
        if (url.startsWith("/_server/live/") || url.startsWith("/_server/data/")) {
          open.add(res);
          res.on("close", () => open.delete(res));
        }
        next();
      });
    }
  };
}

export default defineConfig({
  resolve: {
    alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) }
  },
  server: { port: 3010, https: https ? {} : undefined },
  plugins: [
    chaos(),
    ...(https ? [basicSsl()] : []),
    solid({
      start: {},
      ssr: true,
      serverFunctions: { components: true, configure: "src/server-config.ts" }
    })
  ]
});
