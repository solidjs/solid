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
    external: ["solid-js", "solid-js/server", "path", "express"],
    plugins: [
      nodeResolve({ preferBuiltins: true }),
      babel({
        presets: [["solid", { generate: "ssr", hydratable: true }]]
      }),
      common()
    ]
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
