import nodeResolve from "@rollup/plugin-node-resolve";
import babel from "@rollup/plugin-babel";
import cleanup from "rollup-plugin-cleanup";

const plugins = [
  nodeResolve({
    extensions: [".js", ".ts"]
  }),
  babel({
    extensions: [".js", ".ts"],
    exclude: "node_modules/**",
    babelrc: false,
    babelHelpers: "bundled",
    presets: ["@babel/preset-typescript"]
  }),
  cleanup({
    comments: ["some", /PURE/],
    extensions: [".js", ".ts"]
  })
];

export default [
  {
    input: "src/index.ts",
    output: [
      {
        file: "dist/h.cjs",
        format: "cjs",
        exports: "auto"
      },
      {
        file: "dist/h.js",
        format: "es"
      }
    ],
    external: ["@solidjs/web"],
    plugins
  },
  {
    input: "jsx-runtime/src/index.ts",
    output: [
      {
        file: "jsx-runtime/dist/jsx.cjs",
        format: "cjs"
      },
      {
        file: "jsx-runtime/dist/jsx.js",
        format: "es"
      }
    ],
    external: ["@solidjs/h"],
    plugins
  }
];
