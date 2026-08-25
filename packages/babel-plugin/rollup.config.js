import babel from "@rollup/plugin-babel";
import nodeResolve from "@rollup/plugin-node-resolve";
import path from "path";

const plugins = [
  nodeResolve({
    extensions: [".js", ".ts"],
    rootDir: path.join(process.cwd(), "../.."),
    moduleDirectories: ["node_modules", "packages"]
  }),
  babel({
    extensions: [".js", ".ts"],
    babelHelpers: "bundled",
    presets: ["@babel/preset-typescript"],
    exclude: "node_modules/**",
    babelrc: false,
    configFile: false,
    retainLines: true
  })
];

export default {
  input: "src/index.ts",
  external: [
    "@babel/plugin-syntax-jsx",
    "@babel/helper-module-imports",
    "@babel/types",
    "html-entities"
  ],
  output: {
    file: "index.js",
    format: "cjs",
    exports: "auto"
  },
  plugins
};
