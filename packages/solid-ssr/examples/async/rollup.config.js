import nodeResolve from "@rollup/plugin-node-resolve";
import common from "@rollup/plugin-commonjs";
import babel from "@rollup/plugin-babel";
import copy from "rollup-plugin-copy";

export default [
  {
    input: "examples/async/index.js",
    output: [
      {
        dir: "examples/async/lib",
        format: "cjs"
      }
    ],
    preserveEntrySignatures: false,
    external: ["solid-js", "solid-js/web", "path", "express", "solid-styled-components"],
    plugins: [
      nodeResolve({ preferBuiltins: true }),
      babel({
        babelHelpers: "bundled",
        presets: [["solid", { generate: "ssr", hydratable: true, async: true }]]
      }),
      common()
    ]
  },
  {
    input: "examples/shared/src/index.js",
    output: [
      {
        dir: "examples/async/public/js",
        format: "esm"
      }
    ],
    preserveEntrySignatures: false,
    plugins: [
      nodeResolve(),
      babel({
        babelHelpers: "bundled",
        presets: [["solid", { generate: "dom", hydratable: true }]]
      }),
      common(),
      copy({
        targets: [
          {
            src: ["examples/shared/static/*"],
            dest: "examples/async/public"
          }
        ]
      })
    ]
  }
];
