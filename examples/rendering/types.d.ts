// Local copy of @solidjs/vite-plugin's `virtual-solid-manifest.d.ts` declaration
// (the subpath .d.ts isn't reachable under moduleResolution "Bundler" because
// the plugin's `exports` map only exposes the package root).
declare module "virtual:solid-manifest" {
  import type { ViteManifest } from "@solidjs/vite-plugin";
  const manifest: ViteManifest;
  export default manifest;
}
