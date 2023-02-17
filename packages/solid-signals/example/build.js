import * as esbuild from "esbuild";
import { replace } from "esbuild-plugin-replace";

await esbuild.build({
  entryPoints: ["example/basic.ts"],
  bundle: true,
  mangleProps: /_/,
  plugins: [
    replace({
      __DEV__: "false",
      __TEST__: "false"
    }),
  ],
});