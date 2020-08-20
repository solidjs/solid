import nodeResolve from "@rollup/plugin-node-resolve";
import common from "@rollup/plugin-commonjs";
import babel from "@rollup/plugin-babel";
import copy from "rollup-plugin-copy";

export default [
  {
    input: "examples/stream/index.js",
    output: [
      {
        dir: "examples/stream/lib",
        format: "cjs"
      }
    ],
    external: ["solid-js", "solid-js/dom", "path", "express"],
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
        dir: "examples/stream/public/js",
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
            dest: "examples/stream/public"
          }
        ]
      })
    ]
  }
];
