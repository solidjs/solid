import nodeResolve from "@rollup/plugin-node-resolve";
import common from "@rollup/plugin-commonjs";
import babel from "@rollup/plugin-babel";
import copy from "rollup-plugin-copy";

export default [
  {
    input: "examples/ssr/index.js",
    output: [
      {
        dir: "examples/ssr/lib",
        format: "cjs"
      }
    ],
    external: ["solid-js", "solid-js/web", "path", "express", "stream"],
    plugins: [
      nodeResolve({ preferBuiltins: true }),
      babel({
        babelHelpers: "bundled",
        presets: [["solid", { generate: "ssr", hydratable: true }]]
      }),
      common()
    ],
    preserveEntrySignatures: false
  },
  {
    input: "examples/shared/src/index.js",
    output: [
      {
        dir: "examples/ssr/public/js",
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
            dest: "examples/ssr/public"
          }
        ]
      })
    ]
  }
];
