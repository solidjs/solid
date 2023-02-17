import * as esbuild from "esbuild";
import { replace } from "esbuild-plugin-replace";

esbuild.build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  format: "esm",
  outfile: "dist/index.js",
  mangleProps: /_/,
  plugins: [
    replace({
      __DEV__: "false",
      __TEST__: "false"
    }),
  ],
});

esbuild.build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  format: "cjs",
  outfile: "dist/index.cjs",
  mangleProps: /_/,
  plugins: [
    replace({
      __DEV__: "false",
      __TEST__: "false"
    }),
  ],
});
