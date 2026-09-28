import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import solid from "@solidjs/vite-plugin";

// The same turnkey setup as ../hackernews: `serverFunctions.components` makes
// a `"use server"` function that returns a component stream its markup over
// the server-function endpoint (and inline it at document SSR). Nothing in
// src/ imports the frames runtime — the generated entries wire it.
export default defineConfig({
  resolve: {
    alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) }
  },
  server: { port: 3010 },
  plugins: [solid({ start: {}, ssr: true, serverFunctions: { components: true } })]
});
