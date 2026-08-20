import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import solid from "@solidjs/vite-plugin";

// The same turnkey setup as ../hackernews: `start: {}` generates the entries
// (client hydrate, server render, document shell from src/Document.tsx), and
// `serverFunctions.components` makes a `"use server"` function that returns a
// component stream its markup over the server-function endpoint. No router,
// no configure module — the chat surface is one page and every reply is a
// plain `dynamic()` over a server-component call.
export default defineConfig({
  resolve: {
    alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) }
  },
  server: { port: 3009 },
  // The devtools toolbar enters the graph through a virtual module, so Vite
  // only discovers it after the first optimize pass. Pre-including it keeps
  // dep optimization to a single pass — the late re-optimize can otherwise
  // pair chunks from different passes whose shared minified exports disagree.
  optimizeDeps: { include: ["@solidjs/vite-plugin > @solidjs/start-devtools"] },
  plugins: [solid({ start: {}, ssr: true, serverFunctions: { components: true } })]
});
