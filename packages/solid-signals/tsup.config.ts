import { defineConfig, type Options } from "tsup";

interface BundleOptions {
  dev?: boolean;
  node?: boolean;
}

function options({ dev, node }: BundleOptions): Options {
  return {
    entry: {
      [node ? "node" : dev ? "dev" : "prod"]: "src/index.ts",
    },
    outDir: "dist",
    treeshake: true,
    bundle: true,
    format: node ? "cjs" : "esm",
    // minify: true,
    platform: node ? "node" : "browser",
    target: node ? "node16" : "esnext",
    define: {
      __DEV__: dev ? "true" : "false",
      __TEST__: "false",
    },
    esbuildOptions(opts) {
      opts.mangleProps = !dev ? /^_/ : undefined;
    },
  };
}

export default defineConfig([
  options({ dev: true }), // dev
  options({ dev: false }), // prod
  options({ node: true }), // server
]);
