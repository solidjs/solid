import nodeResolve from "@rollup/plugin-node-resolve";
import common from "@rollup/plugin-commonjs";
import babel from "rollup-plugin-babel";

export default [{
  input: "example/src/server.js",
  output: [
    {
      dir: "example/lib",
      format: "cjs"
    }
  ],
  external: ["solid-js", "solid-js/dom", "../.."],
  plugins:  [
    nodeResolve({ preferBuiltins: true }),
    babel({
      presets: [["solid", { generate: "ssr", hydratable: true }]]
    }),
    common()
  ]
}, {
  input: "example/src/index.js",
  output: [
    {
      dir: "example/public/js",
      format: "esm"
    }
  ],
  plugins:  [
    nodeResolve(),
    babel({
      presets: [["solid", { generate: "dom", hydratable: true }]]
    }),
    common()
  ]
}];
