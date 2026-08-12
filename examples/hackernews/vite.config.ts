import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import solid from "@solidjs/vite-plugin";

// Identical to ../hackernews-spa/vite.config.ts except for one flag:
// `serverFunctions.components`. That flag is the entire wiring difference
// between the two apps — with it, a `"use server"` function that returns a
// component streams its markup over the server-function endpoint (and inlines
// it at document SSR) instead of returning JSON for the client to render.
//
// The turnkey `start` object is what makes it automatic: the plugin generates
// the client entry's `installServerComponents()` call, the server entry's
// render plugin, and the document bootstrap script. Nothing in src/ imports
// the frames runtime.
export default defineConfig({
  resolve: {
    alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) }
  },
  server: { port: 3004 },
  plugins: [solid({ start: {}, ssr: true, serverFunctions: { components: true } })]
});
