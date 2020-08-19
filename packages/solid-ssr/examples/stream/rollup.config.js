import nodeResolve from "@rollup/plugin-node-resolve";
import common from "@rollup/plugin-commonjs";
import babel from "@rollup/plugin-babel";

export default [{
  input: "examples/stream/index.js",
  output: [
    {
      dir: "examples/stream/lib",
      format: "cjs"
    }
  ],
  external: ["solid-js", "solid-js/server"],
  plugins:  [
    nodeResolve({ preferBuiltins: true }),
    babel({
      presets: [["solid", { generate: "ssr", hydratable: true }]]
    }),
    common()
  ]
}, {
  input: "examples/shared/index.js",
  output: [
    {
      dir: "examples/stream/public/js",
      format: "esm"
    }
  ],
  preserveEntrySignatures: false,
  plugins:  [
    nodeResolve(),
    babel({
      presets: [["solid", { generate: "dom", hydratable: true }]]
    }),
    common()
  ]
}];
