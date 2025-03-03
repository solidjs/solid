import nodeResolve from "@rollup/plugin-node-resolve";
import common from "@rollup/plugin-commonjs";
import babel from "@rollup/plugin-babel";
import copy from "rollup-plugin-copy";

export default [
  {
    input: "./stream/index.js",
    preserveEntrySignatures: false,
    output: [
      {
        dir: "stream/lib",
        format: "esm"
      }
    ],
    external: ["solid-js", "@solidjs/web", "path", "express"],
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
    input: "shared/src/index.js",
    output: [
      {
        dir: "stream/public/js",
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
            src: ["shared/static/*"],
            dest: "stream/public"
          }
        ]
      })
    ]
  }
];
