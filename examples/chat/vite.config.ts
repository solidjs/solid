import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

// The same turnkey setup as ../hackernews: `ssr: {}` generates the entries
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
  plugins: [solid({ ssr: {}, serverFunctions: { components: true } })]
});
