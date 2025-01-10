import nodeResolve from "@rollup/plugin-node-resolve";
import common from "@rollup/plugin-commonjs";
import babel from "@rollup/plugin-babel";
import copy from "rollup-plugin-copy";

export default [
  {
    input: "examples/stream/index.js",
    preserveEntrySignatures: false,
    output: [
      {
        dir: "examples/stream/lib",
        format: "esm"
      }
    ],
    external: ["solid-js", "solid-js/web", "path", "express", "stream"],
    plugins: [
      nodeResolve({ preferBuiltins: true, exportConditions: ["solid", "node"] }),
      babel({
        babelHelpers: "bundled",
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
      nodeResolve({ exportConditions: ["solid"] }),
      babel({
        babelHelpers: "bundled",
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
