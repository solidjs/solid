import { defineConfig } from "vite";
// Exercises the current @solidjs/vite-plugin pipeline: native JSX compiler by
// default, native lazy/refresh passes, solid-js/refresh HMR runtime.
import solid from "@solidjs/vite-plugin";

export default defineConfig({
  plugins: [solid()],
  server: { port: 3002 },
  preview: { port: 3002 }
});
