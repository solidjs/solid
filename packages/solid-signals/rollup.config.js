import replace from "@rollup/plugin-replace";
import terser from "@rollup/plugin-terser";
import typescript from "@rollup/plugin-typescript";
import prettier from "rollup-plugin-prettier";

export default [
  {
    input: "src/index.ts",
    output: {
      file: "dist/dev.js",
      format: "esm"
    },
    plugins: [
      replace({
        __DEV__: "true",
        __TEST__: "false",
        preventAssignment: true
      }),
      typescript({
        declaration: false,
        outDir: "dist",
        module: "esnext",
        target: "esnext",
        moduleResolution: "bundler",
        verbatimModuleSyntax: true
      }),
      terser({
        compress: false,
        mangle: false
      }),
      prettier({
        parser: "typescript"
      })
    ]
  },
  {
    input: "src/index.ts",
    output: {
      file: "dist/prod.js",
      format: "esm"
    },
    plugins: [
      replace({
        __DEV__: "false",
        __TEST__: "false",
        preventAssignment: true
      }),
      typescript({
        declaration: false,
        outDir: "dist",
        module: "esnext",
        target: "esnext",
        moduleResolution: "bundler",
        verbatimModuleSyntax: true
      }),
      terser({
        compress: false,
        mangle: {
          keep_classnames: true,
          keep_fnames: true,
           module: false,
          properties: {
            regex: /^_/
          }
        }
      }),
      prettier({
        parser: "typescript"
      })
    ]
  },
  {
    input: "src/index.ts",
    output: {
      file: "dist/node.cjs",
      format: "cjs"
    },
    plugins: [
      replace({
        __DEV__: "false",
        __TEST__: "false",
        preventAssignment: true
      }),
      typescript({
        declaration: false,
        outDir: "dist",
        module: "NodeNext",
        target: "esnext",
        moduleResolution: "NodeNext",
        verbatimModuleSyntax: true
      }),
      terser({
        compress: false,
        mangle: {
          keep_classnames: true,
          keep_fnames: true,
          module: false,
          properties: {
            regex: /^_/
          }
        }
      }),
      prettier({
        parser: "typescript"
      })
    ]
  }
];
