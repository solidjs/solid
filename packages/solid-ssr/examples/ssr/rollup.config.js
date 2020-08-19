import nodeResolve from "@rollup/plugin-node-resolve";
import common from "@rollup/plugin-commonjs";
import babel from "@rollup/plugin-babel";

export default [{
  input: "examples/ssr/index.js",
  output: [
    {
      dir: "examples/ssr/lib",
      format: "cjs"
    }
  ],
  external: ["solid-js/server"],
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
      dir: "examples/ssr/public/js",
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
