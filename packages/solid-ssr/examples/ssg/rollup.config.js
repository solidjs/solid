import nodeResolve from "@rollup/plugin-node-resolve";
import common from "@rollup/plugin-commonjs";
import babel from "@rollup/plugin-babel";

export default [{
  input: "examples/ssg/index.js",
  output: [
    {
      dir: "examples/ssg/lib",
      format: "cjs"
    }
  ],
  external: ["solid-js", "solid-js/dom", "../.."],
  plugins:  [
    nodeResolve({ preferBuiltins: true }),
    babel({
      presets: [["solid", { generate: "ssr", hydratable: true, async: true }]]
    }),
    common()
  ]
}, {
  input: "examples/shared/index.js",
  output: [
    {
      dir: "examples/ssg/public/js",
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
