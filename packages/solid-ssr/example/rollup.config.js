import nodeResolve from "@rollup/plugin-node-resolve";
import common from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import babel from "rollup-plugin-babel";

const plugins = [
  nodeResolve(),
  babel({
    presets: [["solid", { generate: "ssr" }]]
  }),
  common(),
  json(),
];

export default {
  input: "example/src/index.js",
  output: [
    {
      file: "example/lib/index.js",
      format: "cjs"
    }
  ],
  external: ["solid-js", "solid-js/dom", "../../register"],
  plugins
};
