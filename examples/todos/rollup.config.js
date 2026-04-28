import nodeResolve from "@rollup/plugin-node-resolve";
import common from "@rollup/plugin-commonjs";
import babel from "@rollup/plugin-babel";
import copy from "rollup-plugin-copy";

const extensions = [".js", ".jsx", ".ts", ".tsx"];
const isProd = !!process.env.production;

export default [
  {
    input: "./src/main.tsx",
    output: [{ dir: "public/js", format: "esm" }],
    preserveEntrySignatures: false,
    plugins: [
      nodeResolve({
        exportConditions: ["solid", isProd ? "production" : "development"],
        extensions
      }),
      babel({
        extensions,
        exclude: "node_modules/**",
        babelHelpers: "bundled",
        presets: [
          ["solid", { generate: "dom", hydratable: false, dev: !isProd }],
          "@babel/preset-typescript"
        ]
      }),
      common(),
      copy({
        targets: [{ src: ["index.html", "src/app.css"], dest: "public" }]
      })
    ]
  }
];
