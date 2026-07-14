import replace from "@rollup/plugin-replace";
import typescript from "@rollup/plugin-typescript";
import prettier from "rollup-plugin-prettier";

// Each output is a per-module tree (`preserveModules`), not a flat bundle, so
// consumer bundlers can drop whole feature modules — including their top-level
// GlobalQueue hook installs, which statement-level shaking of a flat file can
// never remove (#2883). `_`-prefixed property mangling runs as a single
// sequential post-pass (scripts/mangle-props.mjs) with one shared nameCache
// per tree; per-chunk terser would mangle the same property to different
// names in different modules and break every cross-module member access.
export default [
  {
    input: "src/index.ts",
    output: {
      dir: "dist/dev",
      format: "esm",
      preserveModules: true,
      preserveModulesRoot: "src"
    },
    plugins: [
      replace({
        __DEV__: "true",
        __TEST__: "false",
        preventAssignment: true
      }),
      typescript({
        declaration: false,
        outDir: "dist/dev",
        module: "esnext",
        target: "esnext",
        moduleResolution: "bundler",
        verbatimModuleSyntax: true
      }),
      prettier({
        parser: "typescript"
      })
    ]
  },
  {
    input: "src/index.ts",
    output: {
      dir: "dist/prod",
      format: "esm",
      preserveModules: true,
      preserveModulesRoot: "src"
    },
    plugins: [
      replace({
        __DEV__: "false",
        __TEST__: "false",
        preventAssignment: true
      }),
      typescript({
        declaration: false,
        outDir: "dist/prod",
        module: "esnext",
        target: "esnext",
        moduleResolution: "bundler",
        verbatimModuleSyntax: true
      }),
      prettier({
        parser: "typescript"
      })
    ]
  },
  {
    input: "src/index.ts",
    output: {
      dir: "dist/node",
      format: "cjs",
      preserveModules: true,
      preserveModulesRoot: "src",
      entryFileNames: "[name].cjs",
      exports: "named"
    },
    plugins: [
      replace({
        __DEV__: "false",
        __TEST__: "false",
        preventAssignment: true
      }),
      typescript({
        declaration: false,
        outDir: "dist/node",
        module: "esnext",
        target: "esnext",
        moduleResolution: "bundler",
        verbatimModuleSyntax: true
      }),
      prettier({
        parser: "typescript"
      })
    ]
  }
];
