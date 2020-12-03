import nodeResolve from "@rollup/plugin-node-resolve";
import path from "path";

const plugins = [
  nodeResolve({
    rootDir: path.join(process.cwd(), "../.."),
    customResolveOptions: {
      moduleDirectory: ["node_modules", "packages"]
    }
  })
];

export default {
  input: "src/index.js",
  external: ["@babel/plugin-syntax-jsx", "@babel/helper-module-imports", "@babel/types"],
  output: {
    file: "index.js",
    format: "cjs",
    exports: "auto"
  },
  plugins
};
