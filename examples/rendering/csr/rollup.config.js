import nodeResolve from "@rollup/plugin-node-resolve";
import common from "@rollup/plugin-commonjs";
import babel from "@rollup/plugin-babel";
import copy from "rollup-plugin-copy";

const extensions = [".js", ".jsx", ".ts", ".tsx"];

export default [
  {
    input: "./csr/client.tsx",
    output: [{ dir: "csr/public/js", format: "esm" }],
    preserveEntrySignatures: false,
    plugins: [
      nodeResolve({ exportConditions: ["solid", "development"], extensions }),
      babel({
        extensions,
        exclude: "node_modules/**",
        babelHelpers: "bundled",
        presets: [
          ["solid", { generate: "dom", hydratable: false, dev: true }],
          "@babel/preset-typescript"
        ]
      }),
      common(),
      copy({
        targets: [
          { src: ["shared/static/*"], dest: "csr/public" },
          { src: ["csr/index.html"], dest: "csr/public" }
        ]
      })
    ]
  }
];
