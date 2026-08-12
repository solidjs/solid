import { defineConfig } from "vite";
// Exercises the current @solidjs/vite-plugin pipeline: native JSX compiler by
// default, native lazy/refresh passes, solid-js/refresh HMR runtime, and
// the built-in lazy() manifest handling (`virtual:solid-manifest`).
import solid from "@solidjs/vite-plugin";

export default defineConfig({
  root: import.meta.dirname,
  publicDir: "../shared/static",
  plugins: [solid({ ssr: true })],
  build: {
    // The plugin reads the client manifest from <root>/dist/client, so the
    // client build must use `--outDir dist/client` (see package.json).
    manifest: true,
    rollupOptions: {
      input: new URL("./client.tsx", import.meta.url).pathname
    }
  },
  server: { port: 3000 }
});
